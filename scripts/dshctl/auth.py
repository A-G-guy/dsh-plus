"""dshctl auth：官方 browser-auth 凭据获取（自签 cookie / 启动令牌检索）。

官方机制（dsh ≥ 0.1.2-alpha.1，client-connection/src/browser-auth.ts）：
- 签名密钥持久化于 $DSH_HOME/.credentials.yaml
  （records → client-connection/browser-session → payload.secret，base64url 32B）；
- cookie 名 = dsh-auth-<base64url(sha256(authority))>，authority = host:port；
- cookie 值 = v1.<base64url(payload-json)>.<base64url(hmac-sha256(secret, payload-b64))>，
  payload 键序固定 {"version":1,"authority":...,"issuedAt":ms,"expiresAt":ms}
  （JSON.stringify 紧凑序列化）。

自签 cookie 与官方 ?token= 交换产物等价，密钥不变即跨重启有效——脚本
认证的唯一可靠通道（官方对 /api/WS 连 loopback 也无豁免）。读取签名密钥
的安全级别与读取 ~/.npmrc 的 npm token 同级（本机用户态文件）。

启动令牌（每进程随机、重启即换）的检索链：access-gate 的 loopback-only
launch-url 端点 → dev 守护日志 / systemd journal 的 `dsh web:` 行。
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse

from .common import DEV_HOME, PROD_HOME, fail

_CREDENTIALS_FILE = ".credentials.yaml"
_SECRET_SECTION = "client-connection/browser-session"
_DEFAULT_MAX_AGE_DAYS = 1  # 官方 cookieMaxAgeDays 下限为 1，自签取 1 天恒满足服务端校验

_TOKEN_LINE_RE = re.compile(r"dsh web: (\S+)")


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _read_secret(home: Path) -> str:
    """读取 browser-session 签名密钥（定向文本解析，免 yaml 依赖）。"""
    path = home / _CREDENTIALS_FILE
    if not path.exists():
        fail(f"凭据文件不存在: {path}（目标实例尚未生成官方认证密钥，先启动一次）")
    lines = path.read_text(encoding="utf-8").splitlines()
    in_section = False
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        indent = len(line) - len(line.lstrip())
        if indent <= 2:
            # records:（indent 0）或兄弟记录键（indent 2）都会切出本节
            in_section = stripped == f"{_SECRET_SECTION}:"
            continue
        if in_section:
            match = re.match(r"secret:\s*(\S+)\s*$", stripped)
            if match:
                return match.group(1)
    fail(f"{path} 中未找到 {_SECRET_SECTION} 的 secret（实例版本过旧或无官方认证）")


def mint_cookie(home: Path, authority: str,
                max_age_days: int = _DEFAULT_MAX_AGE_DAYS) -> str:
    """自签官方 browser-auth cookie，返回 `name=value`（Cookie 头直接可用）。

    authority 必须与请求实际使用的 host:port 完全一致（cookie 名与签名受众
    双双绑定 authority）。max_age_days 取 1 以恒满足服务端
    `expiresAt - issuedAt <= cookieMaxAgeDays` 校验（脚本每次调用现签现用）。
    """
    secret = base64.urlsafe_b64decode(_read_secret(home) + "==")
    issued_at = int(time.time() * 1000)
    payload = {
        "version": 1,
        "authority": authority,
        "issuedAt": issued_at,
        "expiresAt": issued_at + max_age_days * 86_400_000,
    }
    body = _b64url(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signature = _b64url(hmac.new(secret, body.encode("utf-8"), hashlib.sha256).digest())
    name = "dsh-auth-" + _b64url(hashlib.sha256(authority.encode("utf-8")).digest())
    return f"{name}=v1.{body}.{signature}"


def cookie_header(home: Path, port: int, host: str = "127.0.0.1") -> str:
    """面向 loopback 调用的 Cookie 头值。"""
    return mint_cookie(home, f"{host}:{port}")


def home_for_port(port: int, prod_ports: set[int]) -> Path:
    """按目标端口推断实例 home（prod 端口组 → PROD_HOME，其余 → DEV_HOME）。"""
    return PROD_HOME if port in prod_ports else DEV_HOME


def _token_from_text(text: str) -> str | None:
    """从日志文本提取最新一条 `dsh web:` 行的 token 参数。"""
    token: str | None = None
    for match in _TOKEN_LINE_RE.finditer(text):
        params = parse_qs(urlparse(match.group(1)).query)
        if params.get("token"):
            token = params["token"][0]
    return token


def token_from_dev_log(log_path: Path) -> str | None:
    """dev 实例：从守护日志捞最新启动令牌。"""
    if not log_path.exists():
        return None
    return _token_from_text(log_path.read_text(encoding="utf-8", errors="replace"))


def token_from_journal(service: str) -> str | None:
    """prod 实例：从 systemd journal 捞最新启动令牌（先试用户态，再 sudo -n）。"""
    for cmd in (["journalctl", "--user", "-u", service, "--no-pager"],
                ["sudo", "-n", "journalctl", "-u", service, "--no-pager"]):
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        except (OSError, subprocess.TimeoutExpired):
            continue
        if proc.returncode == 0:
            token = _token_from_text(proc.stdout)
            if token is not None:
                return token
    return None


def launch_url_via_gate(port: int, host: str, scheme: str) -> str | None:
    """经 access-gate 的 loopback-only 端点取当前进程认证链接（无需任何凭据）。"""
    query = urlencode({"host": host, "scheme": scheme})
    url = f"http://127.0.0.1:{port}/dsh-plus/gate/launch-url?{query}"
    try:
        with urllib.request.urlopen(url, timeout=5) as resp:
            body = json.loads(resp.read().decode())
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError):
        return None
    value = body.get("url")
    return value if isinstance(value, str) and "token=" in value else None


def authenticated_url(port: int, *, host: str, scheme: str,
                      service: str | None, dev_log: Path | None) -> str:
    """取当前进程认证链接：launch-url 端点优先，日志/journal 兜底。"""
    via_gate = launch_url_via_gate(port, host, scheme)
    if via_gate is not None:
        return via_gate
    token = token_from_dev_log(dev_log) if dev_log is not None else None
    if token is None and service is not None:
        token = token_from_journal(service)
    if token is None:
        fail("未能获取启动令牌：launch-url 端点不可达且日志/journal 无 `dsh web:` 行"
             "（实例未运行，或 access-gate 未升级到含 launch-url 的版本）")
    return f"{scheme}://{host}/?token={token}"
