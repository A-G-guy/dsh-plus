"""dshctl lint：biome 静态检查（lint + format + import 整理）。

biome.json 在仓库根；`--write` 应用安全修复并格式化（import 排序含在内）。
本命令只做检查/修复，提交门槛由 dshctl test 的第 0 步把守。
"""
from __future__ import annotations

from .common import REPO_ROOT, run


def biome_check_cmd(write: bool = False) -> list[str]:
    cmd = ["pnpm", "exec", "biome", "check"]
    if write:
        cmd.append("--write")
    cmd.append(".")
    return cmd


def cmd_lint(args) -> None:
    run(biome_check_cmd(write=args.write), cwd=REPO_ROOT)
    suffix = "（已自动修复并格式化）" if args.write else ""
    print(f"[lint] biome check 通过{suffix}")
