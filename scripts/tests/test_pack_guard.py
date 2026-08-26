"""平台包单实例红线单测：闭包守卫、顶层遮蔽扫描、vendor 孤儿清理、dry-run 无写盘。"""
from __future__ import annotations

import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from dshctl import cmd_pack
from dshctl.common import (find_platform_shadows, is_platform_package,
                           platform_runtime_deps)


def _make_pkg(root: Path, dirname: str, name: str,
              deps: dict[str, str] | None = None) -> Path:
    pkg = root / dirname
    pkg.mkdir(parents=True)
    meta = {"name": name, "version": "0.1.0", "dependencies": deps or {}}
    (pkg / "package.json").write_text(json.dumps(meta), encoding="utf-8")
    return pkg


class TestPlatformPackageRule(unittest.TestCase):
    def test_scope_and_extra_detected(self):
        self.assertTrue(is_platform_package("@deepseek-ai/dsh-tools"))
        self.assertTrue(is_platform_package("@earendil-works/pi-ai"))
        self.assertFalse(is_platform_package("@dsh-plus/shared"))
        self.assertFalse(is_platform_package("nodemailer"))

    def test_runtime_sections_only(self):
        meta = {
            "dependencies": {"@deepseek-ai/dsh-tools": "0.1.0-rc.8"},
            "optionalDependencies": {"@deepseek-ai/cordis": "4.0.1"},
            "peerDependencies": {"@deepseek-ai/dsh-llm": "^0.1.0-rc.8"},
            "devDependencies": {"@deepseek-ai/dsh-agent": "0.1.0-rc.8"},
        }
        self.assertEqual(platform_runtime_deps(meta),
                         ["@deepseek-ai/cordis", "@deepseek-ai/dsh-tools"])


class TestClosureGuard(unittest.TestCase):
    def test_rejects_platform_runtime_dep(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            bad = _make_pkg(root, "bad", "@dsh-plus/bad",
                            {"@deepseek-ai/dsh-tools": "0.1.0-rc.8"})
            with self.assertRaises(SystemExit):
                cmd_pack._guard_closure_no_platform_runtime_deps([bad])

    def test_allows_peer_only(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            good = _make_pkg(root, "good", "@dsh-plus/good",
                             {"nodemailer": "9.0.5"})
            meta = json.loads((good / "package.json").read_text(encoding="utf-8"))
            meta["peerDependencies"] = {"@deepseek-ai/dsh-tools": "^0.1.0-rc.8"}
            (good / "package.json").write_text(json.dumps(meta), encoding="utf-8")
            cmd_pack._guard_closure_no_platform_runtime_deps([good])  # 不抛即过


class TestFindPlatformShadows(unittest.TestCase):
    def test_real_dir_detected_symlink_ignored(self):
        with tempfile.TemporaryDirectory() as td:
            nm = Path(td) / "profiles/web/node_modules/@deepseek-ai"
            (nm / "dsh-tools").mkdir(parents=True)
            (nm / "dsh-llm").mkdir()
            link_target = Path(td) / "elsewhere/cordis"
            link_target.mkdir(parents=True)
            (nm / "cordis").symlink_to(link_target)
            self.assertEqual(find_platform_shadows(Path(td)),
                             ["@deepseek-ai/dsh-llm", "@deepseek-ai/dsh-tools"])

    def test_missing_layout_is_clean(self):
        with tempfile.TemporaryDirectory() as td:
            self.assertEqual(find_platform_shadows(Path(td)), [])


class TestVendorOrphanSweep(unittest.TestCase):
    def test_unreferenced_tarballs_removed(self):
        with tempfile.TemporaryDirectory() as td:
            prod = Path(td)
            vendor = prod / "profiles/web/vendor/dsh-plus"
            vendor.mkdir(parents=True)
            (vendor / "dsh-plus-shared-0.1.0-aaa.tgz").write_bytes(b"keep")
            (vendor / "dsh-plus-tool-text-transform-0.1.1-bbb.tgz").write_bytes(b"orphan")
            meta = {"dependencies": {
                "@dsh-plus/shared": "file:./vendor/dsh-plus/dsh-plus-shared-0.1.0-aaa.tgz"}}
            with mock.patch.object(cmd_pack, "PROD_HOME", prod):
                with contextlib.redirect_stdout(io.StringIO()):
                    cmd_pack._sweep_vendor_tarballs(meta)
            remaining = sorted(p.name for p in vendor.glob("*.tgz"))
            self.assertEqual(remaining, ["dsh-plus-shared-0.1.0-aaa.tgz"])

    def test_override_reference_keeps_tarball(self):
        with tempfile.TemporaryDirectory() as td:
            prod = Path(td)
            vendor = prod / "profiles/web/vendor/dsh-plus"
            vendor.mkdir(parents=True)
            (vendor / "dsh-plus-x-0.1.0-ccc.tgz").write_bytes(b"keep")
            meta = {"dependencies": {}, "pnpm": {"overrides": {
                "@dsh-plus/x": "file:./vendor/dsh-plus/dsh-plus-x-0.1.0-ccc.tgz"}}}
            with mock.patch.object(cmd_pack, "PROD_HOME", prod):
                with contextlib.redirect_stdout(io.StringIO()):
                    cmd_pack._sweep_vendor_tarballs(meta)
            self.assertEqual(len(list(vendor.glob("*.tgz"))), 1)


class TestInstallDryRun(unittest.TestCase):
    def test_dry_run_writes_nothing(self):
        pkg_json = cmd_pack._prod_profile_dir() / "package.json"
        before = pkg_json.read_bytes() if pkg_json.exists() else None
        with contextlib.redirect_stdout(io.StringIO()):
            cmd_pack.cmd_install_prod_dry_run(cmd_pack.REPO_ROOT / "packages/shared")
        after = pkg_json.read_bytes() if pkg_json.exists() else None
        self.assertEqual(before, after)


if __name__ == "__main__":
    unittest.main()
