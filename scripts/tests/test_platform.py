"""platform-sync/upgrade-cli 单测：直连官方 registry、运行中进程探测、平台包一致性。"""
from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from dshctl import cmd_platform, common


class _FakeResponse:
    def __init__(self, status: int):
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


class TestVersionExistsOnRegistry(unittest.TestCase):
    """版本端点判定委托 common（单一事实源）；每例前清进程内备忘，避免串味。"""

    def setUp(self):
        common.clear_registry_cache()

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
        args = mock.Mock(version="0.1.3-alpha.2", force=False, defer=False, clear=False)
        with mock.patch.object(cmd_platform, "version_exists_on_registry",
                               return_value=True), \
                mock.patch.object(cmd_platform, "running_dsh_processes",
                                  return_value=[("123", "node .../bin/dsh web")]):
            with contextlib.redirect_stderr(io.StringIO()) as buf:
                with self.assertRaises(SystemExit):
                    cmd_platform.cmd_upgrade_cli(args)
        self.assertIn("dsh 进程在运行", buf.getvalue())

    def test_force_allows_upgrade_when_running(self):
        args = mock.Mock(version="0.1.3-alpha.2", force=True, defer=False, clear=False)
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


class TestDeferUpgradeGate(unittest.TestCase):
    """defer 模式：待升级标记 + 闸门脚本/drop-in 就位，配合 WebUI /reload 完成升级。"""

    def test_defer_writes_marker_with_prev_version(self):
        args = mock.Mock(version="0.1.3-alpha.2", defer=True, clear=False, force=False)
        with tempfile.TemporaryDirectory() as td:
            marker = Path(td) / "pending.json"
            with mock.patch.object(cmd_platform, "version_exists_on_registry",
                                   return_value=True), \
                    mock.patch.object(cmd_platform, "_ensure_gate_installed") as ensure, \
                    mock.patch.object(cmd_platform, "GATE_MARKER", marker), \
                    mock.patch.object(cmd_platform, "_current_cli_version",
                                      return_value="0.1.2-rc.1"):
                cmd_platform.cmd_upgrade_cli(args)
            ensure.assert_called_once()
            data = json.loads(marker.read_text(encoding="utf-8"))
        self.assertEqual(data["version"], "0.1.3-alpha.2")
        self.assertEqual(data["prev"], "0.1.2-rc.1")

    def test_clear_removes_marker(self):
        with tempfile.TemporaryDirectory() as td:
            marker = Path(td) / "pending.json"
            marker.write_text("{}", encoding="utf-8")
            with mock.patch.object(cmd_platform, "GATE_MARKER", marker):
                cmd_platform._clear_upgrade_gate()
            self.assertFalse(marker.exists())

    def test_clear_without_marker_is_noop(self):
        with tempfile.TemporaryDirectory() as td:
            marker = Path(td) / "pending.json"
            with mock.patch.object(cmd_platform, "GATE_MARKER", marker):
                cmd_platform._clear_upgrade_gate()  # 不抛错即可

    def test_gate_script_template_uses_absolute_bins_and_exec(self):
        script = cmd_platform.GATE_SCRIPT_TEMPLATE.format(
            NPM="/home/agguy/.npm-global/bin/npm",
            DSH="/home/agguy/.npm-global/bin/dsh",
            env_file="/home/agguy/.config/shell/env.sh")
        self.assertIn("npm install -g", script)
        self.assertIn("pending-cli-upgrade.json", script)
        self.assertIn("exec /home/agguy/.npm-global/bin/dsh", script)
        # 升级失败不阻塞启动：无 set -e
        self.assertNotIn("set -e", script)

    def test_dropin_overrides_execstart_and_raises_timeout(self):
        dropin = cmd_platform.GATE_DROPIN_TEMPLATE.format(
            gate="/home/agguy/.dsh/scripts/dsh-web-cli-gate.sh")
        self.assertIn("ExecStart=\n", dropin)
        self.assertIn("ExecStart=/home/agguy/.dsh/scripts/dsh-web-cli-gate.sh", dropin)
        self.assertIn("TimeoutStartSec=600", dropin)


def _render_gate_script(tmp: Path) -> tuple[Path, Path]:
    """把闸门脚本渲染进临时目录，返回 (脚本路径, 隔离的 HOME)。

    假 dsh 回显 PATH 与探针变量，用于断言环境是否真正传到了 exec 后的进程；
    HOME 隔离后不存在待升级标记，闸门走直通分支，不会调用 npm。
    """
    home = tmp / "home"
    home.mkdir()
    env_file = tmp / "env.sh"
    env_file.write_text(f'PATH="{tmp}/custom-bin:$PATH"\nexport PATH\n'
                        "export DSH_GATE_PROBE=injected\n", encoding="utf-8")
    fake_dsh = tmp / "dsh"
    fake_dsh.write_text('#!/usr/bin/env bash\nprintf "PATH=%s\\n" "$PATH"\n'
                        'printf "PROBE=%s\\n" "${DSH_GATE_PROBE:-unset}"\n',
                        encoding="utf-8")
    fake_dsh.chmod(0o755)
    script = tmp / "gate.sh"
    script.write_text(cmd_platform.GATE_SCRIPT_TEMPLATE.format(
        NPM=tmp / "npm-must-not-run", DSH=fake_dsh, env_file=env_file),
        encoding="utf-8")
    script.chmod(0o755)
    return script, home


def _run_gate(script: Path, home: Path) -> subprocess.CompletedProcess:
    return subprocess.run(["bash", str(script)], capture_output=True, text=True,
                          env={"HOME": str(home), "PATH": "/usr/bin:/bin"})


class TestGateScriptShellEnv(unittest.TestCase):
    """闸门覆盖了 10-shell-env.conf 的 ExecStart，须自行把 shell 环境送进 dsh 进程。

    否则 bash 工具继承到的只有 systemd 默认 PATH，缺 ~/.npm-global/bin、
    ~/.bun/bin、ANDROID_HOME 等，模型每次都得手动 export。
    """

    def test_shell_env_reaches_exec_dsh(self):
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            script, home = _render_gate_script(tmp)
            proc = _run_gate(script, home)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertIn(f"PATH={tmp}/custom-bin:", proc.stdout)
            self.assertIn("PROBE=injected", proc.stdout)

    def test_undefined_variable_in_shell_env_does_not_block_start(self):
        # set -u 下取源引用未定义变量会直接终止脚本，闸门到不了 exec，服务起不来
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            script, home = _render_gate_script(tmp)
            (tmp / "env.sh").write_text('echo "$DSH_GATE_UNDEFINED"\n', encoding="utf-8")
            proc = _run_gate(script, home)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertIn("PROBE=unset", proc.stdout)

    def test_missing_shell_env_file_still_starts(self):
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            script, home = _render_gate_script(tmp)
            (tmp / "env.sh").unlink()
            proc = _run_gate(script, home)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertIn("PROBE=unset", proc.stdout)


if __name__ == "__main__":
    unittest.main()
