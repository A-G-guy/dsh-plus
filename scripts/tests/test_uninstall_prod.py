"""整包下线后的生产卸载单测：profile 侧目标识别与 workspace 规格摘除。

背景：包已从仓库删除时 workspace 查不到目录（find_package 直接失败），
而 profile 里仍登记着 dependencies / pnpm.overrides / minimumReleaseAgeExclude；
pnpm 11 只读 pnpm-workspace.yaml 的 overrides，漏摘会让已删 tarball 的
file: spec 继续生效，install 直接失败。
"""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from dshctl import cmd_pack

# 与本机生产 profile 同形（overrides + minimumReleaseAgeExclude 两块）。
WORKSPACE_YAML = """\
packages:
  - .
nodeLinker: hoisted
minimumReleaseAgeExclude:
  - '@dsh-plus/shared'
  - '@dsh-plus/web-terminal'
  - '@dsh-plus/web-terminal@0.1.0'
  - lucide-react@1.38.0
overrides:
  '@dsh-plus/shared': 'file:./vendor/dsh-plus/dsh-plus-shared-0.1.24-aa.tgz'
  '@dsh-plus/web-terminal': 'file:./vendor/dsh-plus/dsh-plus-web-terminal-0.1.22-bb.tgz'
allowBuilds:
  node-pty: true
"""


def _write_profile(root: Path) -> Path:
    root.mkdir(parents=True, exist_ok=True)
    (root / "pnpm-workspace.yaml").write_text(WORKSPACE_YAML, encoding="utf-8")
    return root


class TestExcludeOwner(unittest.TestCase):
    def test_裸包名原样(self):
        self.assertEqual(cmd_pack._exclude_owner("@dsh-plus/web-terminal"),
                         "@dsh-plus/web-terminal")

    def test_带版本后缀只留包名(self):
        self.assertEqual(cmd_pack._exclude_owner("@dsh-plus/web-terminal@0.1.0"),
                         "@dsh-plus/web-terminal")
        self.assertEqual(cmd_pack._exclude_owner("lucide-react@1.38.0"), "lucide-react")

    def test_scope通配符不被截断(self):
        self.assertEqual(cmd_pack._exclude_owner("@deepseek-ai/*"), "@deepseek-ai/*")


class TestRemoveWorkspaceSpecs(unittest.TestCase):
    def test_摘除卸载包的_overrides_与_exclude_并保留其余(self):
        with tempfile.TemporaryDirectory() as td:
            profile = _write_profile(Path(td))
            cmd_pack._remove_workspace_specs(profile, {"@dsh-plus/web-terminal"})
            text = (profile / "pnpm-workspace.yaml").read_text(encoding="utf-8")

        # 被卸载包两处规格都消失（含历史带版本的 exclude 条目）
        self.assertNotIn("web-terminal", text)
        # 其余条目与非规格区块原样保留
        self.assertIn("'@dsh-plus/shared': 'file:./vendor/dsh-plus/dsh-plus-shared-0.1.24-aa.tgz'", text)
        self.assertIn("- '@dsh-plus/shared'", text)
        # exclude 重建时统一为带引号形态（与 install 路径同规）
        self.assertIn("- 'lucide-react@1.38.0'", text)
        self.assertIn("allowBuilds:", text)
        self.assertIn("node-pty: true", text)

    def test_未命中则不改写文件(self):
        with tempfile.TemporaryDirectory() as td:
            profile = _write_profile(Path(td))
            before = (profile / "pnpm-workspace.yaml").read_bytes()
            cmd_pack._remove_workspace_specs(profile, {"@dsh-plus/not-installed"})
            after = (profile / "pnpm-workspace.yaml").read_bytes()
        self.assertEqual(before, after)


class TestProfileOwnedName(unittest.TestCase):
    def _prod(self, root: Path, deps: dict, overrides: dict, bundles: list[str]) -> None:
        profile = root / "profiles/web"
        profile.mkdir(parents=True, exist_ok=True)
        (profile / "package.json").write_text(json.dumps({
            "name": "dsh-profile-web",
            "dependencies": deps,
            "pnpm": {"overrides": overrides},
            "dsh": {"profile": {"bundles": bundles}},
        }), encoding="utf-8")

    def test_短名命中_profile_登记(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            self._prod(root, {"@dsh-plus/web-terminal": "file:./vendor/x.tgz"}, {}, [])
            with mock.patch.object(cmd_pack, "PROD_HOME", root):
                self.assertEqual(cmd_pack._profile_owned_name("web-terminal"),
                                 "@dsh-plus/web-terminal")

    def test_未登记返回_None(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            self._prod(root, {"@dsh-plus/shared": "file:./vendor/y.tgz"}, {}, [])
            with mock.patch.object(cmd_pack, "PROD_HOME", root):
                self.assertIsNone(cmd_pack._profile_owned_name("web-terminal"))


if __name__ == "__main__":
    unittest.main()
