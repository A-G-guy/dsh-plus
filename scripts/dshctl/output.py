"""dshctl 输出整理层：长命令输出自动摘要。

约定：
- 成功只打一行 ✔（含耗时），不刷屏。
- 警告/报错按行【原文】分类汇总打印，零改写；完全相同的行去重并标注（×N）。
- 完整原始输出落日志文件（系统临时目录 dshctl-logs/，滚动保留最近 30 份），
  有警告/报错或失败时提示日志路径。
- 失败：打印报错行 + 末尾原文摘录 + 日志路径后由调用方 fail()，不抛裸 traceback。
- DSHCTL_VERBOSE=1：恢复命令回显并原文全量透传子命令输出。
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

LOG_DIR = Path(tempfile.gettempdir()) / "dshctl-logs"
LOG_KEEP = 30
TAIL_ON_FAILURE = 20

WARN_RE = re.compile(r"warn(?:ing)?|⚠", re.IGNORECASE)
ERROR_RE = re.compile(r"error|err!|failed|not ok|✖|✗", re.IGNORECASE)
# 显式 [WARN] 前缀优先按警告归类（如 pnpm "[WARN] Failed to replace env"）。
BRACKET_WARN_RE = re.compile(r"^\s*\[warn\]", re.IGNORECASE)
# 测试通过行（node --test 的 "✔ ..."/"ok ..."）即使文本含 error 字样也不算报错。
PASS_RE = re.compile(r"^\s*(✔|ok)\s")


def verbose() -> bool:
    return os.environ.get("DSHCTL_VERBOSE") == "1"


def _slug(cmd: list[str]) -> str:
    raw = "-".join(Path(c).name for c in cmd[:4])
    slug = re.sub(r"[^A-Za-z0-9_.-]+", "-", raw)
    return re.sub(r"-+", "-", slug).strip("-")[:60] or "cmd"


def _prune_logs() -> None:
    logs = sorted(LOG_DIR.glob("*.log"), key=lambda p: p.stat().st_mtime)
    for old in logs[:-LOG_KEEP]:
        old.unlink(missing_ok=True)


def _write_log(cmd: list[str], output: str) -> Path:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log = LOG_DIR / f"{time.strftime('%Y%m%d-%H%M%S')}-{_slug(cmd)}.log"
    log.write_text(f"$ {' '.join(cmd)}\n\n{output}", encoding="utf-8")
    _prune_logs()
    return log


def _classify(lines: list[str]) -> tuple[list[str], list[str]]:
    """按原文分行归类：报错优先，警告其次；同一行只归一类。

    例外：显式 [WARN] 前缀强制按警告；测试通过行（✔/ok 开头）不参与归类。
    """
    candidates = [l for l in lines if not PASS_RE.match(l)]
    warnings = [l for l in candidates
                if (BRACKET_WARN_RE.match(l)
                    or (WARN_RE.search(l) and not ERROR_RE.search(l)))]
    errors = [l for l in candidates
              if ERROR_RE.search(l) and not BRACKET_WARN_RE.match(l)]
    return warnings, errors


def _dedupe(lines: list[str]) -> list[str]:
    """完全相同的行保序去重，重复行末尾追加（×N）；行文本本身原文不动。"""
    counts: dict[str, int] = {}
    order: list[str] = []
    for line in lines:
        if line not in counts:
            counts[line] = 0
            order.append(line)
        counts[line] += 1
    return [f"{line}（×{counts[line]}）" if counts[line] > 1 else line
            for line in order]


def _print_section(title: str, lines: list[str]) -> None:
    if not lines:
        return
    unique = _dedupe(lines)
    print(f"── {title}（{len(lines)} 条，原文）──", file=sys.stderr)
    for line in unique:
        print(line, file=sys.stderr)


def run_logged(cmd: list[str], *, env: dict[str, str] | None = None,
               cwd: Path | None = None, check: bool = True) -> subprocess.CompletedProcess[str]:
    """执行命令并整理输出；check=True 失败时返回（由调用方决定 fail）。"""
    if verbose():
        print(f"+ {' '.join(cmd)}", file=sys.stderr)
    merged_env = dict(env) if env is not None else dict(os.environ)
    started = time.monotonic()
    try:
        proc = subprocess.run(cmd, env=merged_env, cwd=cwd, text=True,
                              capture_output=True)
    except OSError as exc:
        print(f"✖ {_slug(cmd)} 无法启动: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
    elapsed = time.monotonic() - started
    combined = (proc.stdout or "") + (proc.stderr or "")
    if verbose() and combined:
        print(combined, file=sys.stderr, end="" if combined.endswith("\n") else "\n")
    warnings, errors = _classify(combined.splitlines())
    log: Path | None = None
    if proc.returncode != 0:
        log = _write_log(cmd, combined)
        print(f"✖ {_slug(cmd)} 失败（exit {proc.returncode}，{elapsed:.1f}s）", file=sys.stderr)
        _print_section("报错", errors)
        tail = combined.splitlines()[-TAIL_ON_FAILURE:]
        if tail:
            print(f"── 输出末尾 {len(tail)} 行（原文）──", file=sys.stderr)
            print("\n".join(tail), file=sys.stderr)
        print(f"── 完整日志: {log} ──", file=sys.stderr)
        if check:
            raise subprocess.CalledProcessError(proc.returncode, cmd, proc.stdout, proc.stderr)
        return proc
    print(f"✔ {_slug(cmd)} ({elapsed:.1f}s)", file=sys.stderr)
    if warnings or errors:
        log = _write_log(cmd, combined)
        _print_section("警告", warnings)
        _print_section("报错（exit 0 但检出关键字）", errors)
        print(f"── 完整日志: {log} ──", file=sys.stderr)
    return proc
