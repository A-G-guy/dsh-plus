"""output 输出整理层单测：分类正则、原文不变性、去重、成功/失败路径。"""
from __future__ import annotations

import contextlib
import io
import subprocess
import unittest
from unittest import mock

from dshctl.output import _classify, _dedupe, _slug, run_logged


class TestClassify(unittest.TestCase):
    def test_warn_and_error_lines_verbatim(self):
        lines = ["pnpm WARN deprecated foo@1.0.0", "  error TS1234: boom",
                 "all good", "not ok 1 - some test"]
        warnings, errors = _classify(lines)
        self.assertEqual(warnings, ["pnpm WARN deprecated foo@1.0.0"])
        self.assertEqual(errors, ["  error TS1234: boom", "not ok 1 - some test"])

    def test_original_lines_unchanged(self):
        line = "  ⚠  警告：带 空格 与中文的一行  "
        warnings, _ = _classify([line])
        self.assertEqual(warnings, [line])  # 原文零改写

    def test_error_takes_priority_over_warn(self):
        warnings, errors = _classify(["error: see warning above"])
        self.assertEqual(warnings, [])
        self.assertEqual(errors, ["error: see warning above"])

    def test_bracket_warn_prefix_forces_warning(self):
        line = "[WARN] Failed to replace env in config: ${NPM_TOKEN}"
        warnings, errors = _classify([line])
        self.assertEqual(warnings, [line])
        self.assertEqual(errors, [])

    def test_test_pass_lines_not_classified(self):
        line = "✔ given errored turn, when rendered, then error message shown"
        warnings, errors = _classify([line])
        self.assertEqual(warnings, [])
        self.assertEqual(errors, [])


class TestDedupe(unittest.TestCase):
    def test_identical_lines_collapsed_with_count(self):
        lines = ["pnpm WARN deprecated a@1", "ok", "pnpm WARN deprecated a@1"]
        self.assertEqual(_dedupe(lines),
                         ["pnpm WARN deprecated a@1（×2）", "ok"])

    def test_distinct_lines_untouched(self):
        lines = ["WARN one", "WARN two"]
        self.assertEqual(_dedupe(lines), lines)


class TestSlug(unittest.TestCase):
    def test_slug_sanitized(self):
        self.assertEqual(_slug(["pnpm", "-r", "build"]), "pnpm-r-build")
        self.assertEqual(_slug(["/usr/bin/python3", "-m", "unittest"]), "python3-m-unittest")


class TestRunLogged(unittest.TestCase):
    def test_success_one_line(self):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            proc = run_logged(["python3", "-c", "print('UNIQUE' + '_OUT_TOKEN')"])
        self.assertEqual(proc.returncode, 0)
        self.assertIn("✔", err.getvalue())
        # 命令输出本身不刷屏（echo 里只有拆开的两段，连续 token 不应出现）
        self.assertEqual(err.getvalue().count("UNIQUE_OUT_TOKEN"), 0)

    def test_no_command_echo_by_default(self):
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            run_logged(["python3", "-c", "pass"])
        self.assertNotIn("+ python3", err.getvalue())

    def test_verbose_restores_echo_and_raw_output(self):
        err = io.StringIO()
        with mock.patch.dict("os.environ", {"DSHCTL_VERBOSE": "1"}), \
                contextlib.redirect_stderr(err):
            run_logged(["python3", "-c", "print('VERBOSE' + '_BODY')"])
        text = err.getvalue()
        self.assertIn("+ python3", text)
        self.assertIn("VERBOSE_BODY", text)

    def test_failure_raises_with_summary(self):
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            with self.assertRaises(subprocess.CalledProcessError):
                run_logged(["python3", "-c",
                            "import sys; print('error: boom'); sys.exit(3)"])
        text = err.getvalue()
        self.assertIn("error: boom", text)  # 报错行原文呈现
        self.assertIn("完整日志", text)

    def test_warnings_shown_on_success(self):
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            run_logged(["python3", "-c", "print('WARN something')"])
        self.assertIn("WARN something", err.getvalue())
        self.assertIn("警告", err.getvalue())


if __name__ == "__main__":
    unittest.main()
