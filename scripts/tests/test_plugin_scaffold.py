"""new-plugin 脚手架的闸门入场规则：每个模板产出的包都必须带 tsconfig.json。

dshctl typecheck 以「含 tsconfig.json 的包」为检查目标，脚手架漏配会让新包
静默逃过类型闸门——这是回归风险最高的一处（新包最容易消费官方新契约）。
"""
from __future__ import annotations

import re
import tempfile
import unittest
from pathlib import Path

from dshctl import cmd_plugin


class TestScaffoldTypecheckAdmission(unittest.TestCase):
    def _scaffold(self, kind: str) -> Path:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        pkg_dir = Path(tmp.name) / f"demo-{kind}"
        cmd_plugin._scaffold(pkg_dir, kind, f"demo-{kind}")
        return pkg_dir

    def test_every_template_ships_tsconfig(self):
        for kind in cmd_plugin.TEMPLATES:
            with self.subTest(kind=kind):
                self.assertTrue((self._scaffold(kind) / "tsconfig.json").exists())

    def test_ui_template_gets_dom_and_jsx(self):
        """UI 模板有浏览器半：缺 jsx/DOM 会让 client.tsx 一写就报错。"""
        raw = (self._scaffold("ui") / "tsconfig.json").read_text(encoding="utf-8")
        self.assertTrue(re.search(r'^\s*"jsx":', raw, re.M))
        self.assertIn("DOM", re.sub(r"//.*", "", raw))

    def test_host_templates_stay_node_only(self):
        """host-only 模板不给 DOM：host 代码误用 document 应在类型层被拦住。"""
        for kind in ("tool", "service", "persona"):
            with self.subTest(kind=kind):
                raw = (self._scaffold(kind) / "tsconfig.json").read_text(encoding="utf-8")
                self.assertFalse(re.search(r'^\s*"jsx":', raw, re.M))
                self.assertNotIn("DOM", re.sub(r"//.*", "", raw))


if __name__ == "__main__":
    unittest.main()
