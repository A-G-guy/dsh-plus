#!/usr/bin/env python3
"""OpenAI-compatible Chat Completions helper.

仅通过 OpenAI 兼容的 HTTP Chat Completions 端点执行生成式搜索回答。
配置只读取 SEARCH_OPENAI_*，避免误用其他工具的 OPENAI_* 环境变量。
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from collections.abc import Iterable
from datetime import datetime, timezone
from typing import Any

from env_loader import load_env_file

load_env_file()


class ServiceError(RuntimeError):
    """服务调用失败。"""

    def __init__(self, message: str, *, status: int | None = None, details: Any = None):
        super().__init__(message)
        self.status = status
        self.details = details


class MissingAPIKey(ServiceError):
    """缺少 API Key。"""


class MissingModel(ServiceError):
    """缺少模型配置。"""


DEFAULT_BASE_URL = "https://api.openai.com/v1"
DEFAULT_TIMEOUT = 120.0
DEFAULT_MAX_ELAPSED = 0.0
DEFAULT_ANSWER_FORMAT = "markdown"
SEARCH_PROMPT_TEMPLATE = """你好！想请你帮我查询一些信息。下面是当前时间和协作建议，希望能帮助我们更好地完成搜索：

{time_context}

1. 关于搜索工具的使用：
   - 如果你目前拥有联网搜索工具，请务必启动搜索功能，先广泛搜索（至少 5 个不同角度或来源线索），再深入整理最相关的 2-3 个方向。
   - 如果你目前无法使用搜索工具，或无法确认你能取得实时信息，请不要勉强回答，也严禁凭借记忆进行猜测、幻想或伪造答案。请直接坦诚地回复：“很抱歉，我目前无法使用搜索工具，无法为您提供最新的实时查询服务。”

2. 关于信息的真实性：
   - 请推断用户真实意图；即使问题很简略，也要考虑相关口径、年份、地区、机构和术语差异。
   - 对搜索到的细节（如数据、时间、事件经过、排名、版本等）进行多方验证，不要仅凭单一来源或“直觉/经验”下结论。
   - 优先引用权威来源：官方文档/官网、政府或机构公告、学术论文、可信媒体、维基或行业数据库；中文话题可中英文交叉检索。
   - 每个关键事实、核心数据或结论都应尽量附真实可信的参考来源链接（URL）；无法核验时请明确标注不确定性。

3. 关于回复的格式：
   - 请使用 {answer_format} 格式，并用清晰的结构化方式呈现回答，例如结论先行、小标题、分点步骤或表格。
   - 技术内容请用通俗语言解释术语；如有公式可用 LaTeX，如有脚本可用代码块。
{platform_section}

