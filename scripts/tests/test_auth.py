"""dshctl auth 单测：凭据文件解析、自签 cookie 结构与官方算法逐字段核对、
启动令牌日志提取。纯逻辑，无网络无进程。"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import tempfile
import unittest
from pathlib import Path

from dshctl.auth import _read_secret, _token_from_text, mint_cookie

SECRET = "A" * 43  # base64url 32 字节形态

CREDENTIALS = f"""records:
  client-connection/browser-session:
    kind: grant
    payload:
      secret: {SECRET}
      version: 1
  other/record:
    kind: grant
    payload:
      secret: {"B" * 43}
refs:
  SOME_API_KEY: <ref>
version: 1
"""


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


class ReadSecretTest(unittest.TestCase):
    def test_reads_browser_session_secret_not_sibling(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            (home / ".credentials.yaml").write_text(CREDENTIALS, encoding="utf-8")
            self.assertEqual(_read_secret(home), SECRET)

    def test_missing_file_fails_cleanly(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(SystemExit):
                _read_secret(Path(tmp))


class MintCookieTest(unittest.TestCase):
    def _mint(self, authority: str = "127.0.0.1:3080"):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            (home / ".credentials.yaml").write_text(CREDENTIALS, encoding="utf-8")
            return mint_cookie(home, authority)

    def test_cookie_name_binds_authority(self):
        cookie = self._mint()
        name, _, value = cookie.partition("=")
        expected = "dsh-auth-" + _b64url(hashlib.sha256(b"127.0.0.1:3080").digest())
        self.assertEqual(name, expected)
        self.assertNotEqual(name, self._mint("other:9999").split("=")[0])

    def test_value_roundtrips_official_format(self):
        # 官方 decodeCookie 的完整逆过程：三段式、版本、HMAC 签名、payload 字段。
        value = self._mint().split("=", 1)[1]
        version, body, signature = value.split(".")
        self.assertEqual(version, "v1")
        secret = base64.urlsafe_b64decode(SECRET + "==")
        expected_sig = _b64url(hmac.new(secret, body.encode(), hashlib.sha256).digest())
        self.assertEqual(signature, expected_sig, "签名必须按官方算法覆盖 body 串")
        payload = json.loads(base64.urlsafe_b64decode(body + "==").decode())
        self.assertEqual(list(payload), ["version", "authority", "issuedAt", "expiresAt"],
                         "payload 键序必须与 JSON.stringify 插入序一致")
        self.assertEqual(payload["version"], 1)
        self.assertEqual(payload["authority"], "127.0.0.1:3080")
        self.assertGreater(payload["expiresAt"], payload["issuedAt"])
        # 官方硬校验：expiresAt - issuedAt <= cookieMaxAgeDays（schema min 1 天）
        self.assertLessEqual(payload["expiresAt"] - payload["issuedAt"], 86_400_000)


class TokenFromTextTest(unittest.TestCase):
    def test_extracts_latest_token_line(self):
        text = ("Aug 30 bash[1]: dsh web: http://127.0.0.1:3080/?token=old-token\n"
                "Aug 30 bash[1]: dsh web: opening the default browser\n"
                "Aug 31 bash[2]: dsh web: http://127.0.0.1:3080/?token=new-token\n")
        self.assertEqual(_token_from_text(text), "new-token")

    def test_no_token_line_returns_none(self):
        self.assertIsNone(_token_from_text("nothing here"))


if __name__ == "__main__":
    unittest.main()
