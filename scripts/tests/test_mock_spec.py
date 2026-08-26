"""mock 命令的 spec/便捷参数 → 脚本条目生成单测（纯逻辑，无网络）。"""
from __future__ import annotations

import argparse
import unittest

from dshctl.cmd_mock import _default_marker, build_entries


def _ns(**overrides) -> argparse.Namespace:
    base = dict(command=None, match=None, todo=None, todo_status="pending",
                tool=None, args=None, reply=None, thinking=None,
                then=None, then_match=None)
    base.update(overrides)
    return argparse.Namespace(**base)


class TestBuildEntries(unittest.TestCase):
    def test_reply_entry(self):
        entries = build_entries(_ns(reply="你好"), "提示词")
        self.assertEqual(entries, [{"match": "提示词", "content": "你好"}])

    def test_thinking_attached(self):
        entries = build_entries(_ns(reply="终答", thinking="先分析再回答"), "p")
        self.assertEqual(entries[0]["thinking"], "先分析再回答")
        self.assertEqual(entries[0]["content"], "终答")

    def test_tool_two_step(self):
        entries = build_entries(
            _ns(tool="text_transform", args='{"text":"abc"}', then="完成"), "p")
        self.assertEqual(entries[0]["tool_calls"][0]["name"], "text_transform")
        self.assertEqual(entries[0]["tool_calls"][0]["arguments"], {"text": "abc"})
        self.assertEqual(entries[1], {"content": "完成"})

    def test_tool_bad_args_fails(self):
        with self.assertRaises(SystemExit):
            build_entries(_ns(tool="x", args="{bad json"), "p")

    def test_todo_entry(self):
        entries = build_entries(
            _ns(todo="任务A; 任务B ;", todo_status="in_progress", then="ok"), "p")
        todos = entries[0]["tool_calls"][0]["arguments"]["todos"]
        self.assertEqual([t["content"] for t in todos], ["任务A", "任务B"])
        self.assertTrue(all(t["status"] == "in_progress" for t in todos))

    def test_todo_empty_fails(self):
        with self.assertRaises(SystemExit):
            build_entries(_ns(todo=" ; "), "p")

    def test_command_returns_none(self):
        self.assertIsNone(build_entries(_ns(command="/plan x"), "p"))

    def test_no_content_fails(self):
        with self.assertRaises(SystemExit):
            build_entries(_ns(), "p")

    def test_match_override(self):
        entries = build_entries(_ns(reply="r", match="自定义"), "prompt 原文")
        self.assertEqual(entries[0]["match"], "自定义")


class TestDefaultMarker(unittest.TestCase):
    def test_last_content_wins(self):
        entries = [{"tool_calls": []}, {"content": "最终回答文本"}]
        self.assertEqual(_default_marker(entries), "最终回答文本")

    def test_no_content_returns_none(self):
        self.assertIsNone(_default_marker([{"tool_calls": [{"name": "x"}]}]))


if __name__ == "__main__":
    unittest.main()
