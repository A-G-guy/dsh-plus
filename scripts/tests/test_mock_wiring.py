"""mock LLM 接线的单测：行块内容、幂等注入、注入路径。

背景（2026-10-04 事故）：mock 配置曾写进 `$DSH_HOME/settings.yaml`，而 0.2.x 的
settings 服务只导入「有 volatile 字段」的段——`llm-pi-ai` 的 providers 不在其列，
整段被拒并留在 `settings.yaml.imported`，冒烟于是用官方默认 provider 打真实网关
（401，无费用但违反零真实调用）。修法：mock 接线改为 profile patch 行注入。
"""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest import mock

from dshctl import cmd_dev

TEMPLATE = """\
# Your patch layer for this dsh profile:
[]
"""


class TestMockPatchRows(unittest.TestCase):
    def test_行块只指向本机mock且重述必要字段(self):
        rows = cmd_dev.MOCK_PATCH_ROWS
        self.assertIn(f"http://127.0.0.1:{cmd_dev.MOCK_PORT}/v1", rows)
        self.assertIn("- id: llm-pi-ai", rows)
        self.assertIn("- id: agent-default-model", rows)
        self.assertIn("defaultPreset: danger-full-access", rows)
        self.assertNotIn("miniserver", rows)
        self.assertNotIn("api.deepseek.com", rows)

    def test_默认模型走mock路由而非官方路由(self):
        rows = cmd_dev.MOCK_PATCH_ROWS
        self.assertIn("provider: deepseek\n    model: deepseek-v4-flash", rows)
        self.assertNotIn("deepseek-official", rows)


class TestAppendPatchRows(unittest.TestCase):
    def _patch(self, root: Path, text: str) -> Path:
        path = root / "cordis.patch.yml"
        path.write_text(text, encoding="utf-8")
        return path

    def test_空模板去掉占位数组后追加(self):
        with tempfile.TemporaryDirectory() as tmp:
            patch = self._patch(Path(tmp), TEMPLATE)
            written = cmd_dev.append_patch_rows(
                patch, cmd_dev.MOCK_PATCH_ROWS, cmd_dev.MOCK_PATCH_MARKER)
            self.assertTrue(written)
            text = patch.read_text(encoding="utf-8")
            self.assertNotIn("[]", text)
            self.assertIn("- id: llm-pi-ai", text)

    def test_marker已存在即跳过(self):
        with tempfile.TemporaryDirectory() as tmp:
            patch = self._patch(Path(tmp), TEMPLATE)
            cmd_dev.append_patch_rows(patch, cmd_dev.MOCK_PATCH_ROWS, cmd_dev.MOCK_PATCH_MARKER)
            once = patch.read_text(encoding="utf-8")
            written = cmd_dev.append_patch_rows(
                patch, cmd_dev.MOCK_PATCH_ROWS, cmd_dev.MOCK_PATCH_MARKER)
            self.assertFalse(written)
            self.assertEqual(patch.read_text(encoding="utf-8"), once)

    def test_补丁缺失返回False(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertFalse(cmd_dev.append_patch_rows(
                Path(tmp) / "missing.yml", cmd_dev.MOCK_PATCH_ROWS, cmd_dev.MOCK_PATCH_MARKER))


class TestEnsureMockRows(unittest.TestCase):
    def test_写入dev_profile补丁(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            profile_dir = root / "profiles" / "web"
            profile_dir.mkdir(parents=True)
            patch = profile_dir / "cordis.patch.yml"
            patch.write_text(TEMPLATE, encoding="utf-8")
            with mock.patch.object(cmd_dev, "dev_profile_dir",
                                   lambda name=cmd_dev.DEV_PROFILE: root / "profiles" / name):
                cmd_dev._ensure_mock_rows("web")
            text = patch.read_text(encoding="utf-8")
            self.assertIn(cmd_dev.MOCK_PATCH_MARKER, text)
            self.assertIn("- id: llm-pi-ai", text)


if __name__ == "__main__":
    unittest.main()
