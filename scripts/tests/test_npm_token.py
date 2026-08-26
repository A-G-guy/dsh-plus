"""npm token 自动解析单测：来源优先级、插值跳过、引号值、不明文显示。"""
from __future__ import annotations

import contextlib
import io
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from dshctl import cmd_release

FAKE_TOKEN = "npm_faketoken123"


def _home_with(files: dict[str, str]) -> Path:
    """在临时 home 下写入给定相对路径文件，返回 home 路径。"""
    home = Path(tempfile.mkdtemp(prefix="dshctl-npm-token-"))
    for rel, content in files.items():
        path = home / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
    return home


def _without_env_token():
    """临时摘除环境变量 NPM_TOKEN（用例结束后恢复）。"""
    patched = mock.patch.dict(os.environ)
    patched.start()
    os.environ.pop("NPM_TOKEN", None)
    return patched


class TestResolveNpmToken(unittest.TestCase):
    def test_env_var_wins(self):
        home = _home_with({".npmrc": f"//registry.npmjs.org/:_authToken={FAKE_TOKEN}"})
        with mock.patch.dict(os.environ, {"NPM_TOKEN": "env-token"}):
            resolved = cmd_release.resolve_npm_token(home, extra_files=[])
        self.assertEqual(resolved, ("env-token", "环境变量 NPM_TOKEN"))

    def test_npmrc_literal_token(self):
        home = _home_with({".npmrc": f"//registry.npmjs.org/:_authToken={FAKE_TOKEN}"})
        with _without_env_token():
            resolved = cmd_release.resolve_npm_token(home, extra_files=[])
        self.assertIsNotNone(resolved)
        token, source = resolved
        self.assertEqual(token, FAKE_TOKEN)
        self.assertIn(".npmrc", source)

    def test_npmrc_interpolation_skipped(self):
        home = _home_with({".npmrc": "//registry.npmjs.org/:_authToken=${NPM_TOKEN}"})
        with _without_env_token():
            self.assertIsNone(cmd_release.resolve_npm_token(home, extra_files=[]))

    def test_shell_env_file_export(self):
        home = _home_with({".zshenv":
                           f'export NPM_TOKEN="{FAKE_TOKEN}"\nexport OTHER=1\n'})
        with _without_env_token():
            resolved = cmd_release.resolve_npm_token(home, extra_files=[])
        self.assertIsNotNone(resolved)
        token, source = resolved
        self.assertEqual(token, FAKE_TOKEN)
        self.assertIn(".zshenv", source)

    def test_extra_files_searched(self):
        home = _home_with({"custom/token.sh": f"export NPM_TOKEN={FAKE_TOKEN}"})
        with _without_env_token():
            resolved = cmd_release.resolve_npm_token(
                home, extra_files=[str(home / "custom/token.sh")])
        self.assertIsNotNone(resolved)
        token, source = resolved
        self.assertEqual(token, FAKE_TOKEN)
        self.assertIn("token.sh", source)

    def test_missing_everywhere_returns_none(self):
        home = _home_with({})
        with _without_env_token():
            self.assertIsNone(cmd_release.resolve_npm_token(home, extra_files=[]))


class TestGuardNpmAuth(unittest.TestCase):
    def test_fail_message_lists_chain_without_token(self):
        with mock.patch.object(cmd_release, "resolve_npm_token", return_value=None), \
                contextlib.redirect_stderr(io.StringIO()) as err:
            with self.assertRaises(SystemExit):
                cmd_release.guard_npm_auth()
        text = err.getvalue()
        self.assertIn("查找链", text)
        self.assertNotIn(FAKE_TOKEN, text)

    def test_success_prints_source_only(self):
        with mock.patch.object(cmd_release, "resolve_npm_token",
                               return_value=(FAKE_TOKEN, "/fake/env.sh")), \
                contextlib.redirect_stdout(io.StringIO()) as out:
            token = cmd_release.guard_npm_auth()
        self.assertEqual(token, FAKE_TOKEN)
        text = out.getvalue()
        self.assertIn("/fake/env.sh", text)
        self.assertNotIn(FAKE_TOKEN, text)  # 明文绝不出现在输出中


if __name__ == "__main__":
    unittest.main()
