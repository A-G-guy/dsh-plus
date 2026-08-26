"""rpc 模块单测：envelope 构造、错误分支、护栏、解析器（stub transport，无真实 HTTP）。"""
from __future__ import annotations

import io
import json
import unittest
import urllib.error
from unittest import mock

from dshctl import rpc


class FakeResponse:
    def __init__(self, payload: dict):
        self._raw = json.dumps(payload).encode()

    def read(self) -> bytes:
        return self._raw

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def ok_response(value) -> FakeResponse:
    return FakeResponse({"type": "server-response", "rpcId": "x",
                         "result": {"ok": True, "value": value}})


def err_response(code: str, message: str) -> FakeResponse:
    return FakeResponse({"type": "server-response", "rpcId": "x",
                         "result": {"ok": False,
                                    "error": {"code": code, "message": message,
                                              "details": {}}}})


class TestCall(unittest.TestCase):
    def test_envelope_shape_and_value(self):
        captured = {}

        def fake_urlopen(request, timeout):
            captured["url"] = request.full_url
            captured["body"] = json.loads(request.data.decode())
            return ok_response({"answer": 1})

        with mock.patch("urllib.request.urlopen", fake_urlopen):
            value = rpc.call("session.list", {}, port=3082)
        self.assertEqual(value, {"answer": 1})
        self.assertTrue(captured["url"].endswith("/api/session.list"))
        body = captured["body"]
        self.assertEqual(body["type"], "client-request")
        self.assertEqual(body["method"], "session.list")
        self.assertEqual(body["payload"], {})
        self.assertTrue(body["rpcId"])

    def test_business_error_fails(self):
        with mock.patch("urllib.request.urlopen",
                        lambda req, timeout: err_response("session-not-found", "nope")):
            with self.assertRaises(SystemExit):
                rpc.call("session.history", {"sessionId": "s"}, port=3082)

    def test_transport_error_fails_with_hint(self):
        def refuse(request, timeout):
            raise urllib.error.URLError("Connection refused")

        with mock.patch("urllib.request.urlopen", refuse):
            with self.assertRaises(SystemExit):
                rpc.call("session.list", {}, port=3082)

    def test_prod_port_rejected(self):
        for port in (3080, 3081):
            with self.assertRaises(SystemExit, msg=str(port)):
                rpc.call("session.list", {}, port=port)


class TestGuards(unittest.TestCase):
    def test_mock_backend_accepted(self):
        desc = {"provider": "deepseek", "model": "deepseek-v4-flash"}
        with mock.patch.object(rpc, "call", return_value=desc):
            self.assertEqual(rpc.assert_mock_backend(3082), desc)

    def test_real_backend_rejected(self):
        desc = {"provider": "kimi-coding", "model": "k3-256k"}
        with mock.patch.object(rpc, "call", return_value=desc):
            with self.assertRaises(SystemExit):
                rpc.assert_mock_backend(3082)


WS = [
    {"workspaceId": "ws-1", "title": "dsh-plus",
     "path": "/home/agguy/workspace/projects/dsh-plus", "sessionIds": ["session-a"]},
    {"workspaceId": "ws-2", "title": "monit",
     "path": "/home/agguy/workspace/projects/monit", "sessionIds": []},
]

SESSIONS = [
    {"sessionId": "session-aaaa-1", "updatedAt": 2000, "running": False,
     "cwd": "/x", "projections": {"values": {"title": "调试 UI"}}},
    {"sessionId": "session-bbbb-2", "updatedAt": 1000, "running": True,
     "cwd": "/x", "projections": {"values": {"title": "调试 mock"}}},
]


class TestResolve(unittest.TestCase):
    def test_workspace_by_title(self):
        with mock.patch.object(rpc, "call", return_value={"items": WS}):
            self.assertEqual(rpc.resolve_workspace("monit")["workspaceId"], "ws-2")

    def test_workspace_by_path(self):
        with mock.patch.object(rpc, "call", return_value={"items": WS}):
            ws = rpc.resolve_workspace("/home/agguy/workspace/projects/monit")
            self.assertEqual(ws["workspaceId"], "ws-2")

    def test_workspace_missing_fails(self):
        with mock.patch.object(rpc, "call", return_value={"items": WS}):
            with self.assertRaises(SystemExit):
                rpc.resolve_workspace("不存在的标题xyz")

    def test_session_by_id_prefix(self):
        with mock.patch.object(rpc, "call", return_value={"items": SESSIONS}):
            self.assertEqual(rpc.resolve_session("session-bbbb")["sessionId"],
                             "session-bbbb-2")

    def test_session_by_title_substring(self):
        with mock.patch.object(rpc, "call", return_value={"items": SESSIONS}):
            self.assertEqual(rpc.resolve_session("调试 UI")["sessionId"],
                             "session-aaaa-1")

    def test_session_ambiguous_title_fails(self):
        with mock.patch.object(rpc, "call", return_value={"items": SESSIONS}):
            with self.assertRaises(SystemExit):
                rpc.resolve_session("调试")


if __name__ == "__main__":
    unittest.main()
