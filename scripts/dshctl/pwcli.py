"""dshctl playwright-cli 共享层：wrapper 定位、命名会话调用、会话枚举。

playwright-cli 的命名会话（-s <name>）即持久浏览器守护进程：同一名字的后续
调用自动接管既有会话（连接），未存在则由 open 创建——这是"一键创建或连接
已有会话"的底层机制。本模块只做进程调用与输出解析，纯本机回环操作。
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path

from .common import fail, run

SKILL_WRAPPER = Path.home() / ".dsh/skills/playwright-headless/scripts/playwright_cli.sh"
DEFAULT_SESSION = "dsh-dev"


def pwcli_base() -> list[str]:
    if SKILL_WRAPPER.exists():
        return ["bash", str(SKILL_WRAPPER)]  # wrapper 未必带执行位，走 bash 解释
    if shutil.which("npx"):
        return ["npx", "--yes", "--package", "@playwright/cli", "playwright-cli"]
    fail("未找到 playwright-cli：请安装 Node.js/npm 后执行 "
         "npm install -g @playwright/cli@latest（或部署 playwright-headless skill wrapper）")


def pwcli(args: list[str], *, session: str = DEFAULT_SESSION):
    """在指定命名会话上执行 playwright-cli 命令，返回 CompletedProcess。"""
    return run([*pwcli_base(), "--session", session, *args])


def pw_sessions() -> list[str]:
    """枚举当前存活的 playwright-cli 浏览器会话名（list --json，尽力解析）。"""
    proc = run([*pwcli_base(), "list", "--json"])
    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return _parse_sessions_fallback(proc.stdout)
    return _extract_session_names(data)


def _extract_session_names(data) -> list[str]:
    """兼容 JSON 形态：纯数组、{sessions: [...]}、{browsers: [...]}（playwright-cli
    list --json 的现行形态），元素为字符串或带 name/session 键的对象。"""
    if isinstance(data, dict):
        data = data.get("sessions", data.get("browsers", []))
    names = []
    for item in data if isinstance(data, list) else []:
        if isinstance(item, str):
            names.append(item)
        elif isinstance(item, dict):
            name = item.get("session") or item.get("name")
            if isinstance(name, str):
                names.append(name)
    return names


def _parse_sessions_fallback(text: str) -> list[str]:
    """非 JSON 输出时按行粗提取（防御 CLI 输出格式漂移）。"""
    names = []
    for line in text.splitlines():
        line = line.strip().rstrip(",").strip('"')
        if line and not line.startswith(("{", "[", "]", "}")) and " " not in line:
            names.append(line)
    return names
