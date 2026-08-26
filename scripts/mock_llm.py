#!/usr/bin/env python3
"""本地 mock LLM：OpenAI 兼容 /v1/chat/completions，仅绑 127.0.0.1。

用途：dsh-plus 开发实例的唯一模型后端，保证开发/调试零真实 API 费用。
- 默认行为：回显最后一条用户消息（前缀 "[mock] "）。
- 脚本化：--script 指向 JSONL，每行一个响应对象，按请求顺序消费；
  支持 {"content": "..."} 或 {"tool_calls": [{"name": "...", "arguments": {...}}]}
  或 {"error": {"status": 400, "message": "..."}}（模拟模型请求失败，默认 400 不重试）。
  任意响应可附加 "thinking": "..."——作为 reasoning_content 下发，
  dsh 的 pi-ai/deepseek 适配器会把它渲染为模型思考块（供 UI 调试思考展示）。
  队列耗尽后回落到回显。
- 标题生成请求（dsh-session-title-llm，body 含固定标记）永不消费脚本条目，
  只回显——否则标题请求会抢走为正式回复准备的脚本条目（其 body 含用户提示原文，
  match 子串同样命中）。
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HOST = "127.0.0.1"
DEFAULT_PORT = 3917

# dsh-session-title-llm 的标题生成提示固定前缀（以其为子串判定标题请求）。
TITLE_PROMPT_MARKER = "Generate the session title from this JSON array of human messages"


def _echo_content(messages: list[dict]) -> str:
    for msg in reversed(messages):
        if msg.get("role") == "user":
            content = msg.get("content")
            if isinstance(content, str):
                return f"[mock] {content}"
            return "[mock] (non-text user message)"
    return "[mock] (no user message)"


class ScriptQueue:
    """文件Backed 脚本化响应队列：JSONL 每行一个响应对象。

    条目可带 "match" 字段：仅当 match 是请求体的子串时才消费该条目
    （实现按内容而非按序命中，免疫会话标题等辅助调用的干扰）；
    不带 match 的条目匹配任意请求。多个候选取首个。
    """

    def __init__(self, path: Path | None) -> None:
        self._path = path

    def pop(self, request_body: str) -> dict | None:
        if not self._path or not self._path.exists():
            return None
        if TITLE_PROMPT_MARKER in request_body:
            return None  # 标题生成请求只回显，不消费脚本条目
        lines = [l for l in self._path.read_text(encoding="utf-8").splitlines() if l.strip()]
        for idx, line in enumerate(lines):
            entry = json.loads(line)
            match = entry.get("match")
            if match is not None and match not in request_body:
                continue
            self._path.write_text(
                "\n".join(lines[:idx] + lines[idx + 1:]) +
                ("\n" if len(lines) > 1 else ""), encoding="utf-8")
            return entry
        return None


def _with_thinking(message: dict, scripted: dict) -> dict:
    """脚本条目带 thinking 时，作为 reasoning_content 附加到消息上。"""
    thinking = scripted.get("thinking")
    if isinstance(thinking, str) and thinking:
        message["reasoning_content"] = thinking
    return message


def _build_message(req: dict, queue: ScriptQueue, raw_body: str) -> tuple[dict | None, dict | None]:
    """返回 (message, error)：脚本条目带 error 字段时 message 为 None。"""
    scripted = queue.pop(raw_body)
    if scripted is None:
        return {"role": "assistant", "content": _echo_content(req.get("messages", []))}, None
    if "error" in scripted:
        return None, scripted["error"]
    if "tool_calls" in scripted:
        calls = [
            {
                "id": f"call_mock_{idx}",
                "type": "function",
                "function": {
                    "name": call["name"],
                    "arguments": json.dumps(call.get("arguments", {})),
                },
            }
            for idx, call in enumerate(scripted["tool_calls"])
        ]
        message = {"role": "assistant", "content": None, "tool_calls": calls}
        return _with_thinking(message, scripted), None
    message = {"role": "assistant", "content": scripted.get("content", "[mock]")}
    return _with_thinking(message, scripted), None


def _completion_payload(req: dict, message: dict) -> dict:
    return {
        "id": f"chatcmpl-mock-{int(time.time() * 1000)}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": req.get("model", "mock"),
        "choices": [
            {
                "index": 0,
                "message": message,
                "finish_reason": "tool_calls" if message.get("tool_calls") else "stop",
            }
        ],
        "usage": {
            "prompt_tokens": int(os.environ.get("MOCK_USAGE_IN", "0")),
            "completion_tokens": int(os.environ.get("MOCK_USAGE_OUT", "0")),
            "total_tokens": 0,
        },
    }


def _stream_chunks(payload: dict) -> bytes:
    chunk = dict(payload)
    chunk["object"] = "chat.completion.chunk"
    message = payload["choices"][0]["message"]
    chunk["choices"] = [
        {"index": 0, "delta": message, "finish_reason": payload["choices"][0]["finish_reason"]}
    ]
    return b"data: " + json.dumps(chunk).encode() + b"\n\ndata: [DONE]\n\n"


class MockHandler(BaseHTTPRequestHandler):
    queue: ScriptQueue  # 由工厂注入

    def log_message(self, fmt: str, *args: object) -> None:
        sys.stderr.write("[mock-llm] " + fmt % args + "\n")

    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 - stdlib 命名
        if self.path.rstrip("/") == "/v1/models":
            self._send_json(200, {"object": "list", "data": [
                {"id": "deepseek-v4-flash", "object": "model", "owned_by": "mock"},
            ]})
            return
        self._send_json(404, {"error": "unknown path"})

    def _log_request_meta(self, req: dict) -> None:
        """请求元数据日志（调试用）：模型名 + tools 名单，单行 JSON。

        供组合/预设类验证（如功能开关插件核对模型可见工具目录）从
        mock-llm.log 直接提取，无需 GUI 截图或会话内容解析。
        """
        tools = req.get("tools") or []
        names = []
        for tool in tools:
            if isinstance(tool, dict):
                name = tool.get("function", {}).get("name") or tool.get("name")
                if isinstance(name, str):
                    names.append(name)
        meta = {"model": req.get("model"), "tools": names}
        sys.stderr.write("[mock-llm] tools " + json.dumps(meta, ensure_ascii=False) + "\n")

    def do_POST(self) -> None:  # noqa: N802 - stdlib 命名
        if self.path.rstrip("/") != "/v1/chat/completions":
            self._send_json(404, {"error": "unknown path"})
            return
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) or b"{}"
        req = json.loads(raw)
        self._log_request_meta(req)
        message, error = _build_message(req, self.queue, raw.decode("utf-8", errors="replace"))
        if error is not None:
            status = int(error.get("status", 400))
            self._send_json(status, {"error": {
                "message": error.get("message", "mock scripted error"),
                "type": "mock_scripted_error",
            }})
            return
        assert message is not None
        payload = _completion_payload(req, message)
        if req.get("stream"):
            body = _stream_chunks(payload)
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self._send_json(200, payload)


def main() -> int:
    parser = argparse.ArgumentParser(description="dsh-plus 本地 mock LLM（仅 127.0.0.1）")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--script", type=Path,
                        default=os.environ.get("MOCK_SCRIPT_FILE") and
                        Path(os.environ["MOCK_SCRIPT_FILE"]),
                        help="JSONL 脚本化响应队列文件（按请求弹出首行）")
    args = parser.parse_args()

    handler = type("BoundMockHandler", (MockHandler,), {"queue": ScriptQueue(args.script)})
    server = ThreadingHTTPServer((HOST, args.port), handler)
    print(f"[mock-llm] listening on http://{HOST}:{args.port}/v1", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
