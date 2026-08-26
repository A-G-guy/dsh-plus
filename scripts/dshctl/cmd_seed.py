"""dshctl dev seed：自动 mock 会话数据——经真实 headless 管线在 dev home 造会话记录。

用途：为 UI 调试/截图提供有内容的会话列表与会话详情（短问答/markdown/代码块/
工具调用/长滚动回复），全程本机 mock，零真实 API 费用。

防污染护栏（红线）：
- 只写 DEV_HOME（~/.dsh-dev）：脚本文件在 DEV_RUN_DIR，会话落在 DEV_HOME/sessions
  下 seed-workspace 专属项目分组；路径硬编码并 resolve 后断言，无参数可导向生产。
- 不手写 session.jsonl 内部格式，一律由 mock + headless 真实管线产生。
"""
from __future__ import annotations

import shutil
from pathlib import Path

from .cmd_dev import (_dev_profile_dir, clear_mock_script, ensure_mock_running,
                      write_mock_script)
from .common import DEV_HOME, dsh_bin, dev_env, fail, run

SEED_WORKSPACE = DEV_HOME / "seed-workspace"
SEED_TAG = "[seed]"

_MARKDOWN_BODY = """\
## Seed Markdown 场景

- 列表项 **粗体** 与 *斜体*
- `inline code` 混排

| 列 A | 列 B |
|---|---|
| 1 | 2 |

> 引用块：验证移动端窄屏下表格与引用的折行表现。
"""

_CODE_BODY = """\
```python
def fib(n: int) -> int:
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a
```
代码块场景：验证横向滚动与字号适配。
"""

_LONG_BODY = "\n\n".join(
    f"第 {i} 段：{SEED_TAG} 长滚动内容，模拟真实长回复在窄屏下的滚动与留白表现。" * 2
    for i in range(1, 13))


def _scenario(sid: str, prompt: str, entries: list[dict], marker: str) -> dict:
    return {"id": sid, "prompt": f"{SEED_TAG} {prompt}", "entries": entries,
            "marker": marker}


SEED_SCENARIOS = [
    _scenario("short-qa", "short-qa: one-line intro please",
              [{"match": "short-qa", "content": f"{SEED_TAG} SEED_SHORT_OK 简短问答会话。"}],
              "SEED_SHORT_OK"),
    _scenario("markdown", "markdown: show rich markdown",
              [{"match": "markdown:", "content": f"{SEED_TAG} SEED_MD_OK\n{_MARKDOWN_BODY}"}],
              "SEED_MD_OK"),
    _scenario("code", "code-block: show a python snippet",
              [{"match": "code-block", "content": f"{SEED_TAG} SEED_CODE_OK\n{_CODE_BODY}"}],
              "SEED_CODE_OK"),
    _scenario("tool-call", "tool-call: run text_transform with text=abc op=uppercase",
              [{"match": "tool-call: run text_transform",
                "tool_calls": [{"name": "text_transform",
                                "arguments": {"text": "abc", "op": "uppercase"}}]},
               {"match": "ABC", "content": f"{SEED_TAG} SEED_TOOL_OK 工具返回 ABC"}],
              "SEED_TOOL_OK"),
    _scenario("long-scroll", "long-scroll: give me a long reply",
              [{"match": "long-scroll", "content": f"{SEED_TAG} SEED_LONG_OK\n{_LONG_BODY}"}],
              "SEED_LONG_OK"),
]


def _guard_within_dev(path: Path) -> Path:
    resolved = path.resolve()
    if not resolved.is_relative_to(DEV_HOME.resolve()):
        fail(f"拒绝操作 DEV_HOME 之外的路径: {resolved}")
    return resolved


def seed_group_dir() -> Path:
    """seed 会话在 sessions/ 下的项目分组目录（编码规则同 dsh 源码）。"""
    encoded = "--" + str(SEED_WORKSPACE).replace("/", "-").lstrip("-") + "--"
    return _guard_within_dev(DEV_HOME / "sessions" / encoded)


def _run_scenario(scenario: dict) -> None:
    write_mock_script(scenario["entries"])
    proc = run([dsh_bin(), "--profile", "headless", scenario["prompt"]],
               env=dev_env(), cwd=SEED_WORKSPACE)
    clear_mock_script()
    if scenario["marker"] not in proc.stdout:
        fail(f"seed 场景 {scenario['id']} 未见 marker {scenario['marker']}，"
             f"请检查 {DEV_RUN_DIR}/mock-llm.log")
    print(f"[seed] ✔ {scenario['id']}")


def cmd_dev_seed(args) -> None:
    if not (DEV_HOME / "settings.yaml").exists():
        fail("dev home 未初始化，请先运行: dshctl.py dev init")
    if not (_dev_profile_dir("headless") / "package.json").exists():
        fail("headless profile 未初始化，请先运行: dshctl.py dev init")
    if args.reset:
        group = seed_group_dir()
        if group.is_dir():
            shutil.rmtree(group)
            print(f"[seed] 已清空 seed 会话分组: {group}")
        else:
            print("[seed] 无既有 seed 会话分组")
    _guard_within_dev(SEED_WORKSPACE).mkdir(parents=True, exist_ok=True)
    ensure_mock_running()
    for scenario in SEED_SCENARIOS:
        _run_scenario(scenario)
    print(f"[seed] {len(SEED_SCENARIOS)} 个会话已生成（均带 {SEED_TAG} 标记，"
          f"仅存在于 ~/.dsh-dev）→ http://127.0.0.1:3082 查看")
