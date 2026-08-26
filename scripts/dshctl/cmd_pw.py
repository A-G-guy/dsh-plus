"""dshctl pw：dev GUI 的 playwright 命名会话管理（open/status/close/run）。

命名会话（默认 dsh-dev）即持久浏览器守护进程——已存在则接管（连接），
不存在则创建，默认保持打开，供连续手工/脚本调试。
`pw run` 把任意 playwright-cli 子命令原样转发到该会话（截图/快照/追踪等）。
"""
from __future__ import annotations

import subprocess

from .common import DEV_PORT, fail, port_open
from .pwcli import DEFAULT_SESSION, pw_sessions, pwcli, pwcli_base


def _dev_url(args) -> str:
    url = args.url or f"http://127.0.0.1:{DEV_PORT}"
    if args.url is None and not port_open(DEV_PORT):
        from .cmd_dev import ensure_dev_up
        ensure_dev_up()
    return url


def cmd_pw_open(args) -> None:
    url = _dev_url(args)
    sessions = pw_sessions()
    if args.name in sessions:
        # 会话已存活：goto 复用同一浏览器上下文（cookies/标签页保留）
        pwcli(["goto", url], session=args.name)
        print(f"[pw] 已连接既有会话 {args.name!r} 并定位到 {url}")
        return
    pwcli(["open", url], session=args.name)
    print(f"[pw] 已创建会话 {args.name!r} → {url}（保持打开，用完可 pw close）")


def cmd_pw_status(args) -> None:
    sessions = pw_sessions()
    if args.name not in sessions:
        print(f"[pw] 会话 {args.name!r} 不存在；现存: {', '.join(sessions) or '（无）'}")
        return
    proc = pwcli(["eval", "location.href"], session=args.name)
    url = _eval_result(proc.stdout) or "(未知)"
    print(f"[pw] 会话 {args.name!r} 存活，当前页: {url}")


def _eval_result(stdout: str) -> str:
    """playwright-cli eval 输出形如 '### Result\\n<json 值>'，提取结果行。"""
    lines = stdout.splitlines()
    for idx, line in enumerate(lines):
        if line.strip() == "### Result" and idx + 1 < len(lines):
            return lines[idx + 1].strip().strip('"')
    return ""


def cmd_pw_close(args) -> None:
    if args.name not in pw_sessions():
        print(f"[pw] 会话 {args.name!r} 不存在，无需关闭")
        return
    pwcli(["close"], session=args.name)
    print(f"[pw] 会话 {args.name!r} 已关闭")


def cmd_pw_run(args) -> None:
    """把任意 playwright-cli 子命令转发到命名会话；会话不存在则先 open。"""
    cli_args = list(args.args)
    if cli_args and cli_args[0] == "--":
        cli_args = cli_args[1:]
    if not cli_args:
        fail("缺少要转发的 playwright-cli 命令，如: pw run -- snapshot")
    if args.name not in pw_sessions():
        pwcli(["open", _dev_url(args)], session=args.name)
        print(f"[pw] 会话 {args.name!r} 不存在，已自动创建")
    proc = subprocess.run([*pwcli_base(), "--session", args.name, *cli_args])
    if proc.returncode != 0:
        raise SystemExit(proc.returncode)
