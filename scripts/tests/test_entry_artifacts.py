"""入口产物校验单测：声明/产物不符必须被拦下（2026-09-29 .mjs 事故回归）。

背景：agent-preset-chat 脚手架构建缺 --no-fixed-extension，产物 lib/index.mjs
而 exports 指 lib/index.js，发布后宿主 failed to import；tsc 与 node --test
都读 src 拦不住。此处钉住校验的三个关键判定。
"""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from dshctl.cmd_doctor import missing_entry_artifacts


def _pkg(root: Path, name: str, meta: dict, files: list[str]) -> Path:
    pkg = root / name
    (pkg / "lib").mkdir(parents=True)
    (pkg / "package.json").write_text(json.dumps(meta), encoding="utf-8")
    for rel in files:
        target = pkg / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("", encoding="utf-8")
    return pkg


BASE = {
    "name": "@dsh-plus/demo",
    "main": "lib/index.js",
    "types": "lib/index.d.ts",
    "exports": {".": {"types": "./lib/index.d.ts", "default": "./lib/index.js"}},
}


class TestMissingEntryArtifacts(unittest.TestCase):
    def test_gives_when_product_extension_matches_declaration(self):
        """产物齐全 → 无缺失。"""
        with tempfile.TemporaryDirectory() as tmp:
            pkg = _pkg(Path(tmp), "demo", dict(BASE),
                       ["lib/index.js", "lib/index.d.ts"])
            self.assertEqual(missing_entry_artifacts([pkg]), [])

    def test_detects_when_only_mjs_built_but_js_declared(self):
        """只构建了 .mjs 而声明 .js → 报缺失（本次事故形态）。"""
        with tempfile.TemporaryDirectory() as tmp:
            pkg = _pkg(Path(tmp), "demo", dict(BASE),
                       ["lib/index.mjs", "lib/index.d.mts"])
            # main 与 exports 指同一文件，归一化去重后各报一次。
            self.assertEqual(
                missing_entry_artifacts([pkg]),
                ["@dsh-plus/demo → lib/index.d.ts",
                 "@dsh-plus/demo → lib/index.js"])

    def test_gives_when_manifest_absent_or_wildcard_export(self):
        """无 package.json 的目录跳过；带 * 的 exports 子路径不校验。"""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "no-manifest").mkdir()
            meta = dict(BASE, exports={".": BASE["exports"]["."],
                                       "./src/*": "./src/*"})
            pkg = _pkg(root, "demo", meta, ["lib/index.js", "lib/index.d.ts"])
            self.assertEqual(missing_entry_artifacts(
                [root / "no-manifest", pkg]), [])


if __name__ == "__main__":
    unittest.main()
