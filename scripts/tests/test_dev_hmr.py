"""dev profile HMR 监听行注入单测：幂等、仅交互式 profile、空模板与已有行处理。

背景：dev profile 用 link: 安装 workspace 包，模块解析到本仓 packages/<name>，
配好 hmr.root 后 `pnpm -r build` 即可在运行实例内热替换（生产 tarball 布局不行）。
"""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest import mock

from dshctl import cmd_dev

TEMPLATE = """\
# Your patch layer for this dsh profile, applied after every bundle layer:
[]
"""

WITH_ROWS = """\
# ── 已有行 ──
- id: dsh-plus-reload
  disabled: true
"""


class TestEnsureHmrRoot(unittest.TestCase):
    def _patch(self, root: Path, profile: str, text: str) -> Path:
        profile_dir = root / "profiles" / profile
        profile_dir.mkdir(parents=True, exist_ok=True)
        patch = profile_dir / "cordis.patch.yml"
        patch.write_text(text, encoding="utf-8")
        return patch

    def _run(self, root: Path, profile: str) -> None:
        with mock.patch.object(cmd_dev, "dev_profile_dir",
                               lambda name=cmd_dev.DEV_PROFILE: root / "profiles" / name):
            cmd_dev._ensure_hmr_root(profile)

    def test_空模板追加监听行并去掉占位数组(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            patch = self._patch(root, "web", TEMPLATE)
            self._run(root, "web")
            text = patch.read_text(encoding="utf-8")
            self.assertIn("- id: hmr", text)
            self.assertIn(str(cmd_dev.PACKAGES_DIR), text)
            self.assertIn("**/node_modules", text)
            self.assertNotIn("[]", text)

    def test_已有行时保留原行并追加(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            patch = self._patch(root, "web", WITH_ROWS)
            self._run(root, "web")
            text = patch.read_text(encoding="utf-8")
            self.assertIn("id: dsh-plus-reload", text)
            self.assertIn("- id: hmr", text)

    def test_重复调用幂等(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            patch = self._patch(root, "web", TEMPLATE)
            self._run(root, "web")
            once = patch.read_text(encoding="utf-8")
            self._run(root, "web")
            self.assertEqual(patch.read_text(encoding="utf-8"), once)
            self.assertEqual(once.count("- id: hmr"), 1)

    def test_已有用户hmr行不覆盖(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            text = "[]\n\n- id: hmr\n  config:\n    root: [\"/custom\"]\n"
            patch = self._patch(root, "web", text)
            self._run(root, "web")
            self.assertEqual(patch.read_text(encoding="utf-8"), text)

    def test_非空补丁追加在末尾(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            patch = self._patch(root, "web", "- id: dsh-plus-reload\n  disabled: true\n")
            self._run(root, "web")
            text = patch.read_text(encoding="utf-8")
            self.assertTrue(text.rstrip().endswith('"cache", "data"]'))
            self.assertIn("- id: dsh-plus-reload", text)

    def test_headless不注入(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            patch = self._patch(root, "headless", TEMPLATE)
            self._run(root, "headless")
            self.assertEqual(patch.read_text(encoding="utf-8"), TEMPLATE)

    def test_补丁文件缺失静默返回(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._run(Path(tmp), "web")


if __name__ == "__main__":
    unittest.main()
