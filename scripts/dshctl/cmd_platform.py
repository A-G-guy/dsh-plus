"""dshctl platform-sync：把全仓 @deepseek-ai/dsh 版本线钉版统一改写到目标版本。

背景：dsh 自 0.1.2-alpha.2 起发布 npm，平台依赖一律走 registry 解析
（各包 manifest 的 peer `^<版本>` + dev 精确 `<版本>` 即事实源，doctor 据此
与本机 dsh CLI 版本比对）。本命令是升级平台版本的唯一入口：

  1. 收集 packages/*/package.json 实际用到的 dsh 版本线包（peer/dev/dependencies）；
  2. 逐一核验官方 registry 上存在该版本（防钉到未发布版本；直连官方 registry，
     本机 npm 镜像的同步延迟不参与判定）；
  3. 统一改写所有 manifest 的 dsh 版本线钉版（peer → ^<version>，dev → <version>）；
     基座包（cordis/schemastery/cosmokit 等独立版本线）不动，按需手工升级。

执行后按提示 pnpm install + dshctl test 验证。
"""
from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from pathlib import Path

from .common import PACKAGES_DIR, fail, read_json, write_json

# dsh 版本线包名前缀（与 common.PLATFORM_DSH_LINE 同义，局部常量避免循环依赖误导）。
DSH_LINE = "@deepseek-ai/dsh"

# 官方 registry 固定直连——`npm view` 走用户配置的 registry（可能是镜像），
# 刚发布的版本在镜像上有同步延迟，会把"已发布"误判为"不存在"。
NPM_REGISTRY = "https://registry.npmjs.org"
REGISTRY_TIMEOUT = 20

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


def version_exists_on_registry(name: str, version: str) -> bool:
    """直连官方 registry 核验 name@version 是否存在（404 = 不存在）。"""
    url = f"{NPM_REGISTRY}/{name.replace('/', '%2f')}/{version}"
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=REGISTRY_TIMEOUT) as resp:
            return resp.status == 200
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return False
        fail(f"registry 查询失败 {name}@{version}: HTTP {exc.code}")
    except urllib.error.URLError as exc:
        fail(f"registry 不可达: {exc.reason}（需要代理时先 export HTTPS_PROXY）")
    return False


def _verify_on_npm(packages: list[str], version: str) -> None:
    """逐一核验官方 registry 上存在目标版本；任一缺失即整体失败（不写任何文件）。"""
    missing = [name for name in packages
               if not version_exists_on_registry(name, version)]
    if missing:
        fail(f"官方 registry 上不存在 {version} 版本的平台包: "
             f"{', '.join(missing)}（未做任何改写）")


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
