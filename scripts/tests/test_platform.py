"""platform-sync 版本核验单测：直连官方 registry（不受本机镜像同步延迟影响）。"""
from __future__ import annotations

import unittest
from unittest import mock

from dshctl import cmd_platform


class _FakeResponse:
    def __init__(self, status: int):
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


class TestVersionExistsOnRegistry(unittest.TestCase):
    def test_existing_version_returns_true(self):
        with mock.patch("urllib.request.urlopen", return_value=_FakeResponse(200)):
            self.assertTrue(
                cmd_platform.version_exists_on_registry("@deepseek-ai/dsh", "0.1.3-alpha.2"))

    def test_missing_version_returns_false(self):
        with mock.patch("urllib.request.urlopen",
                        side_effect=__import__("urllib.error").error.HTTPError(
                            "url", 404, "Not Found", None, None)):
            self.assertFalse(
                cmd_platform.version_exists_on_registry("@deepseek-ai/dsh", "9.9.9"))

    def test_other_http_error_fails(self):
        with mock.patch("urllib.request.urlopen",
                        side_effect=__import__("urllib.error").error.HTTPError(
                            "url", 500, "Internal", None, None)):
            with self.assertRaises(SystemExit):
                cmd_platform.version_exists_on_registry("@deepseek-ai/dsh", "0.1.3-alpha.2")

    def test_scoped_name_is_url_encoded(self):
        captured: list[str] = []

        def fake_urlopen(req, **_kwargs):
            captured.append(req.full_url)
            return _FakeResponse(200)

        with mock.patch("urllib.request.urlopen", side_effect=fake_urlopen):
            cmd_platform.version_exists_on_registry("@deepseek-ai/dsh", "0.1.3-alpha.2")
        self.assertEqual(captured,
                         ["https://registry.npmjs.org/@deepseek-ai%2fdsh/0.1.3-alpha.2"])


if __name__ == "__main__":
    unittest.main()
