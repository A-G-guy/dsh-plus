"""mock_llm 脚本队列单测：标题请求防抢、thinking → reasoning_content。"""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import mock_llm  # noqa: E402


class TestScriptQueue(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.script = Path(self.tmp.name) / "script.jsonl"

    def tearDown(self):
        self.tmp.cleanup()

    def _write(self, entries: list[dict]) -> None:
        self.script.write_text(
            "\n".join(json.dumps(e, ensure_ascii=False) for e in entries) + "\n",
            encoding="utf-8")

    def test_title_request_never_consumes_entries(self):
        self._write([{"match": "你好", "content": "脚本回复"}])
        queue = mock_llm.ScriptQueue(self.script)
        # 真实请求体为未转义 UTF-8（Node JSON.stringify 行为），测试保持一致
        body = json.dumps({"messages": [{"role": "user", "content":
            f"{mock_llm.TITLE_PROMPT_MARKER}: 你好"}]}, ensure_ascii=False)
        self.assertIsNone(queue.pop(body))
        # 条目仍在队列中，正式请求仍能消费
        self.assertIsNotNone(queue.pop(json.dumps({"messages": [
            {"role": "user", "content": "你好"}]}, ensure_ascii=False)))

    def test_match_consumes_first_hit(self):
        self._write([{"match": "甲", "content": "A"}, {"match": "乙", "content": "B"}])
        queue = mock_llm.ScriptQueue(self.script)
        hit = queue.pop("包含乙的请求")
        self.assertEqual(hit["content"], "B")
        remaining = self.script.read_text(encoding="utf-8")
        self.assertIn("甲", remaining)
        self.assertNotIn("乙", remaining)


class TestBuildMessage(unittest.TestCase):
    def test_thinking_becomes_reasoning_content(self):
        with tempfile.TemporaryDirectory() as tmp:
            script = Path(tmp) / "s.jsonl"
            script.write_text(json.dumps(
                {"content": "终答", "thinking": "先思考"}, ensure_ascii=False) + "\n",
                encoding="utf-8")
            message, error = mock_llm._build_message(
                {"messages": []}, mock_llm.ScriptQueue(script), "任意请求")
        self.assertIsNone(error)
        self.assertEqual(message["reasoning_content"], "先思考")
        self.assertEqual(message["content"], "终答")

    def test_tool_call_with_thinking(self):
        with tempfile.TemporaryDirectory() as tmp:
            script = Path(tmp) / "s.jsonl"
            script.write_text(json.dumps(
                {"tool_calls": [{"name": "todo_write", "arguments": {"todos": []}}],
                 "thinking": "列个清单"}, ensure_ascii=False) + "\n",
                encoding="utf-8")
            message, _ = mock_llm._build_message(
                {"messages": []}, mock_llm.ScriptQueue(script), "任意请求")
        self.assertEqual(message["reasoning_content"], "列个清单")
        self.assertEqual(message["tool_calls"][0]["function"]["name"], "todo_write")

    def test_echo_fallback_without_script(self):
        message, error = mock_llm._build_message(
            {"messages": [{"role": "user", "content": "你好"}]},
            mock_llm.ScriptQueue(None), "任意请求")
        self.assertIsNone(error)
        self.assertEqual(message["content"], "[mock] 你好")
        self.assertNotIn("reasoning_content", message)


if __name__ == "__main__":
    unittest.main()