我需要你帮我搜索的具体内容是：
{query}
"""

_THINK_BLOCK_RE = re.compile(
    r"<\s*(?:think|thinking|reasoning)\b[^>]*>.*?<\s*/\s*(?:think|thinking|reasoning)\s*>",
    re.IGNORECASE | re.DOTALL,
)
_FENCED_THINK_RE = re.compile(
    r"```\s*(?:think|thinking|reasoning)\s*\n.*?```", re.IGNORECASE | re.DOTALL
)


def _env(name: str) -> str:
    return os.getenv(name, "").strip()


def _float_env(name: str, default: float) -> float:
    value = _env(name)
    if not value:
        return default
    return float(value)


def _bool_env(name: str, default: bool = False) -> bool:
    value = _env(name).lower()
    if not value:
        return default
    return value in {"1", "true", "yes", "on"}


def get_local_time_info() -> str:
    """返回给搜索提示词使用的本地时间上下文。"""

    try:
        local_tz = datetime.now().astimezone().tzinfo
        local_now = datetime.now(local_tz)
    except Exception:  # noqa: BLE001 - 时间上下文失败时安全回退 UTC
        local_now = datetime.now(timezone.utc)

    weekdays_cn = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"]
    return (
        "[当前时间上下文]\n"
        f"- Date: {local_now.strftime('%Y-%m-%d')} ({weekdays_cn[local_now.weekday()]})\n"
        f"- Time: {local_now.strftime('%H:%M:%S')}\n"
        f"- Timezone: {local_now.tzname() or 'Local'}"
    )


def _platform_section(platform: str | None = None) -> str:
    value = (platform or "").strip()
    if not value:
        return ""
    return (
        "\n4. 关于搜索平台/来源侧重：\n"
        f"   - 请优先关注这些平台、站点或来源类型：{value}\n"
        "   - 即使指定了平台，也请在必要时使用其他权威来源交叉验证，不要只凭单一来源下结论。"
    )


def _base_url(value: str | None = None) -> str:
    return (value or _env("SEARCH_OPENAI_BASE_URL") or DEFAULT_BASE_URL).rstrip("/")


def _chat_completions_url(base_url: str) -> str:
    base = base_url.rstrip("/")
    if base.endswith("/chat/completions"):
        return base
    if base.endswith("/v1"):
        return f"{base}/chat/completions"
    return f"{base}/v1/chat/completions"


def _api_key() -> str:
    key = _env("SEARCH_OPENAI_API_KEY")
    if not key:
        raise MissingAPIKey("缺少 SEARCH_OPENAI_API_KEY")
    return key


def _model(value: str | None = None) -> str:
    model = (value or _env("SEARCH_OPENAI_MODEL")).strip()
    if not model:
        raise MissingModel(
            "缺少 SEARCH_OPENAI_MODEL 或 --model/--openai-model；OpenAI Chat provider 不设置默认模型"
        )
    return model


def _timeout(value: float | None = None) -> float:
    return float(
        value
        if value is not None
        else _float_env("SEARCH_OPENAI_TIMEOUT", DEFAULT_TIMEOUT)
    )


def _max_elapsed(value: float | None = None) -> float:
    return float(
        value
        if value is not None
        else _float_env("SEARCH_OPENAI_MAX_ELAPSED", DEFAULT_MAX_ELAPSED)
    )


def _answer_format(value: str | None = None) -> str:
    return (
        (value or _env("SEARCH_OPENAI_ANSWER_FORMAT") or DEFAULT_ANSWER_FORMAT)
        .strip()
        .lower()
    )


def _decode_response(raw: bytes) -> Any:
    text = raw.decode("utf-8", "replace")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return text


def _redact_value(value: Any, secret: str) -> Any:
    """递归脱敏，避免错误详情中意外回显 key。"""

    if isinstance(value, str):
        return (
            value.replace(secret, "<redacted-search-openai-key>") if secret else value
        )
    if isinstance(value, list):
        return [_redact_value(item, secret) for item in value]
    if isinstance(value, dict):
        redacted: dict[str, Any] = {}
        for key, item in value.items():
            if str(key).lower() in {"authorization", "api_key", "api-key", "key"}:
                redacted[key] = "<redacted-search-openai-key>"
            else:
                redacted[key] = _redact_value(item, secret)
        return redacted
    return value


def _clean_answer(text: str) -> str:
    """剔除常见显式思考块，并整理空白。"""

    cleaned = _THINK_BLOCK_RE.sub("", text)
    cleaned = _FENCED_THINK_RE.sub("", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


def build_user_prompt(
    query: str,
    *,
    answer_format: str = DEFAULT_ANSWER_FORMAT,
    platform: str | None = None,
    prompt_template: str | None = None,
) -> str:
    """构造搜索提示词。注意：该提示词用于 user message，不伪装为 system。"""

    template = (
        prompt_template or _env("SEARCH_OPENAI_SEARCH_PROMPT") or SEARCH_PROMPT_TEMPLATE
    )
    return template.format(
        query=query,
        answer_format=answer_format,
        platform=(platform or "").strip(),
        platform_section=_platform_section(platform),
        time_context=get_local_time_info(),
    )


def _json_or_none(value: str | None) -> dict[str, Any] | None:
    if not value:
        return None
    return json.loads(value)


def _append_delta_content(delta: dict[str, Any], parts: list[str]) -> None:
    """只收集正式回答内容，显式忽略 reasoning/thinking 字段。"""

    content = delta.get("content")
    if isinstance(content, str):
        parts.append(content)
    elif isinstance(content, list):
        for item in content:
            if isinstance(item, dict):
                text = item.get("text")
                if isinstance(text, str):
                    parts.append(text)
            elif isinstance(item, str):
                parts.append(item)


def collect_stream(
    lines: Iterable[bytes], *, started: float | None = None, max_elapsed: float = 0.0
) -> dict[str, Any]:
    """收集 SSE 流式响应，返回完整内容与元信息。

    `max_elapsed <= 0` 表示不设置硬上限；socket timeout 由 urllib 作为空闲超时控制，
    因此只要服务端持续输出 chunk，就会自然延长等待。
    """

    started_at = time.monotonic() if started is None else started
    content_parts: list[str] = []
    usage: Any = None
    model: str | None = None
    finish_reason: str | None = None
    chunk_count = 0
    ignored_reasoning = False
    parse_errors: list[str] = []

    for raw_line in lines:
        if max_elapsed > 0 and time.monotonic() - started_at > max_elapsed:
            raise ServiceError(f"OpenAI Chat 流式响应超过硬上限 {max_elapsed:g} 秒")
        line = raw_line.decode("utf-8", "replace").strip()
        if not line or line.startswith(":"):
            continue
        if not line.startswith("data:"):
            continue
        payload = line[5:].strip()
        if payload == "[DONE]":
            break
        try:
            event = json.loads(payload)
        except json.JSONDecodeError as exc:
            parse_errors.append(str(exc))
            continue
        chunk_count += 1
        if usage is None and event.get("usage") is not None:
            usage = event.get("usage")
        if model is None and isinstance(event.get("model"), str):
            model = event.get("model")
        for choice in event.get("choices") or []:
            if not isinstance(choice, dict):
                continue
            if choice.get("finish_reason") is not None:
                finish_reason = choice.get("finish_reason")
            delta = choice.get("delta") or {}
            if isinstance(delta, dict):
                if any(
                    key in delta
                    for key in (
                        "reasoning_content",
                        "reasoning",
                        "thinking",
                        "reasoning_details",
                    )
                ):
                    ignored_reasoning = True
                _append_delta_content(delta, content_parts)
            message = choice.get("message") or {}
            if isinstance(message, dict):
                if any(
                    key in message
                    for key in (
                        "reasoning_content",
                        "reasoning",
                        "thinking",
                        "reasoning_details",
                    )
                ):
                    ignored_reasoning = True
                _append_delta_content(message, content_parts)

    return {
        "answer": _clean_answer("".join(content_parts)),
        "model": model,
        "finishReason": finish_reason,
        "usage": usage,
        "chunkCount": chunk_count,
        "ignoredReasoning": ignored_reasoning,
        "parseErrors": parse_errors,
    }


def _build_body(
    query: str,
    *,
    model: str,
    answer_format: str,
    platform: str | None = None,
    system_prompt: str | None = None,
    thinking_effort: str | None = None,
    thinking_field: str | None = None,
    max_tokens: int | None = None,
    temperature: float | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    messages: list[dict[str, str]] = []
    if system_prompt:
        # 只有用户显式提供 system prompt 时才发送；默认搜索提示词始终放在 user message。
        messages.append({"role": "system", "content": system_prompt})
    messages.append(
        {
            "role": "user",
            "content": build_user_prompt(query, answer_format=answer_format, platform=platform),
        }
    )

    body: dict[str, Any] = {"model": model, "messages": messages, "stream": True}
    effort = thinking_effort or _env("SEARCH_OPENAI_THINKING_EFFORT")
    field = (
        thinking_field
        if thinking_field is not None
        else (_env("SEARCH_OPENAI_THINKING_FIELD") or "reasoning_effort")
    )
    if effort and field:
        body[field] = effort
    if max_tokens is not None:
        body["max_tokens"] = max_tokens
    if temperature is not None:
        body["temperature"] = temperature
    if _bool_env("SEARCH_OPENAI_STREAM_INCLUDE_USAGE", False):
        body["stream_options"] = {"include_usage": True}
    if extra:
        body.update(extra)
    return body


def request(
    query: str,
    *,
    model: str | None = None,
    base_url: str | None = None,
    answer_format: str | None = None,
    platform: str | None = None,
    system_prompt: str | None = None,
    thinking_effort: str | None = None,
    thinking_field: str | None = None,
    max_tokens: int | None = None,
    temperature: float | None = None,
    timeout: float | None = None,
    max_elapsed: float | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    key = _api_key()
    resolved_model = _model(model)
    resolved_base_url = _base_url(base_url)
    resolved_answer_format = _answer_format(answer_format)
    resolved_timeout = _timeout(timeout)
    resolved_max_elapsed = _max_elapsed(max_elapsed)
    body = _build_body(
        query,
        model=resolved_model,
        answer_format=resolved_answer_format,
        platform=platform,
        system_prompt=system_prompt,
        thinking_effort=thinking_effort,
        thinking_field=thinking_field,
        max_tokens=max_tokens,
        temperature=temperature,
        extra=extra,
    )

    url = _chat_completions_url(resolved_base_url)
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        "User-Agent": "pi-search-services-skill/1.0",
    }
    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    started = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=resolved_timeout) as resp:
            collected = collect_stream(
                resp, started=started, max_elapsed=resolved_max_elapsed
            )
            if not collected["answer"]:
                raise ServiceError(
                    "OpenAI Chat 返回为空",
                    status=getattr(resp, "status", None),
                    details={
                        "chunkCount": collected["chunkCount"],
                        "parseErrors": collected["parseErrors"],
                    },
                )
            return {
                "ok": True,
                "service": "openai-chat",
                "status": getattr(resp, "status", None),
                "data": {
                    "answer": collected["answer"],
                    "answerFormat": resolved_answer_format,
                    "model": collected["model"] or resolved_model,
                    "finishReason": collected["finishReason"],
                    "usage": collected["usage"],
                    "stream": True,
                    "chunkCount": collected["chunkCount"],
                    "ignoredReasoning": collected["ignoredReasoning"],
                    "parseErrors": collected["parseErrors"],
                },
                "elapsedSeconds": round(time.monotonic() - started, 3),
            }
    except urllib.error.HTTPError as exc:
        details = _redact_value(_decode_response(exc.read()), key)
        raise ServiceError(
            f"OpenAI Chat HTTP {exc.code}", status=exc.code, details=details
        ) from exc
    except urllib.error.URLError as exc:
        raise ServiceError(
            f"OpenAI Chat 网络错误: {exc.reason}", details=_redact_value(str(exc), key)
        ) from exc
    except TimeoutError as exc:
        raise ServiceError(
            f"OpenAI Chat 空闲超时: {resolved_timeout:g} 秒内未收到新数据",
            details=str(exc),
        ) from exc


def search(query: str, **kwargs: Any) -> dict[str, Any]:
    """对外搜索接口，保持输入 query、输出结构化结果。"""

    return request(query, **kwargs)


def _print_json(value: Any) -> None:
    print(json.dumps(value, ensure_ascii=False, indent=2))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="OpenAI-compatible Chat Completions search helper"
    )
    sub = parser.add_subparsers(dest="operation", required=True)

    p = sub.add_parser(
        "search", help="通过 OpenAI-compatible Chat Completions 生成搜索式回答"
    )
    p.add_argument("--query", required=True)
    p.add_argument("--model", help="模型名；也可用 SEARCH_OPENAI_MODEL，未配置则失败")
    p.add_argument(
        "--base-url",
        help="OpenAI-compatible base URL；默认 SEARCH_OPENAI_BASE_URL 或 https://api.openai.com/v1",
    )
    p.add_argument(
        "--thinking-effort",
        choices=["low", "medium", "high"],
        help="思考程度；会写入 thinking 字段，字段名默认 reasoning_effort",
    )
    p.add_argument(
        "--thinking-field",
        help="思考程度请求字段名；默认 SEARCH_OPENAI_THINKING_FIELD 或 reasoning_effort；传空字符串可禁用",
    )
    p.add_argument(
        "--answer-format",
        default=None,
        choices=["markdown", "text", "json"],
        help="回答格式；默认 SEARCH_OPENAI_ANSWER_FORMAT 或 markdown",
    )
    p.add_argument("--platform", help="优先关注的平台、站点或来源类型；会写入 user message")
    p.add_argument(
        "--system-prompt",
        help="仅当用户显式需要时才发送的真实 system prompt；默认搜索提示词不会放在 system role",
    )
    p.add_argument("--max-tokens", type=int)
    p.add_argument("--temperature", type=float)
    p.add_argument(
        "--timeout",
        type=float,
        help="连接/空闲超时秒数；持续收到流式 chunk 时会自动延长",
    )
    p.add_argument("--max-elapsed", type=float, help="硬上限秒数；0 表示不设置硬上限")
    p.add_argument("--extra-json", help="合并到请求体的额外 JSON")

    args = parser.parse_args(argv)
    try:
        if args.operation == "search":
            out = search(
                args.query,
                model=args.model,
                base_url=args.base_url,
                answer_format=args.answer_format,
                platform=args.platform,
                system_prompt=args.system_prompt,
                thinking_effort=args.thinking_effort,
                thinking_field=args.thinking_field,
                max_tokens=args.max_tokens,
                temperature=args.temperature,
                timeout=args.timeout,
                max_elapsed=args.max_elapsed,
                extra=_json_or_none(args.extra_json),
            )
        else:
            parser.error("未知操作")
            return 2
        _print_json(out)
        return 0
    except ServiceError as exc:
        _print_json(
            {
                "ok": False,
                "service": "openai-chat",
                "error": str(exc),
                "status": exc.status,
                "details": exc.details,
            }
        )
        return 1


if __name__ == "__main__":
    sys.exit(main())
