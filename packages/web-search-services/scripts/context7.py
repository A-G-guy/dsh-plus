#!/usr/bin/env python3
"""Context7 REST API helper.

不使用 MCP，仅通过 Context7 HTTP API 获取库文档、代码片段和相关上下文。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
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


DEFAULT_BASE_URL = "https://context7.com/api"


def _timeout() -> float:
    return float(os.getenv("SEARCH_TIMEOUT") or os.getenv("CONTEXT7_TIMEOUT") or "30")


def _base_url() -> str:
    return (os.getenv("CONTEXT7_BASE_URL") or DEFAULT_BASE_URL).rstrip("/")


def _api_key() -> str:
    key = os.getenv("CONTEXT7_API_KEY", "").strip()
    if not key:
        raise MissingAPIKey("缺少 CONTEXT7_API_KEY")
    return key


def _decode_response(raw: bytes) -> Any:
    text = raw.decode("utf-8", "replace")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return text


def request(
    method: str,
    path: str,
    *,
    params: Optional[Dict[str, Any]] = None,
    body: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """调用 Context7 API，返回带元信息的 JSON。"""

    query = urllib.parse.urlencode({k: v for k, v in (params or {}).items() if v is not None})
    url = f"{_base_url()}{path}"
    if query:
        url = f"{url}?{query}"

    headers = {
        "Authorization": f"Bearer {_api_key()}",
        "Accept": "application/json",
        "User-Agent": "pi-search-services-skill/1.0",
    }
    data = None
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"

    req = urllib.request.Request(url, data=data, headers=headers, method=method.upper())
    try:
        with urllib.request.urlopen(req, timeout=_timeout()) as resp:
            parsed = _decode_response(resp.read())
            return {"ok": True, "service": "context7", "status": resp.status, "data": parsed}
    except urllib.error.HTTPError as exc:
        details = _decode_response(exc.read())
        raise ServiceError(f"Context7 HTTP {exc.code}", status=exc.code, details=details) from exc
    except urllib.error.URLError as exc:
        raise ServiceError(f"Context7 网络错误: {exc.reason}", details=str(exc)) from exc


def search_libraries(library_name: str, query: Optional[str] = None, fast: bool = False) -> Dict[str, Any]:
    """搜索 Context7 库 ID。"""

    return request(
        "GET",
        "/v2/libs/search",
        params={"libraryName": library_name, "query": query, "fast": str(fast).lower() if fast else None},
    )


def get_context(
    library_id: str,
    query: str,
    *,
    response_type: str = "json",
    fast: bool = False,
) -> Dict[str, Any]:
    """获取某个库的文档上下文。"""

    return request(
        "GET",
        "/v2/context",
        params={
            "libraryId": library_id,
            "query": query,
            "type": response_type,
            "fast": str(fast).lower() if fast else None,
        },
    )


def lookup(
    library: str,
    query: str,
    *,
    response_type: str = "json",
    fast: bool = False,
) -> Dict[str, Any]:
    """先解析库 ID，再获取文档上下文。library 可为 /owner/repo 或库名。"""

    if library.startswith("/"):
        library_id = library
        search_result = None
    else:
        search_result = search_libraries(library, query=query, fast=fast)
        results = (search_result.get("data") or {}).get("results") or []
        if not results:
            raise ServiceError("Context7 未找到匹配库", status=404, details=search_result.get("data"))
        library_id = results[0].get("id")
        if not library_id:
            raise ServiceError("Context7 搜索结果缺少 library id", details=results[0])

    context = get_context(library_id, query, response_type=response_type, fast=fast)
    context["resolvedLibraryId"] = library_id
    if search_result is not None:
        context["librarySearch"] = search_result.get("data")
    return context


def refresh(library_name: str, *, branch: Optional[str] = None, git_token: Optional[str] = None) -> Dict[str, Any]:
    body: Dict[str, Any] = {"libraryName": library_name}
    if branch:
        body["branch"] = branch
    if git_token:
        body["gitToken"] = git_token
    return request("POST", "/v1/refresh", body=body)


def add_website(website_url: str) -> Dict[str, Any]:
    return request("POST", "/v2/add/website", body={"websiteUrl": website_url})


def add_llmstxt(llmstxt_url: str) -> Dict[str, Any]:
    return request("POST", "/v2/add/llmstxt", body={"llmstxtUrl": llmstxt_url})


def add_openapi(openapi_url: str) -> Dict[str, Any]:
    return request("POST", "/v2/add/openapi", body={"openApiUrl": openapi_url})


def raw(method: str, path: str, *, params_json: Optional[str] = None, body_json: Optional[str] = None) -> Dict[str, Any]:
    params = json.loads(params_json) if params_json else None
    body = json.loads(body_json) if body_json else None
    return request(method, path, params=params, body=body)


def _print_json(value: Any) -> None:
    print(json.dumps(value, ensure_ascii=False, indent=2))


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Context7 REST API helper")
    sub = parser.add_subparsers(dest="operation", required=True)

    p = sub.add_parser("search-libraries", help="搜索库 ID")
    p.add_argument("--library", "--library-name", dest="library", required=True)
    p.add_argument("--query")
    p.add_argument("--fast", action="store_true")

    p = sub.add_parser("context", help="获取文档上下文")
    p.add_argument("--library-id", required=True)
    p.add_argument("--query", required=True)
    p.add_argument("--type", default="json")
    p.add_argument("--fast", action="store_true")

    p = sub.add_parser("lookup", help="按库名/库 ID 查询文档上下文")
    p.add_argument("--library", required=True)
    p.add_argument("--query", required=True)
    p.add_argument("--type", default="json")
    p.add_argument("--fast", action="store_true")

    p = sub.add_parser("refresh", help="刷新库文档")
    p.add_argument("--library-name", required=True)
    p.add_argument("--branch")
    p.add_argument("--git-token-env", help="从指定环境变量读取 gitToken")

    p = sub.add_parser("add-website", help="提交网站文档源")
    p.add_argument("--url", required=True)

    p = sub.add_parser("add-llmstxt", help="提交 llms.txt 文档源")
    p.add_argument("--url", required=True)

    p = sub.add_parser("add-openapi", help="提交 OpenAPI 文档源")
    p.add_argument("--url", required=True)

    p = sub.add_parser("raw", help="原始 Context7 API 调用")
    p.add_argument("--method", required=True)
    p.add_argument("--path", required=True)
    p.add_argument("--params-json")
    p.add_argument("--body-json")

    args = parser.parse_args(argv)
    try:
        if args.operation == "search-libraries":
            out = search_libraries(args.library, query=args.query, fast=args.fast)
        elif args.operation == "context":
            out = get_context(args.library_id, args.query, response_type=args.type, fast=args.fast)
        elif args.operation == "lookup":
            out = lookup(args.library, args.query, response_type=args.type, fast=args.fast)
        elif args.operation == "refresh":
            git_token = os.getenv(args.git_token_env, "") if args.git_token_env else None
            out = refresh(args.library_name, branch=args.branch, git_token=git_token)
        elif args.operation == "add-website":
            out = add_website(args.url)
        elif args.operation == "add-llmstxt":
            out = add_llmstxt(args.url)
        elif args.operation == "add-openapi":
            out = add_openapi(args.url)
        elif args.operation == "raw":
            out = raw(args.method, args.path, params_json=args.params_json, body_json=args.body_json)
        else:
            parser.error("未知操作")
            return 2
        _print_json(out)
        return 0
    except ServiceError as exc:
        _print_json({"ok": False, "service": "context7", "error": str(exc), "status": exc.status, "details": exc.details})
        return 1


if __name__ == "__main__":
    sys.exit(main())
