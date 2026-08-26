"""finish 纯逻辑单测：提交信息校验、porcelain 改动解析、bump 计划、安装目标并集、
client 打苞依赖方级联。"""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from dshctl import cmd_finish


class TestValidCommitMessage(unittest.TestCase):
    def test_accepts_conventional_types(self):
        for msg in ("feat: 新增收尾命令", "fix(ui): 修复按钮溢出",
                    "docs: 更新发版文档\ndocs: 第二行不校验",
                    "chore!: 破坏性清理", "refactor: 拆分模块"):
            self.assertTrue(cmd_finish.valid_commit_message(msg), msg)

    def test_rejects_non_conventional(self):
        for msg in ("新增收尾命令", "Feat: 大写类型", "feat:缺少空格",
                    "wip: 白名单外类型", "", "   "):
            self.assertFalse(cmd_finish.valid_commit_message(msg), msg)


class TestDirtyPackageDirs(unittest.TestCase):
    def test_extracts_changed_package_dirs(self):
        porcelain = (
            " M packages/shared/src/index.ts\n"
            "?? packages/tool-x/package.json\n"
            "M  docs/repo/仓库管理规范.md\n"
            "R  packages/old/a.ts -> packages/new/a.ts\n"
        )
        self.assertEqual(cmd_finish.dirty_package_dirs(porcelain),
                         ["new", "shared", "tool-x"])

    def test_ignores_non_package_paths_and_empty(self):
        self.assertEqual(cmd_finish.dirty_package_dirs(""), [])
        self.assertEqual(cmd_finish.dirty_package_dirs(" M scripts/dshctl.py\n"), [])

    def test_dedupes_multiple_files_in_same_package(self):
        porcelain = " M packages/shared/a.ts\n M packages/shared/b.ts\n"
        self.assertEqual(cmd_finish.dirty_package_dirs(porcelain), ["shared"])


class TestPlanBumps(unittest.TestCase):
    def test_bumps_only_when_local_version_already_published(self):
        metas = [{"name": "@dsh-plus/a", "version": "0.1.3"},
                 {"name": "@dsh-plus/b", "version": "0.2.0"}]
        published = {("@dsh-plus/a", "0.1.3")}
        plan = cmd_finish.plan_bumps(
            metas, "patch", lambda n, v: (n, v) in published)
        self.assertEqual(plan, [("@dsh-plus/a", "0.1.3", "0.1.4")])

    def test_pending_version_not_bumped_again(self):
        metas = [{"name": "@dsh-plus/a", "version": "0.2.0"}]
        plan = cmd_finish.plan_bumps(metas, "minor", lambda n, v: False)
        self.assertEqual(plan, [])

    def test_invalid_local_version_rejected(self):
        metas = [{"name": "@dsh-plus/a", "version": "1.0"}]
        with self.assertRaises(SystemExit):
            cmd_finish.plan_bumps(metas, "patch", lambda n, v: True)


class TestInstallTargets(unittest.TestCase):
    def test_union_dedupes_preserving_order(self):
        targets = [Path("/p/a"), Path("/p/b")]
        published = [Path("/p/b"), Path("/p/c")]
        self.assertEqual(cmd_finish.install_targets(targets, published),
                         [Path("/p/a"), Path("/p/b"), Path("/p/c")])

    def test_empty_when_nothing_to_install(self):
        self.assertEqual(cmd_finish.install_targets([], []), [])


def _write_pkg(root: Path, dirname: str, name: str,
               client_files: dict[str, str] | None = None,
               node_imports: list[str] | None = None) -> Path:
    """造一个最小包：package.json（有 client_files 时声明 ./client 出口）
    + src/client.tsx 等 client 源码 + 可选 src/index.ts（node 半）。"""
    pkg = root / dirname
    (pkg / "src").mkdir(parents=True)
    exports = {"./client": "./lib/client.js"} if client_files is not None else {}
    (pkg / "package.json").write_text(
        json.dumps({"name": name, "version": "0.1.0", "exports": exports}))
    for rel, content in (client_files or {}).items():
        path = pkg / "src" / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
    if node_imports is not None:
        lines = [f"import {{ x }} from '{spec}'" for spec in node_imports]
        (pkg / "src" / "index.ts").write_text("\n".join(lines))
    return pkg


def _client_importing(*specs: str) -> dict[str, str]:
    return {"client.tsx": "\n".join(f"import {{ x }} from '{s}'" for s in specs)}


