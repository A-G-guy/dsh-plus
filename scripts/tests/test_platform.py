"""platform-sync/upgrade-cli 单测：直连官方 registry、运行中进程探测、平台包一致性。"""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
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


class TestRunningDshProcesses(unittest.TestCase):
    """升级 CLI 前的运行中进程探测：防止替换全局包文件导致生产 GUI 黑屏。"""

    def test_detects_web_and_headless_from_global_cli(self):
        ps_output = (
            "  123 node /home/agguy/.npm-global/bin/dsh web --trusted-host x\n"
            "  456 node /home/agguy/.npm-global/bin/dsh headless --cwd /tmp\n"
            "  789 node /home/agguy/other/bin/dsh web\n"
            "  321 python3 scripts/dshctl.py doctor\n"
        )
        with mock.patch("subprocess.run") as run:
            run.return_value.stdout = ps_output
            rows = cmd_platform.running_dsh_processes()
        # 任何 bin/dsh 启动的 web/headless 进程都在升级影响面内（含非全局路径）
        self.assertEqual([pid for pid, _ in rows], ["123", "456", "789"])

    def test_empty_when_no_process(self):
        with mock.patch("subprocess.run") as run:
            run.return_value.stdout = "  321 python3 scripts/dshctl.py doctor\n"
            self.assertEqual(cmd_platform.running_dsh_processes(), [])


class TestGlobalPlatformVersions(unittest.TestCase):
    """升级后的平台包一致性抽查：暴露 npm prerelease 范围导致的混合版本。"""

    def test_reads_spot_check_versions(self):
        with tempfile.TemporaryDirectory() as td:
            base = Path(td) / "node_modules"
            for name, version in (("dsh", "0.1.3-alpha.2"),
                                  ("dsh-session", "0.1.2-alpha.2"),
                                  ("dsh-agent-loop", "0.1.3-alpha.2")):
                pkg = base / "@deepseek-ai" / name
                pkg.mkdir(parents=True)
                (pkg / "package.json").write_text(
                    json.dumps({"name": f"@deepseek-ai/{name}", "version": version}),
                    encoding="utf-8")
            versions = cmd_platform.global_platform_versions(root=base)
        self.assertEqual(versions["dsh"], "0.1.3-alpha.2")
        self.assertEqual(versions["dsh-session"], "0.1.2-alpha.2")
        self.assertEqual(versions["dsh-agent-loop"], "0.1.3-alpha.2")

    def test_missing_packages_reported_as_unknown(self):
        with tempfile.TemporaryDirectory() as td:
            base = Path(td) / "node_modules"
            versions = cmd_platform.global_platform_versions(root=base)
        self.assertEqual(versions, {})


class TestUpgradeCliGuard(unittest.TestCase):
    """upgrade-cli 的运行中进程防御：有进程且无 --force 时拒绝升级。"""

    def test_rejects_when_processes_running(self):
        import contextlib
        import io
        args = mock.Mock(version="0.1.3-alpha.2", force=False)
        with mock.patch.object(cmd_platform, "version_exists_on_registry",
                               return_value=True), \
                mock.patch.object(cmd_platform, "running_dsh_processes",
                                  return_value=[("123", "node .../bin/dsh web")]):
            with contextlib.redirect_stderr(io.StringIO()) as buf:
                with self.assertRaises(SystemExit):
                    cmd_platform.cmd_upgrade_cli(args)
        self.assertIn("dsh 进程在运行", buf.getvalue())

    def test_force_allows_upgrade_when_running(self):
        args = mock.Mock(version="0.1.3-alpha.2", force=True)
        with mock.patch.object(cmd_platform, "version_exists_on_registry",
                               return_value=True), \
                mock.patch.object(cmd_platform, "running_dsh_processes",
                                  return_value=[("123", "node .../bin/dsh web")]), \
                mock.patch.object(cmd_platform, "run") as run, \
                mock.patch("subprocess.run", return_value=mock.Mock(
                    stdout="0.1.3-alpha.2\n", stderr="")), \
                mock.patch.object(cmd_platform, "global_platform_versions",
                                  return_value={"dsh": "0.1.3-alpha.2",
                                                "dsh-session": "0.1.3-alpha.2"}):
            cmd_platform.cmd_upgrade_cli(args)
        run.assert_called_once()


if __name__ == "__main__":
    unittest.main()
