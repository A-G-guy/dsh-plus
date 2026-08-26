"""dshctl mock：向指定 dev 会话注入脚本化模型内容（零真实 API 费用）。

原理：写入 mock LLM 的脚本化响应队列（JSONL），再经 HTTP RPC 向目标会话
发送 prompt——web 实例的 agent 走真实管线消费 mock 响应，产出的会话记录
（工具调用/思考/todo/终答）与真实模型完全一致，GUI 实时可见。

红线：目标实例必须先通过 assert_mock_backend（host.describe 证明默认模型
指向本机 mock），且 RPC 端口不得为生产端口。
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

from .cmd_dev import clear_mock_script, ensure_mock_running, write_mock_script
from .cmd_session import _click_in_gui, _prompt, _require_dev_up, _session_title
from .common import fail
from .rpc import assert_mock_backend, call, resolve_session, wait_session_idle

TODO_STATUSES = ("pending", "in_progress", "completed")


def _entry_with_thinking(entry: dict, thinking: str | None) -> dict:
    if thinking:
        entry["thinking"] = thinking
    return entry


def build_entries(args, prompt: str) -> list[dict] | None:
    """便捷参数 → mock 脚本条目；--command 形态返回 None（不走脚本队列）。

    match 缺省取 prompt 原文（raw body 子串匹配，prompt 内避免引号/换行）。
    """
    if args.command:
        return None
    match = args.match or prompt
    entries: list[dict] = []
    if args.todo:
        todos = [{"content": t.strip(), "status": args.todo_status}
                 for t in args.todo.split(";") if t.strip()]
        if not todos:
            fail("--todo 至少包含一项任务（分号分隔）")
        entries.append(_entry_with_thinking(
            {"match": match,
             "tool_calls": [{"name": "todo_write", "arguments": {"todos": todos}}]},
            args.thinking))
    elif args.tool:
        try:
            tool_args = json.loads(args.args) if args.args else {}
        except json.JSONDecodeError as exc:
            fail(f"--args 不是合法 JSON: {exc}")
        entries.append(_entry_with_thinking(
            {"match": match,
             "tool_calls": [{"name": args.tool, "arguments": tool_args}]},
            args.thinking))
    elif args.reply:
        entries.append(_entry_with_thinking(
            {"match": match, "content": args.reply}, args.thinking))
    else:
        fail("缺少 mock 内容：--reply / --tool / --todo / --command / --spec 五选一")
    if args.then:
        follow: dict = {"content": args.then}
        if args.then_match:
            follow["match"] = args.then_match
        entries.append(follow)
    return entries


def load_spec(path: Path) -> dict:
    """读取并校验 spec 文件：{prompt?, entries, title?, marker?}。"""
    try:
        spec = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        fail(f"spec 文件读取失败: {exc}")
    entries = spec.get("entries")
    if not isinstance(entries, list) or not entries:
        fail("spec.entries 必须是非空数组")
    for idx, entry in enumerate(entries):
        if not isinstance(entry, dict) or not any(
                k in entry for k in ("content", "tool_calls", "error")):
            fail(f"spec.entries[{idx}] 需含 content/tool_calls/error 之一")
    return spec


def _default_marker(entries: list[dict]) -> str | None:
    """校验标记缺省取末条 content 前缀（tool_calls 结尾则无终答可验）。"""
    for entry in reversed(entries):
        content = entry.get("content")
        if isinstance(content, str) and content:
            return content[:40]
    return None


def _verify_marker(session_id: str, marker: str, port: int) -> None:
    page = call("session.history", {"sessionId": session_id, "maxMessages": 5},
                port=port)
    if marker not in json.dumps(page, ensure_ascii=False):
        fail(f"会话历史中未见 marker {marker!r}，mock 内容未按预期落库；"
             f"请检查 mock-llm 日志与脚本 match 是否命中")


def cmd_mock_run(args) -> None:
    _require_dev_up(args.port)
    assert_mock_backend(args.port)
    item = resolve_session(args.session, port=args.port)
    session_id = item["sessionId"]

    if args.command:
        # 斜杠命令由宿主命令注册表执行，不发给模型（协议保证），零成本
        _prompt(session_id, args.command, "queue", args.port)
        print(f"[mock] 已向 {session_id[:13]} 发送斜杠命令: {args.command}")
        return

    if args.spec:
        spec = load_spec(Path(args.spec))
        prompt = spec.get("prompt") or f"[mock] spec {int(time.time())}"
        entries = spec["entries"]
        title = args.title or spec.get("title")
        marker = args.marker or spec.get("marker") or _default_marker(entries)
    else:
        prompt = args.prompt or f"[mock] {int(time.time())}"
        entries = build_entries(args, prompt)
        assert entries is not None
        title = args.title
        marker = args.marker or _default_marker(entries)

    ensure_mock_running()
    write_mock_script(entries)
    try:
        _prompt(session_id, prompt, "queue", args.port)
        wait_session_idle(session_id, port=args.port, timeout=args.timeout)
    finally:
        clear_mock_script()
    if marker:
        _verify_marker(session_id, marker, args.port)
    if title:
        call("session.rename", {"sessionId": session_id, "title": title},
             port=args.port)
    print(f"[mock] ✔ 会话 {session_id[:13]}（{_session_title(item) or '无标题'}）"
          f"已注入 {len(entries)} 条脚本响应，marker={marker!r}，零 API 费用")
    if args.open:
        refreshed = resolve_session(session_id, port=args.port)
        _click_in_gui(_session_title(refreshed) or (title or ""), args.port)
