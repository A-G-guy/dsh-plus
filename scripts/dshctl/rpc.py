"""dshctl rpc：dsh web HTTP RPC 最小客户端（stdlib urllib，零新依赖）。

协议（@deepseek-ai/dsh-host-apiproxy，权威 wire 格式见其 types/api/rpc.d.ts）：
- 请求：POST http://127.0.0.1:<port>/api/<method>，
  body {"type":"client-request","rpcId":"<uuid4>","method":..., "payload":...}
- 响应：{"type":"server-response","rpcId":..., "result":{"ok":true,"value":...}
  或 {"ok":false,"error":{"code","message","details"}}}
- 认证（dsh ≥ 0.1.2-alpha.1）：官方 browser-auth 对 /api 连 loopback 也无豁免，
  一律携 auth.cookie_header 自签的 dsh-auth-* cookie（密钥读目标实例 home 的
  .credentials.yaml，跨重启有效）。

防费用护栏：一切会触发 LLM 调用的操作（prompt/mock）必须先过
assert_mock_backend()——host.describe 证明目标实例默认模型指向本机 mock。
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

from .auth import cookie_header, home_for_port
from .common import DEV_PORT, PROD_PORTS, fail

# dev settings.yaml（cmd_dev.MOCK_SETTINGS）中的默认模型指向本机 mock LLM；
# 两项同时匹配才认定目标是 dev mock 实例。
MOCK_PROVIDER = "deepseek"
MOCK_MODEL = "deepseek-v4-flash"


def call(method: str, payload: dict, *, port: int = DEV_PORT,
         timeout: float = 30.0):
    """发起一元 RPC 调用，成功返回 result.value；业务/传输错误统一 fail。"""
    assert_not_prod_port(port)
    envelope = {"type": "client-request", "rpcId": str(uuid.uuid4()),
                "method": method, "payload": payload}
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}/api/{method}",
        data=json.dumps(envelope).encode(),
        headers={"content-type": "application/json",
                 "cookie": cookie_header(home_for_port(port, PROD_PORTS), port)},
        method="POST")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as resp:
            body = json.loads(resp.read().decode())
    except urllib.error.URLError as exc:
        fail(f"RPC {method} 无法连接 127.0.0.1:{port}（{exc.reason}）；"
             f"dev 实例请先运行: dshctl.py dev up")
    except TimeoutError:
        fail(f"RPC {method} 超时（{timeout}s）")
    result = body.get("result", {})
    if not result.get("ok"):
        error = result.get("error") or {}
        fail(f"RPC {method} 失败: {error.get('code', 'internal')}"
             f" —— {error.get('message', '(无错误信息)')}")
    return result.get("value")


def assert_not_prod_port(port: int) -> None:
    if port in PROD_PORTS:
        fail(f"拒绝操作生产端口 {port}（dshctl 的会话/mock 操作只允许 dev 实例）")


def assert_mock_backend(port: int = DEV_PORT) -> dict:
    """证明目标实例的默认模型走本机 mock，否则拒绝（零真实 API 费用红线）。"""
    info = call("host.describe", {}, port=port)
    if info.get("provider") != MOCK_PROVIDER or info.get("model") != MOCK_MODEL:
        fail(f"目标实例（:{port}）默认模型为 "
             f"{info.get('provider')}/{info.get('model')}，并非本机 mock "
             f"（{MOCK_PROVIDER}/{MOCK_MODEL}）；为避免真实 API 费用，拒绝继续")
    return info


def resolve_workspace(ref: str, *, port: int = DEV_PORT, create: bool = False) -> dict:
    """按 workspaceId / 绝对路径 / 标题解析工作区；create=True 时路径未注册则创建。"""
    items = call("workspace.list", {}, port=port)["items"]
    for ws in items:
        if ref in (ws["workspaceId"], ws["title"]):
            return ws
    ref_path = Path(ref).expanduser()
    if ref_path.is_absolute():
        canonical = str(ref_path.resolve())
        for ws in items:
            if str(Path(ws["path"]).resolve()) == canonical:
                return ws
        if create:
            if not ref_path.is_dir():
                fail(f"工作区路径不存在或不是目录: {canonical}")
            value = call("workspace.create", {"path": canonical}, port=port)
            return value["workspace"]
    candidates = [ws for ws in items if ref in ws["title"]]
    if len(candidates) == 1:
        return candidates[0]
    if candidates:
        fail(f"工作区 {ref!r} 多义: " +
             ", ".join(f"{ws['title']}({ws['workspaceId'][:8]})" for ws in candidates))
    fail(f"找不到工作区: {ref!r}（可用 workspace.create 的路径参数，"
         f"或先用 session list --workspace 查看）")


def _session_title(item: dict) -> str:
    return (item.get("projections", {}).get("values", {}) or {}).get("title") or ""


def resolve_session(ref: str, *, port: int = DEV_PORT) -> dict:
    """按 sessionId 前缀或标题子串解析会话；多义时列出候选后 fail。"""
    items = call("session.list", {}, port=port)["items"]
    by_id = [s for s in items if s["sessionId"].startswith(ref)]
    if len(by_id) == 1:
        return by_id[0]
    by_title = [s for s in items if ref and ref in _session_title(s)]
    if len(by_title) == 1:
        return by_title[0]
    candidates = by_id or by_title
    if candidates:
        fail(f"会话 {ref!r} 多义: " + ", ".join(
            f"{_session_title(s) or '(无标题)'}[{s['sessionId'][:13]}]"
            for s in candidates[:8]))
    fail(f"找不到会话: {ref!r}（用 session list 查看可用会话）")


def wait_session_idle(session_id: str, *, port: int = DEV_PORT,
                      timeout: float = 120.0) -> None:
    """轮询至目标会话 running==false（一轮 agent 执行结束）。"""
    deadline = time.time() + timeout
    while time.time() < deadline:
        items = call("session.list", {}, port=port)["items"]
        item = next((s for s in items if s["sessionId"] == session_id), None)
        if item is not None and not item.get("running"):
            return
        time.sleep(1.0)
    fail(f"会话 {session_id} 在 {timeout}s 内未转为空闲；"
         f"可用 session send 无副作用，或用 RPC session.cancel 中止")
