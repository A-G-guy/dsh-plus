"""pwcli 共享层单测：会话枚举解析、wrapper 选择（不起真实浏览器）。"""
from __future__ import annotations

import subprocess
import unittest
from unittest import mock

from dshctl import pwcli


class TestExtractSessionNames(unittest.TestCase):
    def test_plain_string_list(self):
        self.assertEqual(pwcli._extract_session_names(["a", "b"]), ["a", "b"])

    def test_dict_wrapper(self):
        data = {"sessions": [{"session": "dsh-dev"}, {"name": "dsh-alt"}]}
        self.assertEqual(pwcli._extract_session_names(data), ["dsh-dev", "dsh-alt"])

    def test_garbage_yields_empty(self):
        self.assertEqual(pwcli._extract_session_names({"unexpected": 1}), [])
        self.assertEqual(pwcli._extract_session_names([{"x": 1}, 42]), [])


class TestFallbackParsing(unittest.TestCase):
    def test_lines(self):
        text = "dsh-dev\ndsh-alt\n"
        self.assertEqual(pwcli._parse_sessions_fallback(text), ["dsh-dev", "dsh-alt"])

    def test_skips_structural_tokens(self):
        text = '[\n"dsh-dev",\n]'
        self.assertEqual(pwcli._parse_sessions_fallback(text), ["dsh-dev"])


class TestPwSessions(unittest.TestCase):
    def test_json_output(self):
        proc = subprocess.CompletedProcess([], 0, '["dsh-dev"]', "")
        with mock.patch.object(pwcli, "run", return_value=proc):
            self.assertEqual(pwcli.pw_sessions(), ["dsh-dev"])

    def test_non_json_fallback(self):
        proc = subprocess.CompletedProcess([], 0, "dsh-dev\n", "")
        with mock.patch.object(pwcli, "run", return_value=proc):
            self.assertEqual(pwcli.pw_sessions(), ["dsh-dev"])


class _FakePath:
    """PosixPath 实例方法只读不可 patch，用桩对象替换模块常量。"""

    def __init__(self, exists: bool):
        self._exists = exists

    def exists(self) -> bool:
        return self._exists

    def __str__(self) -> str:
        return "/fake/playwright_cli.sh"


class TestPwcliBase(unittest.TestCase):
    def test_skill_wrapper_preferred(self):
        with mock.patch.object(pwcli, "SKILL_WRAPPER", _FakePath(True)):
            base = pwcli.pwcli_base()
        self.assertEqual(base[0], "bash")
        self.assertIn("playwright_cli.sh", base[1])

    def test_npx_fallback(self):
        with mock.patch.object(pwcli, "SKILL_WRAPPER", _FakePath(False)), \
                mock.patch("shutil.which", return_value="/usr/bin/npx"):
            base = pwcli.pwcli_base()
        self.assertEqual(base[0], "npx")

    def test_missing_everything_fails(self):
        with mock.patch.object(pwcli, "SKILL_WRAPPER", _FakePath(False)), \
                mock.patch("shutil.which", return_value=None):
            with self.assertRaises(SystemExit):
                pwcli.pwcli_base()


if __name__ == "__main__":
    unittest.main()
