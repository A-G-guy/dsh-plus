#!/usr/bin/env python3
"""Exa REST API helper.

不使用 MCP，仅通过 Exa HTTP API 执行语义搜索和内容获取。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from typing import Any, Dict, Optional

from env_loader import load_env_file

load_env_file()


class ServiceError(RuntimeError):
    """服务调用失败。"""

    def __init__(self, message: str, *, status: Optional[int] = None, details: Any = None):
        super().__init__(message)
        self.status = status
        self.details = details


class MissingAPIKey(ServiceError):
    """缺少 API Key。"""


DEFAULT_BASE_URL = "https://api.exa.ai"


def _timeout() -> float:
    return float(os.getenv("SEARCH_TIMEOUT") or os.getenv("EXA_TIMEOUT") or "30")


def _base_url() -> str:
    return (os.getenv("EXA_BASE_URL") or DEFAULT_BASE_URL).rstrip("/")


def _api_key() -> str:
    key = os.getenv("EXA_API_KEY", "").strip()
    if not key:
        raise MissingAPIKey("缺少 EXA_API_KEY")
    return key


def _decode_response(raw: bytes) -> Any:
    text = raw.decode("utf-8", "replace")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return text


def request(path: str, body: Dict[str, Any], *, method: str = "POST", timeout: Optional[float] = None) -> Dict[str, Any]:
    url = f"{_base_url()}{path}"
    headers = {
        "x-api-key": _api_key(),
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "pi-search-services-skill/1.0",
    }
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method.upper())
    try:
        with urllib.request.urlopen(req, timeout=timeout if timeout is not None else _timeout()) as resp:
            parsed = _decode_response(resp.read())
            return {"ok": True, "service": "exa", "status": resp.status, "data": parsed}
    except urllib.error.HTTPError as exc:
        details = _decode_response(exc.read())
        raise ServiceError(f"Exa HTTP {exc.code}", status=exc.code, details=details) from exc
    except urllib.error.URLError as exc:
        raise ServiceError(f"Exa 网络错误: {exc.reason}", details=str(exc)) from exc


def search(
    query: str,
    *,
    search_type: str = "auto",
    num_results: int = 10,
    category: Optional[str] = None,
    include_domains: Optional[list[str]] = None,
    exclude_domains: Optional[list[str]] = None,
    start_published_date: Optional[str] = None,
    end_published_date: Optional[str] = None,
    user_location: Optional[str] = None,
    contents: Optional[Dict[str, Any]] = None,
    output_schema: Optional[Dict[str, Any]] = None,
    system_prompt: Optional[str] = None,
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """调用 Exa /search。REST API 使用 camelCase 参数。"""

    body: Dict[str, Any] = {
        "query": query,
        "type": search_type,
        "numResults": num_results,
    }
    optional = {
        "category": category,
        "includeDomains": include_domains,
        "excludeDomains": exclude_domains,
        "startPublishedDate": start_published_date,
        "endPublishedDate": end_published_date,
        "userLocation": user_location,
        "contents": contents if contents is not None else {"highlights": True},
        "outputSchema": output_schema,
        "systemPrompt": system_prompt,
    }
    body.update({k: v for k, v in optional.items() if v is not None})
    if extra:
        body.update(extra)
    return request("/search", body)


def contents(
    ids: list[str],
    *,
    text: Any = True,
    highlights: Any = None,
    summary: Any = None,
    extra: Optional[Dict[str, Any]] = None,
    timeout: Optional[float] = None,
) -> Dict[str, Any]:
    """调用 Exa /contents。

    Exa 搜索结果 id 通常就是 URL。/contents 与 /search 不同：text/highlights/summary 是顶层参数。
    """

    body: Dict[str, Any] = {"ids": ids}
    if text is not None:
        body["text"] = text
    if highlights is not None:
        body["highlights"] = highlights
    if summary is not None:
        body["summary"] = summary
    if extra:
        body.update(extra)
    return request("/contents", body, timeout=timeout)


def raw(path: str, *, body_json: str, method: str = "POST") -> Dict[str, Any]:
    return request(path, json.loads(body_json), method=method)


def _split_csv(value: Optional[str]) -> Optional[list[str]]:
    if not value:
        return None
    return [part.strip() for part in value.split(",") if part.strip()]


def _json_or_none(value: Optional[str]) -> Optional[Dict[str, Any]]:
    if not value:
        return None
    return json.loads(value)


def _print_json(value: Any) -> None:
    print(json.dumps(value, ensure_ascii=False, indent=2))


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Exa REST API helper")
    sub = parser.add_subparsers(dest="operation", required=True)

    p = sub.add_parser("search", help="Exa 语义搜索")
    p.add_argument("--query", required=True)
    p.add_argument("--type", default="auto", choices=["auto", "fast", "instant", "deep-lite", "deep", "deep-reasoning"])
    p.add_argument("--num-results", type=int, default=10)
    p.add_argument("--category")
    p.add_argument("--include-domains", help="逗号分隔")
    p.add_argument("--exclude-domains", help="逗号分隔")
    p.add_argument("--start-published-date")
    p.add_argument("--end-published-date")
    p.add_argument("--user-location")
    p.add_argument("--contents-json", help="完整 contents JSON；默认 {\"highlights\": true}")
    p.add_argument("--text", action="store_true", help="请求 contents.text")
    p.add_argument("--summary", action="store_true", help="请求 contents.summary")
    p.add_argument("--fresh", action="store_true", help="设置 contents.maxAgeHours=0 强制实时抓取")
    p.add_argument("--output-schema-json")
    p.add_argument("--system-prompt")
    p.add_argument("--extra-json", help="合并到请求体的额外 JSON")

    p = sub.add_parser("contents", help="按 URL/ID 获取内容")
    p.add_argument("--ids", required=True, help="逗号分隔 URL 或 Exa result id")
    p.add_argument("--text-json", help="text 顶层参数 JSON；未提供则为 true")
    p.add_argument("--highlights-json")
    p.add_argument("--summary-json")
    p.add_argument("--extra-json")

    p = sub.add_parser("raw", help="原始 Exa API 调用")
    p.add_argument("--path", required=True)
    p.add_argument("--method", default="POST")
    p.add_argument("--body-json", required=True)

    args = parser.parse_args(argv)
    try:
        if args.operation == "search":
            contents_value = _json_or_none(args.contents_json)
            if contents_value is None:
                contents_value = {"highlights": True}
                if args.text:
                    contents_value["text"] = {"maxCharacters": 8000}
                if args.summary:
                    contents_value["summary"] = True
                if args.fresh:
                    contents_value["maxAgeHours"] = 0
            out = search(
                args.query,
                search_type=args.type,
                num_results=args.num_results,
                category=args.category,
                include_domains=_split_csv(args.include_domains),
                exclude_domains=_split_csv(args.exclude_domains),
                start_published_date=args.start_published_date,
                end_published_date=args.end_published_date,
                user_location=args.user_location,
                contents=contents_value,
                output_schema=_json_or_none(args.output_schema_json),
                system_prompt=args.system_prompt,
                extra=_json_or_none(args.extra_json),
            )
        elif args.operation == "contents":
            text_value = json.loads(args.text_json) if args.text_json else True
            out = contents(
                _split_csv(args.ids) or [],
                text=text_value,
                highlights=json.loads(args.highlights_json) if args.highlights_json else None,
                summary=json.loads(args.summary_json) if args.summary_json else None,
                extra=_json_or_none(args.extra_json),
            )
        elif args.operation == "raw":
            out = raw(args.path, body_json=args.body_json, method=args.method)
        else:
            parser.error("未知操作")
            return 2
        _print_json(out)
        return 0
    except ServiceError as exc:
        _print_json({"ok": False, "service": "exa", "error": str(exc), "status": exc.status, "details": exc.details})
        return 1


if __name__ == "__main__":
    sys.exit(main())