class TestClientEmbeds(unittest.TestCase):
    def test_detects_dep_in_client_entry(self):
        with tempfile.TemporaryDirectory() as tmp:
            pkg = _write_pkg(Path(tmp), "b", "@dsh-plus/b",
                             client_files=_client_importing("@dsh-plus/a/client"))
            self.assertTrue(cmd_finish.client_embeds(pkg, "@dsh-plus/a"))

    def test_follows_relative_import_closure(self):
        with tempfile.TemporaryDirectory() as tmp:
            pkg = _write_pkg(Path(tmp), "b", "@dsh-plus/b", client_files={
                "client.tsx": "import { y } from './panel/card'",
                "panel/card.tsx": "import { x } from '@dsh-plus/a/client'",
            })
            self.assertTrue(cmd_finish.client_embeds(pkg, "@dsh-plus/a"))

    def test_ignores_node_half_imports(self):
        with tempfile.TemporaryDirectory() as tmp:
            pkg = _write_pkg(Path(tmp), "b", "@dsh-plus/b",
                             client_files=_client_importing("react"),
                             node_imports=["@dsh-plus/a"])
            self.assertFalse(cmd_finish.client_embeds(pkg, "@dsh-plus/a"))

    def test_no_client_export_never_embeds(self):
        with tempfile.TemporaryDirectory() as tmp:
            pkg = _write_pkg(Path(tmp), "b", "@dsh-plus/b",
                             node_imports=["@dsh-plus/a"])
            self.assertFalse(cmd_finish.client_embeds(pkg, "@dsh-plus/a"))

    def test_entry_from_tsdown_config_nested_layout(self):
        """usage-panel 布局：入口 src/client/client.ts，由 tsdown entry 声明定位。"""
        with tempfile.TemporaryDirectory() as tmp:
            pkg = _write_pkg(Path(tmp), "b", "@dsh-plus/b", client_files={
                "client/client.ts": "import { x } from '@dsh-plus/a/client'",
            })
            (pkg / "tsdown.config.ts").write_text(
                "export default defineConfig([{ entry: 'src/index.ts' },"
                " { entry: 'src/client/client.ts',"
                "   outputOptions: { entryFileNames: 'client.js' } }])")
            self.assertTrue(cmd_finish.client_embeds(pkg, "@dsh-plus/a"))

    def test_follows_require_with_js_extension(self):
        """lifeboat 布局：`(require as ...)('./x.js')` 隔离惯用法 + .js→.tsx 换名。"""
        with tempfile.TemporaryDirectory() as tmp:
            pkg = _write_pkg(Path(tmp), "b", "@dsh-plus/b", client_files={
                "client.ts": "const m = (require as (id: string) => unknown)(\n"
                             "  './health-tab.js',\n)",
                "health-tab.tsx": "import { x } from '@dsh-plus/a/client'",
            })
            self.assertTrue(cmd_finish.client_embeds(pkg, "@dsh-plus/a"))


class TestCascadeClientDependents(unittest.TestCase):
    def _workspace(self, root: Path) -> list[Path]:
        return [
            _write_pkg(root, "a", "@dsh-plus/a"),
            _write_pkg(root, "b", "@dsh-plus/b",
                       client_files=_client_importing("@dsh-plus/a/client")),
            _write_pkg(root, "c", "@dsh-plus/c", client_files=_client_importing("react")),
            _write_pkg(root, "d", "@dsh-plus/d", node_imports=["@dsh-plus/a"]),
            _write_pkg(root, "e", "@dsh-plus/e",
                       client_files=_client_importing("@dsh-plus/b")),
        ]

    def test_expands_direct_and_transitive_client_dependents(self):
        with tempfile.TemporaryDirectory() as tmp:
            dirs = self._workspace(Path(tmp))
            self.assertEqual(cmd_finish.cascade_client_dependents(["a"], dirs),
                             ["a", "b", "e"])

    def test_node_only_dependent_not_cascaded(self):
        with tempfile.TemporaryDirectory() as tmp:
            dirs = self._workspace(Path(tmp))
            self.assertNotIn("d", cmd_finish.cascade_client_dependents(["a"], dirs))

    def test_leaf_change_cascades_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            dirs = self._workspace(Path(tmp))
            self.assertEqual(cmd_finish.cascade_client_dependents(["e"], dirs), ["e"])

    def test_empty_dirty_stays_empty(self):
        with tempfile.TemporaryDirectory() as tmp:
            dirs = self._workspace(Path(tmp))
            self.assertEqual(cmd_finish.cascade_client_dependents([], dirs), [])


if __name__ == "__main__":
    unittest.main()
