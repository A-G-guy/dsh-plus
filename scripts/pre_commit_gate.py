#!/usr/bin/env python3
"""pre-commit 行数门槛：单代码文件 >500 行警告，>800 行拦截。

只检查暂存区（git staged）里的代码文件；node_modules/lib/dist 等产物跳过。
与 md-doc-timestamp 中央 hook 链式协作：本脚本作为 legacy hook 被其调用。
退出码：0 放行（可能有警告），1 拦截。
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

WARN_LINES = 500
BLOCK_LINES = 800

CODE_SUFFIXES = {
    ".js", ".mjs", ".cjs", ".jsx",
    ".ts", ".mts", ".cts", ".tsx",
    ".py", ".sh",
}
EXCLUDED_PARTS = {"node_modules", "lib", "dist", ".git"}


def _staged_files() -> list[Path]:
    out = subprocess.run(
        ["git", "diff", "--cached", "--name-only", "--diff-filter=ACM"],
        check=True, capture_output=True, text=True,
    ).stdout
    return [Path(line) for line in out.splitlines() if line.strip()]


def _is_code_file(path: Path) -> bool:
    if path.suffix.lower() not in CODE_SUFFIXES:
        return False
    return not any(part in EXCLUDED_PARTS for part in path.parts)


def _count_lines(path: Path) -> int | None:
    if not path.is_file():
        return None
    try:
        return len(path.read_text(encoding="utf-8", errors="replace").splitlines())
    except OSError:
        return None


def main() -> int:
    blocked: list[tuple[Path, int]] = []
    for path in _staged_files():
        if not _is_code_file(path):
            continue
        lines = _count_lines(path)
        if lines is None:
            continue
        if lines > BLOCK_LINES:
            blocked.append((path, lines))
        elif lines > WARN_LINES:
            print(f"[gate] 警告: {path} 已 {lines} 行（>{WARN_LINES}），建议拆分", file=sys.stderr)
    if not blocked:
        return 0
    for path, lines in blocked:
        print(f"[gate] 拦截: {path} 已 {lines} 行（>{BLOCK_LINES}），必须拆分后才能提交", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
