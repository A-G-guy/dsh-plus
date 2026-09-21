#!/usr/bin/env python3
"""统一搜索入口：OpenAI Chat + Context7 + Exa + Tavily + 本地 fetch。

推荐优先使用本入口的 search/docs/fetch/research 能力，以获得自动 fallback。
服务专属能力通过：search.py openai-chat|context7|exa|tavily <operation> ... 透传。
URL 抓取默认走本地 fetch；仅当本地请求失败或质量评估不达标时，才 fallback 到 Tavily / Exa。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from collections.abc import Callable, Iterable
from typing import Any

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

import context7  # noqa: E402
import exa  # noqa: E402
import fetch as local_fetch  # noqa: E402
import fetch_playwright  # noqa: E402
import openai_chat  # noqa: E402
import tavily  # noqa: E402

ResultFunc = Callable[[], dict[str, Any]]

DEFAULT_FETCH_TOTAL_TIMEOUT = float(
    os.getenv("FETCH_TOTAL_TIMEOUT") or os.getenv("SEARCH_FETCH_TOTAL_TIMEOUT") or "25"
)
DEFAULT_LOCAL_STAGE_TIMEOUT = float(os.getenv("FETCH_LOCAL_STAGE_TIMEOUT") or "5")
DEFAULT_PLAYWRIGHT_STAGE_TIMEOUT = float(
    os.getenv("FETCH_PLAYWRIGHT_STAGE_TIMEOUT") or "12"
)
MIN_FALLBACK_TIMEOUT = float(os.getenv("FETCH_MIN_STAGE_TIMEOUT") or "3")


class FallbackFailure(RuntimeError):
    """所有候选服务都失败。"""

    def __init__(self, attempts: list[dict[str, Any]]):
        super().__init__("所有候选搜索服务均不可用或返回失败")
        self.attempts = attempts


class SkipService(RuntimeError):
    """当前上下文下跳过某个候选服务，不记录为失败。"""


def _print_json(value: Any) -> None:
    print(json.dumps(value, ensure_ascii=False, indent=2))


def _split_csv(value: str | None) -> list[str] | None:
    if not value:
        return None
    return [part.strip() for part in value.split(",") if part.strip()]


def _json_or_none(value: str | None) -> dict[str, Any] | None:
    if not value:
        return None
    return json.loads(value)


def _parse_services(
    value: str, default: list[str], *, no_fallback: bool = False
) -> list[str]:
    if value == "auto":
        return default[:1] if no_fallback else default
    preferred = [part.strip() for part in value.split(",") if part.strip()]
    if no_fallback:
        return preferred
    # 用户指定首选服务时，仍自动追加默认 fallback。
    return preferred + [svc for svc in default if svc not in preferred]


def _service_error(service: str, exc: BaseException) -> dict[str, Any]:
    error = {
        "service": service,
        "ok": False,
        "error": str(exc),
        "status": getattr(exc, "status", None),
        "details": getattr(exc, "details", None),
        "elapsedSeconds": getattr(exc, "elapsed_seconds", None),
    }
    key_attempts = getattr(exc, "key_attempts", None)
    if key_attempts:
        error["keyFallbackAttempts"] = key_attempts
    return error


def _with_fallback(candidates: Iterable[tuple[str, ResultFunc]]) -> dict[str, Any]:
    attempts: list[dict[str, Any]] = []
    for service, func in candidates:
        started = time.monotonic()
        try:
            result = func()
            result.setdefault("ok", True)
            result.setdefault("service", service)
            result.setdefault("elapsedSeconds", round(time.monotonic() - started, 3))
            if attempts:
                result["fallbackAttempts"] = attempts
            result["selectedService"] = service
            return result
        except SkipService:
            continue
        except Exception as exc:  # noqa: BLE001 - fallback 需要捕获所有服务错误
            exc.elapsed_seconds = round(time.monotonic() - started, 3)  # type: ignore[attr-defined]
            attempts.append(_service_error(service, exc))
    raise FallbackFailure(attempts)


def _context7_search_call(args: argparse.Namespace) -> dict[str, Any]:
    if not args.library:
        raise context7.ServiceError("Context7 搜索需要 --library；无库名时跳过")
    return context7.lookup(args.library, args.query, fast=args.fast_context7)


def _exa_search_call(
    args: argparse.Namespace, *, research: bool = False
) -> dict[str, Any]:
    contents: dict[str, Any] = {"highlights": True}
    if args.include_text or research:
        contents["text"] = {"maxCharacters": args.max_characters}
    if args.include_summary or research:
        contents["summary"] = True
    if args.fresh:
        contents["maxAgeHours"] = 0
    search_type = args.exa_type
    if research and search_type == "auto":
        search_type = "deep"
    category = args.category
    if getattr(args, "intent", None) == "news" and category is None:
        category = "news"
    return exa.search(
        args.query,
        search_type=search_type,
        num_results=args.max_results,
        category=category,
        include_domains=_split_csv(args.include_domains),
        exclude_domains=_split_csv(args.exclude_domains),
        contents=contents,
        output_schema=_json_or_none(args.output_schema_json),
        system_prompt=args.system_prompt,
    )


def _tavily_search_call(
    args: argparse.Namespace, *, research_like: bool = False
) -> dict[str, Any]:
    topic = args.topic
    if getattr(args, "intent", None) == "news" and topic == "general":
        topic = "news"
    depth = args.tavily_depth
    if research_like and depth == "basic":
        depth = "advanced"
    raw_content: Any = "markdown" if args.include_text else False
    answer: Any = "advanced" if research_like else args.include_answer
    return tavily.search(
        args.query,
        search_depth=depth,
        max_results=args.max_results,
        topic=topic,
        time_range=args.time_range,
        include_answer=answer,
        include_raw_content=raw_content,
        include_domains=_split_csv(args.include_domains),
        exclude_domains=_split_csv(args.exclude_domains),
        chunks_per_source=3 if depth == "advanced" else None,
        include_usage=args.include_usage,
    )


def _openai_chat_search_call(
    args: argparse.Namespace, *, query: str | None = None
) -> dict[str, Any]:
    return openai_chat.search(
        query or args.query,
        model=getattr(args, "openai_model", None),
        base_url=getattr(args, "openai_base_url", None),
        answer_format=getattr(args, "openai_answer_format", None),
        platform=(
            getattr(args, "openai_platform", None) or getattr(args, "platform", None)
        ),
        system_prompt=getattr(args, "openai_system_prompt", None),
        thinking_effort=getattr(args, "openai_thinking_effort", None),
        thinking_field=getattr(args, "openai_thinking_field", None),
        max_tokens=getattr(args, "openai_max_tokens", None),
        temperature=getattr(args, "openai_temperature", None),
        timeout=getattr(args, "openai_timeout", None),
        max_elapsed=getattr(args, "openai_max_elapsed", None),
        extra=_json_or_none(getattr(args, "openai_extra_json", None)),
    )


def _quality_flags_need_playwright(value: Any) -> bool:
    """从结果或异常 details 中判断是否值得尝试 Playwright 渲染。"""

    if isinstance(value, dict):
        flags = value.get("flags")
        if isinstance(flags, dict) and (
            flags.get("jsRequired") or flags.get("blocked")
        ):
            return True
        quality = value.get("quality")
        if isinstance(quality, dict) and _quality_flags_need_playwright(quality):
            return True
        for key in ["qualityFailures", "failures"]:
            failures = value.get(key)
            if isinstance(failures, list) and any(
                _quality_flags_need_playwright(item) for item in failures
            ):
                return True
        data = value.get("data")
        if isinstance(data, dict):
            results = data.get("results")
            if isinstance(results, list) and any(
                _quality_flags_need_playwright(item) for item in results
            ):
                return True
    return False


def _remaining_budget(context: dict[str, Any]) -> float:
    return max(0.0, float(context.get("deadline", time.monotonic())) - time.monotonic())


def _stage_timeout(
    context: dict[str, Any],
    *,
    default_timeout: float,
    explicit_timeout: float | None = None,
    reserve_after_stage: float = 0.0,
) -> float:
    """计算本地阶段的实际超时。

    `reserve_after_stage` 只在预算足够宽裕时预留给后续本地阶段；
    预算较小时优先让当前阶段有一次完整尝试。显式 `--timeout` 可小于
    `FETCH_MIN_STAGE_TIMEOUT`，方便用户主动快速失败。
    """

    remaining = _remaining_budget(context)
    if remaining <= 0:
        raise RuntimeError("fetch 本地阶段预算已耗尽")

    requested = max(
        0.1, default_timeout if explicit_timeout is None else explicit_timeout
    )
    usable_remaining = remaining
    if (
        explicit_timeout is None
        and reserve_after_stage > 0
        and remaining > reserve_after_stage + MIN_FALLBACK_TIMEOUT
    ):
        usable_remaining = remaining - reserve_after_stage

    timeout = min(requested, usable_remaining)
    if explicit_timeout is None:
        timeout = max(timeout, min(MIN_FALLBACK_TIMEOUT, remaining))
    timeout = min(timeout, remaining)
    return round(timeout, 3)


def _local_fetch_call(
    args: argparse.Namespace, context: dict[str, Any]
) -> dict[str, Any]:
    try:
        return local_fetch.fetch_urls(
            context["urls"],
            timeout=_stage_timeout(
                context,
                default_timeout=DEFAULT_LOCAL_STAGE_TIMEOUT,
                explicit_timeout=args.timeout,
                reserve_after_stage=8.0,
            ),
            max_chars=args.max_characters,
            min_quality_score=args.quality_threshold,
            retries=0 if args.retries is None else args.retries,
            retry_delay=args.retry_delay,
            retry_jitter=args.retry_jitter,
            retry_on_any=args.retry_on_any,
            referer=args.referer,
            accept_language=args.accept_language,
            extra_headers=context.get("extra_headers"),
            extract_mode=args.extract_mode,
            proxy=args.proxy,
            keep_links=False,
            drop_structural_noise=True,
            markdownish=True,
        )
    except Exception as exc:
        context["localError"] = exc
        if args.with_js or (
            args.auto_playwright
            and _quality_flags_need_playwright(getattr(exc, "details", None))
        ):
            context["playwrightNeeded"] = True
        raise


def _playwright_fetch_call(
    args: argparse.Namespace, context: dict[str, Any], *, explicit: bool = False
) -> dict[str, Any]:
    if not explicit and not args.with_js and not context.get("playwrightNeeded"):
        raise SkipService("当前 local-fetch 质量信号不需要 Playwright")
    return fetch_playwright.fetch_urls(
        context["urls"],
        timeout=_stage_timeout(
            context,
            default_timeout=DEFAULT_PLAYWRIGHT_STAGE_TIMEOUT,
            explicit_timeout=args.playwright_timeout,
            reserve_after_stage=6.0,
        ),
        wait_ms=args.wait_ms,
        selector=args.selector,
        max_chars=args.max_characters,
        markdownish=True,
        min_quality_score=args.quality_threshold,
        proxy=args.proxy,
        retries=args.playwright_retries,
    )


def command_search(args: argparse.Namespace) -> dict[str, Any]:
    if args.intent == "docs" or args.library:
        default = ["openai-chat", "context7", "exa", "tavily"]
    elif args.intent == "news":
        default = ["openai-chat", "tavily", "exa"]
    elif args.intent == "research":
        default = ["openai-chat", "exa", "tavily"]
    else:
        default = ["openai-chat", "exa", "tavily"]

    order = _parse_services(args.service, default, no_fallback=args.no_fallback)
    candidates: list[tuple[str, ResultFunc]] = []
    for svc in order:
        if svc == "openai-chat":
            candidates.append((svc, lambda args=args: _openai_chat_search_call(args)))
        elif svc == "context7":
            candidates.append((svc, lambda args=args: _context7_search_call(args)))
        elif svc == "exa":
            candidates.append(
                (
                    svc,
                    lambda args=args: _exa_search_call(
                        args, research=args.intent == "research"
                    ),
                )
            )
        elif svc == "tavily":
            candidates.append(
                (
                    svc,
                    lambda args=args: _tavily_search_call(
                        args, research_like=args.intent == "research"
                    ),
                )
            )
        else:
            raise ValueError(f"未知服务: {svc}")
    return _with_fallback(candidates)


def command_docs(args: argparse.Namespace) -> dict[str, Any]:
    default = ["context7", "exa", "tavily", "openai-chat"]
    order = _parse_services(args.service, default, no_fallback=args.no_fallback)
    # 复用 search 参数形状。
    args.intent = "docs"
    args.include_text = args.include_text
    args.include_summary = False
    args.fresh = False
    args.category = None
    args.topic = "general"
    args.time_range = None
    args.include_answer = False
    args.include_usage = False
    args.output_schema_json = None
    args.system_prompt = None
    candidates: list[tuple[str, ResultFunc]] = []
    for svc in order:
        if svc == "context7":
            candidates.append(
                (
                    svc,
                    lambda args=args: context7.lookup(
                        args.library, args.query, fast=args.fast_context7
                    ),
                )
            )
        elif svc == "exa":
            candidates.append(
                (
                    svc,
                    lambda args=args: exa.search(
                        f"{args.library} documentation: {args.query}",
                        search_type=args.exa_type,
                        num_results=args.max_results,
                        contents={
                            "highlights": True,
                            "text": {"maxCharacters": args.max_characters},
                        }
                        if args.include_text
                        else {"highlights": True},
                    ),
                )
            )
        elif svc == "tavily":
            candidates.append(
                (
                    svc,
                    lambda args=args: tavily.search(
                        f"{args.library} documentation {args.query}",
                        search_depth=args.tavily_depth,
                        max_results=args.max_results,
                        include_raw_content="markdown" if args.include_text else False,
                    ),
                )
            )
        elif svc == "openai-chat":
            candidates.append(
                (
                    svc,
                    lambda args=args: _openai_chat_search_call(
                        args, query=f"{args.library} documentation: {args.query}"
                    ),
                )
            )
        else:
            raise ValueError(f"未知服务: {svc}")
    return _with_fallback(candidates)


def command_fetch(args: argparse.Namespace) -> dict[str, Any]:
    urls = _split_csv(args.urls) or []
    if not urls:
        raise ValueError("--urls 不能为空")
    default = ["local-fetch", "playwright", "tavily", "exa"]
    order = _parse_services(args.service, default, no_fallback=args.no_fallback)
    explicit_playwright = args.with_js or (
        args.service != "auto"
        and any(svc.strip() == "playwright" for svc in args.service.split(","))
    )
    context: dict[str, Any] = {
        "urls": urls,
        "playwrightNeeded": args.with_js,
        "extra_headers": local_fetch.parse_header_list(args.header),
        "deadline": time.monotonic() + max(1.0, args.total_timeout),
    }
    candidates: list[tuple[str, ResultFunc]] = []
    for svc in order:
        if svc == "tavily":
            candidates.append(
                (
                    svc,
                    lambda urls=urls, args=args: tavily.extract(
                        urls[0] if len(urls) == 1 else urls,
                        query=args.query,
                        extract_depth="advanced" if args.advanced else "basic",
                        include_images=args.include_images,
                        include_favicon=args.include_favicon,
                        fmt=args.format,
                        timeout=args.api_timeout,
                        http_timeout=args.api_timeout,
                        include_usage=args.include_usage,
                    ),
                )
            )
        elif svc == "exa":
            candidates.append(
                (
                    svc,
                    lambda urls=urls, args=args: exa.contents(
                        urls,
                        text={"maxCharacters": args.max_characters},
                        highlights={"query": args.query, "maxCharacters": 2000}
                        if args.query
                        else None,
                        timeout=args.api_timeout,
                    ),
                )
            )
        elif svc in {"local", "local-fetch"}:
            candidates.append(
                (
                    "local-fetch",
                    lambda args=args, context=context: _local_fetch_call(args, context),
                )
            )
        elif svc in {"playwright", "browser", "render"}:
            candidates.append(
                (
                    "playwright",
                    lambda args=args, context=context, explicit=explicit_playwright: (
                        _playwright_fetch_call(args, context, explicit=explicit)
                    ),
                )
            )
        else:
            raise ValueError(f"未知服务: {svc}")
    return _with_fallback(candidates)


def command_simple_fetch(args: argparse.Namespace) -> dict[str, Any]:
    urls = _split_csv(args.urls) or []
    if not urls:
        raise ValueError("--urls 不能为空")
    return local_fetch.fetch_urls(
        urls,
        timeout=args.timeout,
        max_chars=args.max_characters,
        keep_links=args.keep_links,
        drop_structural_noise=not args.keep_structural_noise,
        markdownish=not args.plain,
        user_agent=args.user_agent,
        retries=args.retries,
        retry_delay=args.retry_delay,
        retry_jitter=args.retry_jitter,
        retry_on_any=args.retry_on_any,
        referer=args.referer,
        accept_language=args.accept_language,
        extra_headers=local_fetch.parse_header_list(args.header),
        extract_mode=args.extract_mode,
        proxy=args.proxy,
    )


def command_research(args: argparse.Namespace) -> dict[str, Any]:
    default = ["exa", "tavily", "openai-chat"]
    order = _parse_services(args.service, default, no_fallback=args.no_fallback)
    candidates: list[tuple[str, ResultFunc]] = []
    for svc in order:
        if svc == "exa":
            candidates.append(
                (
                    svc,
                    lambda args=args: exa.search(
                        args.query,
                        search_type=args.exa_type,
                        num_results=args.max_results,
                        include_domains=_split_csv(args.include_domains),
                        exclude_domains=_split_csv(args.exclude_domains),
                        contents={
                            "highlights": True,
                            "text": {"maxCharacters": args.max_characters},
                            "summary": True,
                        },
                        output_schema=_json_or_none(args.output_schema_json),
                        system_prompt=args.system_prompt,
                    ),
                )
            )
        elif svc == "tavily":
            candidates.append(
                (
                    svc,
                    lambda args=args: tavily.research(
                        args.query,
                        model=args.tavily_model,
                        output_schema=_json_or_none(args.output_schema_json),
                        include_domains=_split_csv(args.include_domains),
                        exclude_domains=_split_csv(args.exclude_domains),
                        output_length=args.output_length,
                    ),
                )
            )
        elif svc == "openai-chat":
            candidates.append((svc, lambda args=args: _openai_chat_search_call(args)))
        else:
            raise ValueError(f"未知服务: {svc}")
    return _with_fallback(candidates)


def _add_openai_chat_args(p: argparse.ArgumentParser) -> None:
    p.add_argument(
        "--openai-model",
        help="OpenAI-compatible 模型名；也可用 SEARCH_OPENAI_MODEL，未配置则 openai-chat 失败并 fallback",
    )
    p.add_argument(
        "--openai-base-url",
        help="OpenAI-compatible base URL；默认 SEARCH_OPENAI_BASE_URL 或 https://api.openai.com/v1",
    )
    p.add_argument(
        "--openai-thinking-effort",
        choices=["low", "medium", "high"],
        help="思考程度；会写入 thinking 字段，字段名默认 reasoning_effort",
    )
    p.add_argument(
        "--openai-thinking-field",
        help="思考程度请求字段名；默认 SEARCH_OPENAI_THINKING_FIELD 或 reasoning_effort；传空字符串可禁用",
    )
    p.add_argument(
        "--openai-answer-format",
        choices=["markdown", "text", "json"],
        help="回答格式；默认 SEARCH_OPENAI_ANSWER_FORMAT 或 markdown",
    )
    p.add_argument(
        "--platform",
        "--openai-platform",
        dest="openai_platform",
        help="OpenAI Chat 搜索优先关注的平台、站点或来源类型；会写入 user message",
    )
    p.add_argument(
        "--openai-system-prompt",
        help="显式发送给 OpenAI 的真实 system prompt；默认搜索提示词不会放在 system role",
    )
    p.add_argument("--openai-max-tokens", type=int)
    p.add_argument("--openai-temperature", type=float)
    p.add_argument(
        "--openai-timeout",
        type=float,
        help="连接/空闲超时秒数；持续收到流式 chunk 时会自动延长",
    )
    p.add_argument(
        "--openai-max-elapsed",
        type=float,
        help="OpenAI 调用硬上限秒数；0 表示不设置硬上限",
    )
    p.add_argument(
        "--openai-extra-json", help="合并到 OpenAI Chat Completions 请求体的额外 JSON"
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="OpenAI Chat / Context7 / Exa / Tavily + 本地 fetch 统一入口（fetch 默认本地优先，失败/低质量才 fallback，不使用 MCP）",
        epilog="服务专属能力：search.py openai-chat|context7|exa|tavily <operation> ...；零成本抓取：search.py simple-fetch --urls <url>",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser(
        "search", help="广搜索：OpenAI Chat 最高优先级，失败后按 intent fallback"
    )
    p.add_argument("--query", required=True)
    p.add_argument(
        "--intent", default="general", choices=["general", "docs", "news", "research"]
    )
    p.add_argument(
        "--service",
        default="auto",
        help="auto 或逗号分隔服务：openai-chat,context7,exa,tavily",
    )
    p.add_argument("--no-fallback", action="store_true")
    p.add_argument("--library", help="文档类搜索的库名或 Context7 libraryId")
    p.add_argument("--max-results", type=int, default=5)
    p.add_argument("--include-domains", help="逗号分隔域名")
    p.add_argument("--exclude-domains", help="逗号分隔域名")
    p.add_argument("--include-text", action="store_true")
    p.add_argument("--include-summary", action="store_true")
    p.add_argument("--fresh", action="store_true", help="Exa 强制实时抓取；可能更慢")
    p.add_argument(
        "--category", help="Exa category，如 news/company/people/research paper"
    )
    p.add_argument(
        "--exa-type",
        default="auto",
        choices=["auto", "fast", "instant", "deep-lite", "deep", "deep-reasoning"],
    )
    p.add_argument(
        "--tavily-depth",
        default="basic",
        choices=["basic", "advanced", "fast", "ultra-fast"],
    )
    p.add_argument("--topic", default="general", choices=["general", "news", "finance"])
    p.add_argument("--time-range", choices=["day", "week", "month", "year"])
    p.add_argument(
        "--include-answer", action="store_true", help="Tavily include_answer=true"
    )
    p.add_argument("--include-usage", action="store_true")
    p.add_argument("--max-characters", type=int, default=8000)
    p.add_argument("--output-schema-json")
    p.add_argument("--system-prompt")
    p.add_argument("--fast-context7", action="store_true")
    _add_openai_chat_args(p)
    p.set_defaults(func=command_search)

    p = sub.add_parser(
        "docs",
        help="库文档查询：Context7 优先，失败后 Exa/Tavily，OpenAI Chat 末位兜底",
    )
    p.add_argument("--library", required=True)
    p.add_argument("--query", required=True)
    p.add_argument(
        "--service",
        default="auto",
        help="auto 或逗号分隔服务：context7,exa,tavily,openai-chat",
    )
    p.add_argument("--no-fallback", action="store_true")
    p.add_argument("--max-results", type=int, default=5)
    p.add_argument("--include-text", action="store_true")
    p.add_argument("--include-domains")
    p.add_argument("--exclude-domains")
    p.add_argument(
        "--exa-type",
        default="auto",
        choices=["auto", "fast", "instant", "deep-lite", "deep", "deep-reasoning"],
    )
    p.add_argument(
        "--tavily-depth",
        default="basic",
        choices=["basic", "advanced", "fast", "ultra-fast"],
    )
    p.add_argument("--max-characters", type=int, default=8000)
    p.add_argument("--fast-context7", action="store_true")
    _add_openai_chat_args(p)
    p.set_defaults(func=command_docs)

    p = sub.add_parser(
        "fetch",
        help="URL fetch/提取：单一入口，本地优先；必要时自动 Playwright，再 Tavily/Exa fallback",
    )
    p.add_argument("--urls", required=True, help="逗号分隔 URL")
    p.add_argument(
        "--query", help="本地/Playwright 失败后传给 Tavily/Exa 的重排/高亮查询"
    )
    p.add_argument(
        "--service",
        default="auto",
        help="auto 或逗号分隔服务：local-fetch,playwright,tavily,exa",
    )
    p.add_argument(
        "--no-fallback",
        action="store_true",
        help="只尝试服务链中的第一个服务；auto 时只尝试 local-fetch",
    )
    p.add_argument(
        "--with-js",
        action="store_true",
        help="本地失败后强制尝试 Playwright 渲染抓取，再 fallback 到 Tavily/Exa",
    )
    p.add_argument(
        "--no-auto-playwright",
        dest="auto_playwright",
        action="store_false",
        help="禁用低质量 JS/拦截页时的自动 Playwright 尝试",
    )
    p.set_defaults(auto_playwright=True)
    p.add_argument(
        "--wait-ms",
        type=int,
        help="Playwright 页面打开后额外等待毫秒；默认 PLAYWRIGHT_WAIT_MS 或 1000",
    )
    p.add_argument("--selector", help="Playwright 优先抽取的 CSS selector")
    p.add_argument(
        "--playwright-timeout",
        type=float,
        help="Playwright 单命令超时秒数；默认 FETCH_PLAYWRIGHT_STAGE_TIMEOUT 或 12，并受 --total-timeout 本地预算约束",
    )
    p.add_argument(
        "--playwright-retries",
        type=int,
        help="Playwright open 失败重试次数；默认 PLAYWRIGHT_RETRIES 或 0，上限 1",
    )
    p.add_argument(
        "--proxy",
        help="仅自实现抓取使用的代理地址，如 127.0.0.1:7890；不传给 Tavily/Exa/Context7 API",
    )
    p.add_argument("--advanced", action="store_true", help="Tavily advanced extract")
    p.add_argument("--include-images", action="store_true")
    p.add_argument("--include-favicon", action="store_true")
    p.add_argument("--format", default="markdown", choices=["markdown", "text"])
    p.add_argument(
        "--total-timeout",
        type=float,
        default=DEFAULT_FETCH_TOTAL_TIMEOUT,
        help="local-fetch + Playwright 的本地阶段预算秒数；默认 25；API fallback 默认不强制裁剪，避免已计费请求因客户端超时丢结果",
    )
    p.add_argument(
        "--timeout",
        type=float,
        help="local-fetch 单请求超时上限；不传给 Tavily/Exa API",
    )
    p.add_argument(
        "--api-timeout",
        type=float,
        help="显式设置 Tavily/Exa HTTP 超时秒数；慎用，过短可能导致已消耗额度但拿不到结果",
    )
    p.add_argument(
        "--retries",
        type=int,
        help="本地 fetch 失败重试次数；默认读取 FETCH_RETRIES 或 1",
    )
    p.add_argument("--retry-delay", type=float, help="本地 fetch 重试初始等待秒数")
    p.add_argument(
        "--retry-jitter",
        type=float,
        default=0.0,
        help="本地 fetch 每次重试额外随机等待上限秒数",
    )
    p.add_argument(
        "--retry-on-any",
        action="store_true",
        help="本地 fetch 对任意 HTTP 错误码也重试",
    )
    p.add_argument("--referer", help="本地 fetch 的 Referer 请求头")
    p.add_argument("--accept-language", help="本地 fetch 的 Accept-Language 请求头")
    p.add_argument(
        "--header",
        action="append",
        help="本地 fetch 自定义请求头，格式 'Key: Value'；可重复",
    )
    p.add_argument(
        "--extract-mode",
        choices=["auto", "parser", "bs4"],
        default="auto",
        help="本地 HTML 正文抽取模式",
    )
    p.add_argument(
        "--quality-threshold",
        type=float,
        default=float(
            os.getenv("LOCAL_FETCH_QUALITY_THRESHOLD")
            or os.getenv("FETCH_QUALITY_THRESHOLD")
            or "0.30"
        ),
        help="本地/Playwright fetch 质量评分阈值（0-1），低于阈值才 fallback",
    )
    p.add_argument("--include-usage", action="store_true")
    p.add_argument("--max-characters", type=int, default=20000)
    p.set_defaults(func=command_fetch)

    p = sub.add_parser(
        "simple-fetch", help="无消耗简单抓取：本地 Python 清理 HTML 噪声并整理格式"
    )
    p.add_argument("--urls", required=True, help="逗号分隔 URL")
    p.add_argument("--timeout", type=float)
    p.add_argument("--max-characters", type=int, default=20000)
    p.add_argument("--keep-links", action="store_true", help="保留 a 标签链接")
    p.add_argument(
        "--keep-structural-noise",
        action="store_true",
        help="不丢弃 nav/header/footer/aside/form",
    )
    p.add_argument("--plain", action="store_true", help="不做标题式 markdown 整理")
    p.add_argument("--user-agent")
    p.add_argument("--accept-language", help="覆盖 Accept-Language")
    p.add_argument("--referer", help="设置 Referer 请求头")
    p.add_argument("--proxy", help="仅本地 fetch 使用的代理地址，如 127.0.0.1:7890")
    p.add_argument(
        "--header", action="append", help="追加自定义请求头，格式：'Key: Value'；可重复"
    )
    p.add_argument(
        "--extract-mode",
        choices=["auto", "parser", "bs4"],
        default="auto",
        help="HTML 正文抽取模式",
    )
    p.add_argument(
        "--retries", type=int, help="失败重试次数；默认读取 FETCH_RETRIES 或 1"
    )
    p.add_argument("--retry-delay", type=float, help="重试初始等待秒数")
    p.add_argument(
        "--retry-jitter", type=float, default=0.0, help="每次重试额外随机等待上限秒数"
    )
    p.add_argument(
        "--retry-on-any", action="store_true", help="对任意 HTTP 错误码也重试"
    )
    p.set_defaults(func=command_simple_fetch)

    p = sub.add_parser(
        "research",
        help="深度研究：Exa deep 搜索优先，Tavily Research fallback，OpenAI Chat 末位兜底",
    )
    p.add_argument("--query", required=True)
    p.add_argument(
        "--service", default="auto", help="auto 或逗号分隔服务：exa,tavily,openai-chat"
    )
    p.add_argument("--no-fallback", action="store_true")
    p.add_argument("--max-results", type=int, default=8)
    p.add_argument("--include-domains")
    p.add_argument("--exclude-domains")
    p.add_argument(
        "--exa-type",
        default="deep",
        choices=["deep-lite", "deep", "deep-reasoning", "auto", "fast", "instant"],
    )
    p.add_argument("--tavily-model", default="auto", choices=["mini", "pro", "auto"])
    p.add_argument("--output-length")
    p.add_argument("--output-schema-json")
    p.add_argument("--system-prompt")
    p.add_argument("--max-characters", type=int, default=12000)
    _add_openai_chat_args(p)
    p.set_defaults(func=command_research)

    # 为 help 暴露服务透传入口；实际处理在 main() 开头完成。
    for svc in [
        "context7",
        "exa",
        "tavily",
        "openai-chat",
        "local-fetch",
        "playwright",
    ]:
        target = (
            "openai_chat"
            if svc == "openai-chat"
            else (
                "fetch_playwright"
                if svc == "playwright"
                else ("fetch" if svc == "local-fetch" else svc)
            )
        )
        p = sub.add_parser(svc, help=f"透传到 scripts/{target}.py")
        p.add_argument("service_args", nargs=argparse.REMAINDER)

    return parser


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv and argv[0] in {
        "context7",
        "exa",
        "tavily",
        "openai-chat",
        "local-fetch",
        "playwright",
    }:
        service = argv[0]
        rest = argv[1:]
        if service == "context7":
            return context7.main(rest)
        if service == "exa":
            return exa.main(rest)
        if service == "tavily":
            return tavily.main(rest)
        if service == "openai-chat":
            return openai_chat.main(rest)
        if service == "local-fetch":
            return local_fetch.main(rest)
        if service == "playwright":
            return fetch_playwright.main(rest)

    parser = build_parser()
    args = parser.parse_args(argv)
    if not hasattr(args, "func"):
        parser.print_help()
        return 2
    try:
        _print_json(args.func(args))
        return 0
    except FallbackFailure as exc:
        _print_json({"ok": False, "error": str(exc), "attempts": exc.attempts})
        return 1
    except Exception as exc:  # noqa: BLE001 - CLI 入口需要结构化错误
        _print_json(
            {
                "ok": False,
                "error": str(exc),
                "status": getattr(exc, "status", None),
                "details": getattr(exc, "details", None),
            }
        )
        return 1


if __name__ == "__main__":
    sys.exit(main())
