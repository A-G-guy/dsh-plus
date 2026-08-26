"""dev seed 单测：场景库完整性、防污染护栏、cwd 编码规则。"""
from __future__ import annotations

import json
import unittest
from pathlib import Path

from dshctl.cmd_seed import (SEED_SCENARIOS, SEED_TAG, SEED_WORKSPACE,
                             _guard_within_dev, seed_group_dir)
from dshctl.common import DEV_HOME


class TestScenarios(unittest.TestCase):
    def test_ids_and_markers_unique(self):
        ids = [s["id"] for s in SEED_SCENARIOS]
        markers = [s["marker"] for s in SEED_SCENARIOS]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(len(markers), len(set(markers)))

    def test_prompts_carry_seed_tag(self):
        for scenario in SEED_SCENARIOS:
            self.assertTrue(scenario["prompt"].startswith(SEED_TAG),
                            scenario["id"])

    def test_marker_reachable_from_script(self):
        """marker 必须出现在该场景脚本化响应里，否则 stdout 校验必然失败。"""
        for scenario in SEED_SCENARIOS:
            blob = json.dumps(scenario["entries"], ensure_ascii=False)
            self.assertIn(scenario["marker"], blob, scenario["id"])

    def test_tool_scenario_has_two_step_script(self):
        tool = next(s for s in SEED_SCENARIOS if s["id"] == "tool-call")
        self.assertIn("tool_calls", tool["entries"][0])
        self.assertIn("content", tool["entries"][1])


class TestPollutionGuards(unittest.TestCase):
    def test_workspace_inside_dev_home(self):
        self.assertTrue(SEED_WORKSPACE.resolve().is_relative_to(DEV_HOME.resolve()))

    def test_guard_rejects_outside_path(self):
        with self.assertRaises(SystemExit):
            _guard_within_dev(Path("/tmp"))

    def test_seed_group_dir_encoded_like_dsh(self):
        # dsh 源码规则：'--' + cwd.replace('/', '-').lstrip('-') + '--'
        expected = "--" + str(SEED_WORKSPACE).replace("/", "-").lstrip("-") + "--"
        group = seed_group_dir()
        self.assertEqual(group.name, expected)
        self.assertEqual(group.parent, DEV_HOME / "sessions")
        self.assertTrue(group.name.startswith("--") and group.name.endswith("--"))


if __name__ == "__main__":
    unittest.main()
