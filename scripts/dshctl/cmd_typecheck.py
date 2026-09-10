"""dshctl typecheck：逐包 `tsc --noEmit` 类型契约检查（零网络、零费用）。

为什么需要这道闸门：dshctl test 原本只有 biome（风格）+ tsdown（只转译不做
类型校验）+ node --test（运行时）。类型层完全裸奔——官方平台包的客户端契约
变更（如 CommandContribution.description 由 string 改为 () => string）不会让
任何一步变红，只能在生产浏览器里以运行时 TypeError 暴露（斜杠命令菜单整体
消失即此例）。

为什么逐包而非单一根配置：host 半与 client 半的类型环境不同（node vs DOM），
分包 tsconfig 才能让「host 代码误用 document」这类越界在类型层被拦住。

包内约定（tsconfig.base.json 提供公共选项）：
- 源码一律 `.ts`/`.tsx` 扩展名导入 → allowImportingTsExtensions；
- 声明产物由 tsdown 生成，tsc 只做检查 → noEmit；
- @types/node 必须显式列入 types（自动 @types 收录对 node: 前缀模块不生效）。
"""
from __future__ import annotations

import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from .common import REPO_ROOT, fail, package_dirs, read_json

TSC_REL = Path("node_modules/.bin/tsc")
MAX_WORKERS = 8


def tsc_bin() -> Path:
    """仓库根 node_modules 下的 tsc；缺失时给出安装提示。"""
    tsc = REPO_ROOT / TSC_REL
    if not tsc.exists():
        fail(f"未找到 {tsc}；先运行 pnpm install（typescript 是根 devDependency）")
    return tsc


def typecheck_targets(names: list[str] | None = None) -> list[Path]:
    """参与类型检查的包目录：含 tsconfig.json 的包，可按目录名/包名过滤。"""
    targets = [p for p in package_dirs() if (p / "tsconfig.json").exists()]
    if not names:
        return targets
    wanted = set()
    for name in names:
        matches = [p for p in targets
                   if name in {p.name, read_json(p / "package.json")["name"]}]
        if not matches:
            fail(f"找不到可检查的包: {name}"
                 f"（可用: {', '.join(p.name for p in targets)}）")
        wanted.update(matches)
    return [p for p in targets if p in wanted]


def _check_one(tsc: Path, pkg: Path) -> tuple[Path, int, str]:
    """检查单包，返回 (包目录, 退出码, 合并输出)。"""
    proc = subprocess.run(
        [str(tsc), "-p", str(pkg / "tsconfig.json"), "--noEmit", "--pretty", "false"],
        cwd=REPO_ROOT, text=True, capture_output=True)
    return pkg, proc.returncode, (proc.stdout or "") + (proc.stderr or "")


def _error_lines(output: str) -> list[str]:
    return [line for line in output.splitlines() if "error TS" in line]


def cmd_typecheck(args) -> None:
    """CLI 入口：`dshctl typecheck [包...]`。"""
    run_typecheck(getattr(args, "packages", None) or None)


def run_contract_check(tsc: Path) -> tuple[bool, list[str]]:
    """公共契约检查（第二阶段）：核对 lib/*.d.ts 的导出类型未退化。

    逐包 tsc 的 include 只含 src/tests，读不到 lib/；skipLibCheck 又让 .d.ts
    内部问题沉默，故产物类型退化在逐包检查下全绿。此步以「产物视角」消费各包
    lib/index.d.ts 并断言关键契约（见 scripts/contract/contract.ts）。

    返回 (是否通过, 错误行)。缺 tsconfig.contract.json 时视为未启用（通过）。
    """
    project = REPO_ROOT / "tsconfig.contract.json"
    if not project.exists():
        return True, []
    proc = subprocess.run(
        [str(tsc), "-p", str(project), "--noEmit", "--pretty", "false"],
        cwd=REPO_ROOT, text=True, capture_output=True)
    output = (proc.stdout or "") + (proc.stderr or "")
    errors = _error_lines(output)
    if proc.returncode == 0 and not errors:
        return True, []
    return False, errors or output.splitlines()[-20:]


def run_typecheck(names: list[str] | None = None) -> None:
    """逐包类型检查 + 公共契约检查；失败则打印原文错误行并非零退出。

    直接以 names 调用即可复用（cmd_test 的闸门步骤不需要伪造 args 对象）；
    指定包名时只跑这些包，契约检查属全仓性质，仅在全量运行时执行。
    """
    tsc = tsc_bin()
    targets = typecheck_targets(names)
    if not targets:
        fail("没有可检查的包（缺 tsconfig.json）")

    with ThreadPoolExecutor(max_workers=min(MAX_WORKERS, len(targets))) as pool:
        results = list(pool.map(lambda pkg: _check_one(tsc, pkg), targets))

    failed: list[tuple[Path, list[str]]] = []
    for pkg, code, output in results:
        errors = _error_lines(output)
        if code == 0 and not errors:
            print(f"✔ {pkg.name}")
            continue
        # tsc 退出码非零但无 "error TS" 行 = 配置/崩溃类问题，原文照打。
        failed.append((pkg, errors or output.splitlines()[-20:]))

    contract_lines: list[str] = []
    if not failed and names is None:
        ok, contract_lines = run_contract_check(tsc)
        if ok:
            print("✔ 公共契约（lib/*.d.ts 导出类型）")
        else:
            contract_lines = contract_lines
    else:
        contract_lines = []

    if not failed and not contract_lines:
        print(f"[typecheck] {len(targets)} 个包类型检查通过")
        return

    for pkg, lines in failed:
        print(f"\n✖ {pkg.name}", file=sys.stderr)
        for line in lines:
            print(line, file=sys.stderr)
    if contract_lines:
        print("\n✖ 公共契约检查失败（scripts/contract/contract.ts）", file=sys.stderr)
        for line in contract_lines:
            print(line, file=sys.stderr)

    total = sum(len(lines) for _, lines in failed) + len(contract_lines)
    fail(f"typecheck 失败：{len(failed)}/{len(targets)} 个包"
         f"{' + 公共契约' if contract_lines else ''} 共 {total} 条错误")
