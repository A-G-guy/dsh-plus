"""dshctl session/chat：经 dsh web HTTP RPC 的会话操作（list/new/send/open/chat）。

全部操作走 /api/* RPC（协议见 dshctl/rpc.py），不经浏览器 DOM——
"选定工作区 → 新会话 → 发消息"一条命令完成，GUI 经 SSE 实时刷新可见。
会产生模型调用的命令（send/chat）强制过 assert_mock_backend 护栏。
"""
from __future__ import annotations

import re
import sys
import time

from .common import DEV_PORT, fail, port_open
from .pwcli import DEFAULT_SESSION, pwcli
from .rpc import (assert_mock_backend, call, resolve_session,
                  resolve_workspace, wait_session_idle)

_REF_RE = re.compile(r"\[ref=([A-Za-z0-9_]+)\]")


def _session_title(item: dict) -> str:
    return (item.get("projections", {}).get("values", {}) or {}).get("title") or ""


def _require_dev_up(port: int) -> None:
    """dev 默认端口未监听时自动拉起（fast 路径）；自定义端口仍只检查不拉起。"""
    if port_open(port):
        return
    if port == DEV_PORT:
        from .cmd_dev import ensure_dev_up
        ensure_dev_up()
        return
    fail(f"目标实例未监听 127.0.0.1:{port}")


def _prompt(session_id: str, text: str, mode: str, port: int) -> None:
    value = call("session.prompt", {
        "sessionId": session_id, "mode": mode,
        "content": [{"type": "text", "text": text}],
    }, port=port)
    command = (value or {}).get("command")
    if command and command.get("text"):
        print(f"[session] 斜杠命令已执行: {command['text']}")


def _pick_treeitem_ref(find_output: str, title: str) -> str | None:
    """从 find 输出中定位含标题的 treeitem 行的 ref（首个匹配是外层容器，不能点）。"""
    fallback: str | None = None
    for line in find_output.splitlines():
        m = _REF_RE.search(line)
        if not m:
            continue
        if fallback is None:
            fallback = m.group(1)
        if "treeitem" in line and title in line:
            return m.group(1)
    return fallback


def _click_in_gui(title: str, port: int) -> None:
    """best-effort：在 pw 会话的侧边栏定位并选中该会话（失败仅提示，不 fail）。"""
    if not title:
        print("[session] 会话暂无标题，请在 GUI 侧边栏手动选中", file=sys.stderr)
        return
    try:
        pwcli(["goto", f"http://127.0.0.1:{port}"], session=DEFAULT_SESSION)
        proc = pwcli(["find", title], session=DEFAULT_SESSION)
        ref = _pick_treeitem_ref(proc.stdout, title)
        if ref:
            pwcli(["click", ref], session=DEFAULT_SESSION)
            print(f"[session] 已在浏览器（pw 会话 {DEFAULT_SESSION}）中选中该会话")
        else:
            print(f"[session] 侧边栏未定位到 {title!r}，请手动点击", file=sys.stderr)
    except SystemExit:
        print("[session] 浏览器定位失败（会话本身已就绪），请手动在 GUI 查看",
              file=sys.stderr)


def cmd_session_list(args) -> None:
    _require_dev_up(args.port)
    items = call("session.list", {}, port=args.port)["items"]
    if args.workspace:
        ws = resolve_workspace(args.workspace, port=args.port)
        ids = set(ws["sessionIds"])
        items = [s for s in items if s["sessionId"] in ids]
    if not items:
        print("[session] （无会话）")
        return
    for s in items:
        updated = time.strftime("%m-%d %H:%M", time.localtime(s["updatedAt"] / 1000))
        running = "running" if s.get("running") else "idle"
        print(f"{s['sessionId'][:13]}  {running:<8} {updated}  "
              f"{_session_title(s) or '(无标题)'}  [{s.get('cwd', '?')}]")


def cmd_session_new(args) -> str:
    _require_dev_up(args.port)
    payload: dict = {}
    if args.workspace:
        ws = resolve_workspace(args.workspace, port=args.port, create=True)
        payload["workspaceId"] = ws["workspaceId"]
    elif args.cwd:
        payload["cwd"] = args.cwd
    value = call("session.create", payload, port=args.port)
    session_id = value["sessionId"]
    if args.title:
        call("session.rename", {"sessionId": session_id, "title": args.title},
             port=args.port)
    print(f"[session] 已创建会话 {session_id}"
          + (f"（标题: {args.title}）" if args.title else ""))
    return session_id


def cmd_session_send(args) -> None:
    _require_dev_up(args.port)
    assert_mock_backend(args.port)
    item = resolve_session(args.session, port=args.port)
    text = " ".join(args.message)
    _prompt(item["sessionId"], text, args.mode, args.port)
    print(f"[session] 已发送到 {item['sessionId'][:13]}"
          f"（{_session_title(item) or '无标题'}）")


def cmd_session_open(args) -> None:
    _require_dev_up(args.port)
    item = resolve_session(args.session, port=args.port)
    _click_in_gui(_session_title(item), args.port)


def cmd_chat(args) -> None:
    """一键：解析/创建工作区 → 取最新（或新建）会话 → 发送消息 → 可选浏览器定位。"""
    _require_dev_up(args.port)
    assert_mock_backend(args.port)
    ws = resolve_workspace(args.workspace, port=args.port, create=True)
    session_id = None
    if not args.new:
        ids = set(ws["sessionIds"])
        items = [s for s in call("session.list", {}, port=args.port)["items"]
                 if s["sessionId"] in ids]
        if items:
            session_id = max(items, key=lambda s: s["updatedAt"])["sessionId"]
    if session_id is None:
        value = call("session.create", {"workspaceId": ws["workspaceId"]},
                     port=args.port)
        session_id = value["sessionId"]
        print(f"[chat] 工作区 {ws['title']} 下新会话 {session_id[:13]}")
    _prompt(session_id, args.message, "queue", args.port)
    if args.wait:
        wait_session_idle(session_id, port=args.port, timeout=args.timeout)
        print(f"[chat] 会话 {session_id[:13]} 已执行完毕（空闲）")
    else:
        print(f"[chat] 已发送 → 会话 {session_id[:13]}（工作区 {ws['title']}）")
    if args.open:
        items = call("session.list", {}, port=args.port)["items"]
        item = next((s for s in items if s["sessionId"] == session_id), {})
        _click_in_gui(_session_title(item), args.port)
