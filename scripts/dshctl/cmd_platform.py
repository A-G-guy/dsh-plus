"""dshctl platform-sync：把全仓 @deepseek-ai/dsh 版本线钉版统一改写到目标版本。

背景：dsh 自 0.1.2-alpha.2 起发布 npm，平台依赖一律走 registry 解析
（各包 manifest 的 peer `^<版本>` + dev 精确 `<版本>` 即事实源，doctor 据此
与本机 dsh CLI 版本比对）。本命令是升级平台版本的唯一入口：

  1. 收集 packages/*/package.json 实际用到的 dsh 版本线包（peer/dev/dependencies）；
  2. 逐一核验 npm 上存在该版本（防钉到未发布版本）；
  3. 统一改写所有 manifest 的 dsh 版本线钉版（peer → ^<version>，dev → <version>）；
     基座包（cordis/schemastery/cosmokit 等独立版本线）不动，按需手工升级。

执行后按提示 pnpm install + dshctl test 验证。
"""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

from .common import PACKAGES_DIR, fail, read_json, write_json

# dsh 版本线包名前缀（与 common.PLATFORM_DSH_LINE 同义，局部常量避免循环依赖误导）。
DSH_LINE = "@deepseek-ai/dsh"

VERSION_RE = re.compile(r"^\d+\.\d+\.\d+.*$")


def _used_dsh_packages() -> list[str]:
    """packages/*/package.json 的 peer/dev/dependencies 中实际用到的 dsh 版本线包。"""
    used: set[str] = set()
    for manifest in sorted(PACKAGES_DIR.glob("*/package.json")):
        meta = read_json(manifest)
        for section in ("dependencies", "peerDependencies", "devDependencies"):
            for dep in meta.get(section, {}):
                if dep.startswith(DSH_LINE):
                    used.add(dep)
    return sorted(used)


def _verify_on_npm(packages: list[str], version: str) -> None:
    """逐一核验 npm 上存在 目标版本；任一缺失即整体失败（不写任何文件）。"""
    missing: list[str] = []
    for name in packages:
        result = subprocess.run(
            ["npm", "view", f"{name}@{version}", "version"],
            capture_output=True, text=True, timeout=60,
        )
        if result.returncode != 0 or not result.stdout.strip():
            missing.append(name)
    if missing:
        fail(f"npm 上不存在 {version} 版本的平台包: {', '.join(missing)}（未做任何改写）")


def _rewrite_manifests(version: str) -> list[Path]:
    """统一改写 dsh 版本线钉版：peer → ^<version>，dev → <version>。返回改动文件。"""
    changed: list[Path] = []
    for manifest in sorted(PACKAGES_DIR.glob("*/package.json")):
        meta = read_json(manifest)
        dirty = False
        for section, fmt in (("peerDependencies", f"^{version}"),
                             ("devDependencies", version)):
            deps = meta.get(section)
            if not deps:
                continue
            for dep in list(deps):
                if dep.startswith(DSH_LINE) and deps[dep] != fmt:
                    deps[dep] = fmt
                    dirty = True
        if dirty:
            write_json(manifest, meta)
            changed.append(manifest)
    return changed


def cmd_platform_sync(args: object) -> None:
    version = getattr(args, "version", None)
    if not version or not VERSION_RE.match(version):
        fail("用法: dshctl.py platform-sync <版本>（如 0.1.2-alpha.2）")
    used = _used_dsh_packages()
    if not used:
        fail("仓库未使用任何 dsh 版本线平台包")
    _verify_on_npm(used, version)
    changed = _rewrite_manifests(version)
    print(f"[dshctl] 平台版本线钉版已统一到 {version}（{len(changed)} 个 manifest，"
          f"{len(used)} 个平台包已经 npm 核验）")
    print("[dshctl] 继续：pnpm install && python3 scripts/dshctl.py test")
