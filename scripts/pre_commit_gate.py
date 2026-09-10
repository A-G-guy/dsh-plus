#!/usr/bin/env python3
"""pre-commit 门槛：行数限制 + 暂存包类型检查。

行数：单代码文件 >500 行警告，>800 行拦截。
类型：暂存区涉及的 packages/<名> 逐包跑 tsc --noEmit（tsdown 只转译不校验类型，
      官方契约漂移只有在类型层才拦得住；dshctl test 虽已含此步，但 git commit
      可绕过 dshctl 直接发生，故在此独立补一道）。

只检查暂存区（git staged）里的代码文件；node_modules/lib/dist 等产物跳过。
与 md-doc-timestamp 中央 hook 链式协作：本脚本作为 legacy hook 被其调用。
应急旁路：环境变量 DSHCTL_SKIP_TYPECHECK=1。
退出码：0 放行（可能有警告），1 拦截。
"""
from __future__ import annotations

import os
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

REPO_ROOT = Path(__file__).resolve().parent.parent
TSC_REL = Path("node_modules/.bin/tsc")


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


def _staged_packages() -> list[str]:
    """暂存区涉及的包目录名（去重，稳定排序）。

    只认 packages/<名>/... 形态；包内需有 tsconfig.json 才纳入检查，
    与 dshctl typecheck 的准入规则保持一致。
    """
    names: set[str] = set()
    for path in _staged_files():
        parts = path.parts
        if len(parts) >= 3 and parts[0] == "packages":
            names.add(parts[1])
    return sorted(
        name for name in names
        if (REPO_ROOT / "packages" / name / "tsconfig.json").is_file()
    )


def _typecheck_staged() -> int:
    """暂存包类型检查；返回拦截数（0 = 全通过）。"""
    if os.environ.get("DSHCTL_SKIP_TYPECHECK") == "1":
        print("[gate] 警告: 已按 DSHCTL_SKIP_TYPECHECK=1 跳过类型检查", file=sys.stderr)
        return 0

    tsc = REPO_ROOT / TSC_REL
    if not tsc.exists():
        # 环境缺 tsc（未 pnpm install）不是代码问题，告警放行而非阻断提交。
        print(f"[gate] 警告: 未找到 {tsc}，跳过类型检查（先 pnpm install）", file=sys.stderr)
        return 0

    packages = _staged_packages()
    if not packages:
        return 0

    blocked = 0
    for name in packages:
        tsconfig = REPO_ROOT / "packages" / name / "tsconfig.json"
        proc = subprocess.run(
            [str(tsc), "-p", str(tsconfig), "--noEmit", "--pretty", "false"],
            cwd=REPO_ROOT, capture_output=True, text=True,
        )
        errors = [line for line in (proc.stdout + proc.stderr).splitlines()
                  if "error TS" in line]
        if proc.returncode == 0 and not errors:
            print(f"[gate] 类型检查通过: {name}", file=sys.stderr)
            continue
        blocked += 1
        print(f"[gate] 拦截: {name} 类型检查失败", file=sys.stderr)
        for line in (errors or [f"tsc 退出码 {proc.returncode}（无 error TS 行，疑配置问题）"]):
            print(f"        {line}", file=sys.stderr)
    return blocked


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

    type_failures = _typecheck_staged()
    if type_failures:
        print(f"[gate] 类型检查拦截 {type_failures} 个包；如确需临时跳过："
              f"DSHCTL_SKIP_TYPECHECK=1 git commit ...", file=sys.stderr)

    if not blocked and not type_failures:
        return 0
    for path, lines in blocked:
        print(f"[gate] 拦截: {path} 已 {lines} 行（>{BLOCK_LINES}），必须拆分后才能提交", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
