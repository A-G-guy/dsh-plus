"""dshctl url：输出目标实例当前进程的认证链接（含启动令牌）。

官方 browser-auth 的启动令牌每进程随机、重启即换，且只打印到实例 stdout
（生产在 systemd journal，dev 在守护日志）。本命令统一检索链：
access-gate 的 loopback-only launch-url 端点优先，日志/journal 兜底。
令牌跨 authority 有效——--host/--scheme 可生成 tailscale 域名等远程变体。
"""
from __future__ import annotations

from .auth import authenticated_url
from .common import (DEV_PORT, DEV_RUN_DIR, PROD_WEB_PORT, PROD_WEB_SERVICE)


def cmd_url(args) -> None:
    if args.dev:
        print(authenticated_url(
            args.port, host=args.host or f"127.0.0.1:{args.port}",
            scheme=args.scheme, service=None,
            dev_log=DEV_RUN_DIR / "dsh-web-dev.log"))
        return
    print(authenticated_url(
        PROD_WEB_PORT, host=args.host or f"127.0.0.1:{PROD_WEB_PORT}",
        scheme=args.scheme, service=PROD_WEB_SERVICE, dev_log=None))
