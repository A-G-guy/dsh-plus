#!/usr/bin/env python3
"""Tavily REST API helper.

不使用 MCP，仅通过 Tavily HTTP API 执行搜索、提取、爬取、映射和研究任务。
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, Optional

from env_loader import load_env_file

load_env_file()


class ServiceError(RuntimeError):
    """服务调用失败。"""

    def __init__(
        self,
        message: str,
        *,
        status: Optional[int] = None,
        details: Any = None,
        key_attempts: Optional[list[Dict[str, Any]]] = None,
    ):
        super().__init__(message)
        self.status = status
        self.details = details
        self.key_attempts = key_attempts or []


class MissingAPIKey(ServiceError):
    """缺少 API Key。"""


DEFAULT_BASE_URL = "https://api.tavily.com"


def _timeout() -> float:
    return float(os.getenv("SEARCH_TIMEOUT") or os.getenv("TAVILY_TIMEOUT") or "60")


def _base_url() -> str:
    return (os.getenv("TAVILY_BASE_URL") or DEFAULT_BASE_URL).rstrip("/")


def _split_key_list(value: str) -> list[str]:
    """解析逗号/分号/换行分隔的 key 列表，保持顺序。"""

    return [part.strip() for part in re.split(r"[,;\n]+", value or "") if part.strip()]


def _api_keys() -> list[tuple[str, str]]:
    """返回按优先级排序的 Tavily key。

    优先级：
    1. TAVILY_API_KEYS 中的显式顺序
    2. TAVILY_API_KEY_0、TAVILY_API_KEY_1 ... 的数字顺序
    3. TAVILY_API_KEY 兼容单 key 配置
    """

    candidates: list[tuple[str, str]] = []

    for index, key in enumerate(_split_key_list(os.getenv("TAVILY_API_KEYS", "")), start=1):
        candidates.append((f"TAVILY_API_KEYS[{index}]", key))

    numbered: list[tuple[int, str, str]] = []
    for name, value in os.environ.items():
        match = re.fullmatch(r"TAVILY_API_KEY_(\d+)", name)
        if match and value.strip():
            numbered.append((int(match.group(1)), name, value.strip()))
    for _, name, key in sorted(numbered):
        candidates.append((name, key))

    legacy_key = os.getenv("TAVILY_API_KEY", "").strip()
    if legacy_key:
        candidates.append(("TAVILY_API_KEY", legacy_key))

    deduped: list[tuple[str, str]] = []
    seen: set[str] = set()
    for label, key in candidates:
        if key in seen:
            continue
        seen.add(key)
        deduped.append((label, key))

    if not deduped:
        raise MissingAPIKey("缺少 Tavily API key：请设置 TAVILY_API_KEYS、TAVILY_API_KEY_0... 或 TAVILY_API_KEY")
    return deduped


def _redact_value(value: Any, keys: list[tuple[str, str]]) -> Any:
    """递归脱敏，避免错误详情中意外回显 key。"""

    if isinstance(value, str):
        redacted = value
        for _, key in keys:
            if key:
                redacted = redacted.replace(key, "<redacted-tavily-key>")
        return redacted
    if isinstance(value, list):
        return [_redact_value(item, keys) for item in value]
    if isinstance(value, dict):
        return {k: _redact_value(v, keys) for k, v in value.items()}
    return value


def _should_try_next_key(status: Optional[int]) -> bool:
    """这些状态通常与 key、额度或限流相关，可尝试下一个 key。"""

    return status in {401, 402, 429, 432, 433}


def _decode_response(raw: bytes) -> Any:
    text = raw.decode("utf-8", "replace")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return text


def request(path: str, *, body: Optional[Dict[str, Any]] = None, method: str = "POST", timeout: Optional[float] = None) -> Dict[str, Any]:
    url = f"{_base_url()}{path}"
    keys = _api_keys()
    data = None
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")

    attempts: list[Dict[str, Any]] = []
    last_error: Optional[ServiceError] = None
    for key_index, (key_label, key) in enumerate(keys, start=1):
        headers = {
            "Authorization": f"Bearer {key}",
            "Accept": "application/json",
            "User-Agent": "pi-search-services-skill/1.0",
        }
        if body is not None:
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=data, headers=headers, method=method.upper())
        try:
            with urllib.request.urlopen(req, timeout=timeout if timeout is not None else _timeout()) as resp:
                parsed = _decode_response(resp.read())
                result: Dict[str, Any] = {
                    "ok": True,
                    "service": "tavily",
                    "status": resp.status,
                    "data": _redact_value(parsed, keys),
                    "keyLabel": key_label,
                    "keyIndex": key_index,
                }
                if attempts:
                    result["keyFallbackAttempts"] = attempts
                return result
        except urllib.error.HTTPError as exc:
            details = _redact_value(_decode_response(exc.read()), keys)
            attempt = {"keyLabel": key_label, "keyIndex": key_index, "status": exc.code, "error": f"Tavily HTTP {exc.code}"}
            attempts.append(attempt)
            last_error = ServiceError(f"Tavily HTTP {exc.code}", status=exc.code, details=details, key_attempts=attempts.copy())
            if _should_try_next_key(exc.code) and key_index < len(keys):
                continue
            raise last_error from exc
        except urllib.error.URLError as exc:
            details = _redact_value(str(exc), keys)
            attempt = {"keyLabel": key_label, "keyIndex": key_index, "status": None, "error": f"Tavily 网络错误: {exc.reason}"}
            attempts.append(attempt)
            last_error = ServiceError(f"Tavily 网络错误: {exc.reason}", details=details, key_attempts=attempts.copy())
            # 网络错误通常与 key 无关，直接抛出，避免重复消耗请求。
            raise last_error from exc

    if last_error is not None:
        raise last_error
    raise MissingAPIKey("缺少 Tavily API key：请设置 TAVILY_API_KEYS、TAVILY_API_KEY_0... 或 TAVILY_API_KEY")


def search(
    query: str,
    *,
    search_depth: str = "basic",
    max_results: int = 5,
    topic: str = "general",
    time_range: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    include_answer: Any = False,
    include_raw_content: Any = False,
    include_images: bool = False,
    include_image_descriptions: bool = False,
    include_favicon: bool = False,
    include_domains: Optional[list[str]] = None,
    exclude_domains: Optional[list[str]] = None,
    country: Optional[str] = None,
    chunks_per_source: Optional[int] = None,
    auto_parameters: bool = False,
    exact_match: bool = False,
    include_usage: bool = False,
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    body: Dict[str, Any] = {
        "query": query,
        "search_depth": search_depth,
        "max_results": max_results,
        "topic": topic,
        "include_answer": include_answer,
        "include_raw_content": include_raw_content,
        "include_images": include_images,
        "include_image_descriptions": include_image_descriptions,
        "include_favicon": include_favicon,
        "auto_parameters": auto_parameters,
        "exact_match": exact_match,
        "include_usage": include_usage,
    }
    optional = {
        "time_range": time_range,
        "start_date": start_date,
        "end_date": end_date,
        "include_domains": include_domains,
        "exclude_domains": exclude_domains,
        "country": country,
        "chunks_per_source": chunks_per_source,
    }
    body.update({k: v for k, v in optional.items() if v is not None})
    if extra:
        body.update(extra)
    return request("/search", body=body)


def extract(
    urls: list[str] | str,
    *,
    query: Optional[str] = None,
    chunks_per_source: Optional[int] = None,
    extract_depth: str = "basic",
    include_images: bool = False,
    include_favicon: bool = False,
    fmt: str = "markdown",
    timeout: Optional[float] = None,
    http_timeout: Optional[float] = None,
    include_usage: bool = False,
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    body: Dict[str, Any] = {
        "urls": urls,
        "extract_depth": extract_depth,
        "include_images": include_images,
        "include_favicon": include_favicon,
        "format": fmt,
        "include_usage": include_usage,
    }
    optional = {"query": query, "chunks_per_source": chunks_per_source, "timeout": timeout}
    body.update({k: v for k, v in optional.items() if v is not None})
    if extra:
        body.update(extra)
    return request("/extract", body=body, timeout=http_timeout)


def crawl(
    url: str,
    *,
    instructions: Optional[str] = None,
    chunks_per_source: Optional[int] = None,
    max_depth: int = 1,
    max_breadth: int = 20,
    limit: int = 50,
    select_paths: Optional[list[str]] = None,
    select_domains: Optional[list[str]] = None,
    exclude_paths: Optional[list[str]] = None,
    exclude_domains: Optional[list[str]] = None,
    allow_external: bool = False,
    include_images: bool = False,
    extract_depth: str = "basic",
    fmt: str = "markdown",
    include_favicon: bool = False,
    timeout: Optional[float] = None,
    include_usage: bool = False,
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    body: Dict[str, Any] = {
        "url": url,
        "max_depth": max_depth,
        "max_breadth": max_breadth,
        "limit": limit,
        "allow_external": allow_external,
        "include_images": include_images,
        "extract_depth": extract_depth,
        "format": fmt,
        "include_favicon": include_favicon,
        "include_usage": include_usage,
    }
    optional = {
        "instructions": instructions,
        "chunks_per_source": chunks_per_source,
        "select_paths": select_paths,
        "select_domains": select_domains,
        "exclude_paths": exclude_paths,
        "exclude_domains": exclude_domains,
        "timeout": timeout,
    }
    body.update({k: v for k, v in optional.items() if v is not None})
    if extra:
        body.update(extra)
    return request("/crawl", body=body)


def map_site(
    url: str,
    *,
    instructions: Optional[str] = None,
    max_depth: int = 1,
    max_breadth: int = 20,
    limit: int = 50,
    select_paths: Optional[list[str]] = None,
    select_domains: Optional[list[str]] = None,
    exclude_paths: Optional[list[str]] = None,
    exclude_domains: Optional[list[str]] = None,
    allow_external: bool = True,
    timeout: Optional[float] = None,
    include_usage: bool = False,
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    body: Dict[str, Any] = {
        "url": url,
        "max_depth": max_depth,
        "max_breadth": max_breadth,
        "limit": limit,
        "allow_external": allow_external,
        "include_usage": include_usage,
    }
    optional = {
        "instructions": instructions,
        "select_paths": select_paths,
        "select_domains": select_domains,
        "exclude_paths": exclude_paths,
        "exclude_domains": exclude_domains,
        "timeout": timeout,
    }
    body.update({k: v for k, v in optional.items() if v is not None})
    if extra:
        body.update(extra)
    return request("/map", body=body)


def research(
    input_text: str,
    *,
    model: str = "auto",
    output_schema: Optional[Dict[str, Any]] = None,
    citation_format: Optional[str] = None,
    include_domains: Optional[list[str]] = None,
    exclude_domains: Optional[list[str]] = None,
    output_length: Optional[str] = None,
    stream: bool = False,
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    body: Dict[str, Any] = {"input": input_text, "model": model, "stream": stream}
    optional = {
        "output_schema": output_schema,
        "citation_format": citation_format,
        "include_domains": include_domains,
        "exclude_domains": exclude_domains,
        "output_length": output_length,
    }
    body.update({k: v for k, v in optional.items() if v is not None})
    if extra:
        body.update(extra)
    return request("/research", body=body)


def research_status(request_id: str) -> Dict[str, Any]:
    safe_id = urllib.parse.quote(request_id, safe="")
    return request(f"/research/{safe_id}", method="GET")


def usage() -> Dict[str, Any]:
    return request("/usage", method="GET")


def raw(path: str, *, method: str = "POST", body_json: Optional[str] = None) -> Dict[str, Any]:
    body = json.loads(body_json) if body_json else None
    return request(path, body=body, method=method)


def _split_csv(value: Optional[str]) -> Optional[list[str]]:
    if not value:
        return None
    return [part.strip() for part in value.split(",") if part.strip()]


def _json_or_none(value: Optional[str]) -> Optional[Dict[str, Any]]:
    if not value:
        return None
    return json.loads(value)


def _json_scalar(value: Optional[str], default: Any) -> Any:
    if value is None:
        return default
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return value


def _print_json(value: Any) -> None:
    print(json.dumps(value, ensure_ascii=False, indent=2))


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Tavily REST API helper")
    sub = parser.add_subparsers(dest="operation", required=True)

    p = sub.add_parser("search", help="Tavily Web Search")
    p.add_argument("--query", required=True)
    p.add_argument("--search-depth", default="basic", choices=["basic", "advanced", "fast", "ultra-fast"])
    p.add_argument("--max-results", type=int, default=5)
    p.add_argument("--topic", default="general", choices=["general", "news", "finance"])
    p.add_argument("--time-range", choices=["day", "week", "month", "year"])
    p.add_argument("--start-date")
    p.add_argument("--end-date")
    p.add_argument("--include-answer-json", help="bool 或 \"basic\"/\"advanced\" 的 JSON")
    p.add_argument("--include-raw-content-json", help="bool 或 \"markdown\"/\"text\" 的 JSON")
    p.add_argument("--include-images", action="store_true")
    p.add_argument("--include-image-descriptions", action="store_true")
    p.add_argument("--include-favicon", action="store_true")
    p.add_argument("--include-domains", help="逗号分隔")
    p.add_argument("--exclude-domains", help="逗号分隔")
    p.add_argument("--country")
    p.add_argument("--chunks-per-source", type=int)
    p.add_argument("--auto-parameters", action="store_true")
    p.add_argument("--exact-match", action="store_true")
    p.add_argument("--include-usage", action="store_true")
    p.add_argument("--extra-json")

    p = sub.add_parser("extract", help="Tavily Extract")
    p.add_argument("--urls", required=True, help="逗号分隔 URL")
    p.add_argument("--query")
    p.add_argument("--chunks-per-source", type=int)
    p.add_argument("--extract-depth", default="basic", choices=["basic", "advanced"])
    p.add_argument("--include-images", action="store_true")
    p.add_argument("--include-favicon", action="store_true")
    p.add_argument("--format", dest="fmt", default="markdown", choices=["markdown", "text"])
    p.add_argument("--timeout", type=float)
    p.add_argument("--include-usage", action="store_true")
    p.add_argument("--extra-json")

    for name, help_text in [("crawl", "Tavily Crawl"), ("map", "Tavily Map")]:
        p = sub.add_parser(name, help=help_text)
        p.add_argument("--url", required=True)
        p.add_argument("--instructions")
        p.add_argument("--max-depth", type=int, default=1)
        p.add_argument("--max-breadth", type=int, default=20)
        p.add_argument("--limit", type=int, default=50)
        p.add_argument("--select-paths", help="逗号分隔 regex")
        p.add_argument("--select-domains", help="逗号分隔 regex")
        p.add_argument("--exclude-paths", help="逗号分隔 regex")
        p.add_argument("--exclude-domains", help="逗号分隔 regex")
        p.add_argument("--allow-external", action="store_true")
        p.add_argument("--timeout", type=float)
        p.add_argument("--include-usage", action="store_true")
        p.add_argument("--extra-json")
        if name == "crawl":
            p.add_argument("--chunks-per-source", type=int)
            p.add_argument("--include-images", action="store_true")
            p.add_argument("--extract-depth", default="basic", choices=["basic", "advanced"])
            p.add_argument("--format", dest="fmt", default="markdown", choices=["markdown", "text"])
            p.add_argument("--include-favicon", action="store_true")

    p = sub.add_parser("research", help="创建 Tavily Research 任务")
    p.add_argument("--input", "--query", dest="input_text", required=True)
    p.add_argument("--model", default="auto", choices=["mini", "pro", "auto"])
    p.add_argument("--output-schema-json")
    p.add_argument("--citation-format")
    p.add_argument("--include-domains", help="逗号分隔")
    p.add_argument("--exclude-domains", help="逗号分隔")
    p.add_argument("--output-length")
    p.add_argument("--stream", action="store_true")
    p.add_argument("--extra-json")

    p = sub.add_parser("research-status", help="获取研究任务状态")
    p.add_argument("--request-id", required=True)

    sub.add_parser("usage", help="查询用量")

    p = sub.add_parser("raw", help="原始 Tavily API 调用")
    p.add_argument("--path", required=True)
    p.add_argument("--method", default="POST")
    p.add_argument("--body-json")

    args = parser.parse_args(argv)
    try:
        if args.operation == "search":
            out = search(
                args.query,
                search_depth=args.search_depth,
                max_results=args.max_results,
                topic=args.topic,
                time_range=args.time_range,
                start_date=args.start_date,
                end_date=args.end_date,
                include_answer=_json_scalar(args.include_answer_json, False),
                include_raw_content=_json_scalar(args.include_raw_content_json, False),
                include_images=args.include_images,
                include_image_descriptions=args.include_image_descriptions,
                include_favicon=args.include_favicon,
                include_domains=_split_csv(args.include_domains),
                exclude_domains=_split_csv(args.exclude_domains),
                country=args.country,
                chunks_per_source=args.chunks_per_source,
                auto_parameters=args.auto_parameters,
                exact_match=args.exact_match,
                include_usage=args.include_usage,
                extra=_json_or_none(args.extra_json),
            )
        elif args.operation == "extract":
            urls = _split_csv(args.urls) or []
            out = extract(
                urls[0] if len(urls) == 1 else urls,
                query=args.query,
                chunks_per_source=args.chunks_per_source,
                extract_depth=args.extract_depth,
                include_images=args.include_images,
                include_favicon=args.include_favicon,
                fmt=args.fmt,
                timeout=args.timeout,
                include_usage=args.include_usage,
                extra=_json_or_none(args.extra_json),
            )
        elif args.operation == "crawl":
            out = crawl(
                args.url,
                instructions=args.instructions,
                chunks_per_source=args.chunks_per_source,
                max_depth=args.max_depth,
                max_breadth=args.max_breadth,
                limit=args.limit,
                select_paths=_split_csv(args.select_paths),
                select_domains=_split_csv(args.select_domains),
                exclude_paths=_split_csv(args.exclude_paths),
                exclude_domains=_split_csv(args.exclude_domains),
                allow_external=args.allow_external,
                include_images=args.include_images,
                extract_depth=args.extract_depth,
                fmt=args.fmt,
                include_favicon=args.include_favicon,
                timeout=args.timeout,
                include_usage=args.include_usage,
                extra=_json_or_none(args.extra_json),
            )
        elif args.operation == "map":
            out = map_site(
                args.url,
                instructions=args.instructions,
                max_depth=args.max_depth,
                max_breadth=args.max_breadth,
                limit=args.limit,
                select_paths=_split_csv(args.select_paths),
                select_domains=_split_csv(args.select_domains),
                exclude_paths=_split_csv(args.exclude_paths),
                exclude_domains=_split_csv(args.exclude_domains),
                allow_external=args.allow_external,
                timeout=args.timeout,
                include_usage=args.include_usage,
                extra=_json_or_none(args.extra_json),
            )
        elif args.operation == "research":
            out = research(
                args.input_text,
                model=args.model,
                output_schema=_json_or_none(args.output_schema_json),
                citation_format=args.citation_format,
                include_domains=_split_csv(args.include_domains),
                exclude_domains=_split_csv(args.exclude_domains),
                output_length=args.output_length,
                stream=args.stream,
                extra=_json_or_none(args.extra_json),
            )
        elif args.operation == "research-status":
            out = research_status(args.request_id)
        elif args.operation == "usage":
            out = usage()
        elif args.operation == "raw":
            out = raw(args.path, method=args.method, body_json=args.body_json)
        else:
            parser.error("未知操作")
            return 2
        _print_json(out)
        return 0
    except ServiceError as exc:
        _print_json({
            "ok": False,
            "service": "tavily",
            "error": str(exc),
            "status": exc.status,
            "details": exc.details,
            "keyFallbackAttempts": exc.key_attempts,
        })
        return 1


if __name__ == "__main__":
    sys.exit(main())
