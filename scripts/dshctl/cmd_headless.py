"""dshctl hl：无头调试——不经 web 实例，直接经 headless profile + mock LLM 跑一轮任务。

内容参数与 mock run 完全一致（--reply/--tool/--args/--then/--todo/--thinking/
--spec），区别仅在不写 web 会话记录：任务经 headless profile 真实管线执行，
终答直接打印到终端。全程本机 mock，零真实 API 费用。
不带内容参数时为回显模式（mock 原样回显任务文本）。
"""
from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path

from .cmd_dev import (_dev_profile_dir, clear_mock_script, ensure_mock_running,
                      write_mock_script)
from .cmd_mock import _default_marker, build_entries, load_spec
from .common import DEV_HOME, DEV_RUN_DIR, dsh_bin, dev_env, fail

TAIL_ON_FAILURE = 20


def _has_content_flags(args) -> bool:
    return bool(args.reply or args.tool or args.todo)


def _resolve_script(args) -> tuple[str, list[dict], str | None]:
    """解析 (prompt, entries, marker)：spec 文件优先，否则便捷参数或回显模式。"""
    task = " ".join(args.task).strip()
    if args.spec:
        spec = load_spec(Path(args.spec))
        prompt = spec.get("prompt") or task or f"[hl] {int(time.time())}"
        entries = spec["entries"]
        marker = args.marker or spec.get("marker") or _default_marker(entries)
        return prompt, entries, marker
    if not task:
        fail("缺少任务文本（位置参数），或用 --spec 提供场景文件")
    if _has_content_flags(args):
        entries = build_entries(args, task)
        assert entries is not None
        return task, entries, args.marker or _default_marker(entries)
    return task, [], args.marker  # 回显模式：不写脚本队列


def cmd_hl(args) -> None:
    if not (DEV_HOME / "settings.yaml").exists():
        fail("dev home 未初始化，请先运行: dshctl.py dev init")
    if not (_dev_profile_dir("headless") / "package.json").exists():
        fail("headless profile 未初始化，请先运行: dshctl.py dev init")
    prompt, entries, marker = _resolve_script(args)
    ensure_mock_running()
    if entries:
        write_mock_script(entries)
    try:
        proc = subprocess.run(
            [dsh_bin(), "--profile", "headless", prompt],
            env=dev_env(), capture_output=True, text=True, timeout=args.timeout)
    except subprocess.TimeoutExpired:
        fail(f"headless 任务 {args.timeout}s 未结束；"
             f"排查 mock 日志: dshctl.py dev logs mock-llm")
    finally:
        if entries:
            clear_mock_script()
    if proc.returncode != 0:
        print(proc.stderr[-2000:], file=sys.stderr)
        fail(f"headless 任务失败；排查 mock 日志: {DEV_RUN_DIR}/mock-llm.log")
    if marker and marker not in proc.stdout:
        tail = proc.stdout.splitlines()[-TAIL_ON_FAILURE:]
        print("── 输出末尾（原文）──\n" + "\n".join(tail), file=sys.stderr)
        fail(f"终答未见 marker {marker!r}（match 未命中或条目被抢占）；"
             f"排查: dshctl.py dev logs mock-llm")
    print(proc.stdout, end="" if proc.stdout.endswith("\n") else "\n")
    print(f"[hl] ✔ 无头任务完成（marker={marker!r}），全程本机 mock，零 API 费用",
          file=sys.stderr)
