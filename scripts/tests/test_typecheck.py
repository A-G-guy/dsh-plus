"""typecheck 纯逻辑单测：目标包筛选、tsc 错误行提取、失败输出回退。

不调用真实 tsc（那是集成行为，由 dshctl test 的闸门步骤覆盖）；
这里只钉住解析与筛选这两处易错的纯逻辑。
"""
from __future__ import annotations

import unittest

from dshctl import cmd_typecheck


class TestErrorLines(unittest.TestCase):
    def test_extracts_only_tsc_error_lines(self):
        output = (
            "packages/shared/src/a.ts(1,2): error TS2322: 类型不匹配\n"
            "  详情续行，不应被当作独立错误\n"
            "packages/shared/src/b.ts(3,4): error TS7006: 隐式 any\n"
            "Found 2 errors.\n"
        )
        self.assertEqual(cmd_typecheck._error_lines(output), [
            "packages/shared/src/a.ts(1,2): error TS2322: 类型不匹配",
            "packages/shared/src/b.ts(3,4): error TS7006: 隐式 any",
        ])

    def test_empty_and_clean_output_yield_no_lines(self):
        self.assertEqual(cmd_typecheck._error_lines(""), [])
        self.assertEqual(cmd_typecheck._error_lines("✔ 构建成功\n"), [])


class TestTypecheckTargets(unittest.TestCase):
    """目标筛选：只含 tsconfig.json 的包；按目录名或包名过滤；未知名字报错。"""

    def test_all_targets_have_tsconfig(self):
        targets = cmd_typecheck.typecheck_targets()
        self.assertTrue(targets)
        for pkg in targets:
            self.assertTrue((pkg / "tsconfig.json").exists(), pkg)

    def test_every_package_is_covered(self):
        """全部包都进了闸门——漏配 tsconfig 会让该包静默逃过类型检查。"""
        from dshctl.common import package_dirs

        covered = {p.name for p in cmd_typecheck.typecheck_targets()}
        self.assertEqual(covered, {p.name for p in package_dirs()})

    def test_filters_by_dir_name_and_package_name(self):
        by_dir = cmd_typecheck.typecheck_targets(["shared"])
        self.assertEqual([p.name for p in by_dir], ["shared"])

        by_pkg = cmd_typecheck.typecheck_targets(["@dsh-plus/shared"])
        self.assertEqual([p.name for p in by_pkg], ["shared"])

    def test_multiple_names_keep_repo_order(self):
        names = [p.name for p in cmd_typecheck.typecheck_targets(["web-files", "shared"])]
        self.assertEqual(names, ["shared", "web-files"])

    def test_unknown_name_fails(self):
        with self.assertRaises(SystemExit):
            cmd_typecheck.typecheck_targets(["no-such-package"])


class TestTscBin(unittest.TestCase):
    def test_tsc_bin_exists(self):
        tsc = cmd_typecheck.tsc_bin()
        self.assertTrue(tsc.exists())
        self.assertEqual(tsc.name, "tsc")


if __name__ == "__main__":
    unittest.main()
