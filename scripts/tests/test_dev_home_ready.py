"""dev home 初始化判据单测。

背景（2026-10-06 维护事故）：`$DSH_HOME/settings.yaml` 自 dsh 0.2.x 起废弃
（启动时改名 `.imported` 并并入 profile 的 `cordis.patch.yml`），而
`dev seed` / `hl` / `smoke` 仍以该文件是否存在判定「dev home 已初始化」——
判据恒假，三条命令必报「dev home 未初始化」。
"""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest import mock

from dshctl import common


class TestDevProfileReady(unittest.TestCase):
    def _ready(self, root: Path, profile: str = common.DEV_PROFILE) -> bool:
        with mock.patch.object(common, "DEV_HOME", root):
            return common.dev_profile_ready(profile)

    def test_profile模板落盘即视为已初始化(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "profiles" / "web").mkdir(parents=True)
            (root / "profiles" / "web" / "package.json").write_text("{}", encoding="utf-8")
            self.assertTrue(self._ready(root))
            self.assertFalse(self._ready(root, "headless"))

    def test_仅存已废弃settings导入件不算已初始化(self):
        """回归：只剩 settings.yaml.imported 时判据必须为假。"""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "profiles" / "web").mkdir(parents=True)
            (root / "settings.yaml.imported").write_text("{}", encoding="utf-8")
            self.assertFalse(self._ready(root))
            with mock.patch.object(common, "DEV_HOME", root):
                self.assertEqual(common.dev_profile_dir(), root / "profiles" / "web")

    def test_未初始化的空home判据为假(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.assertFalse(self._ready(root))
            self.assertFalse(self._ready(root, "headless"))


if __name__ == "__main__":
    unittest.main()
