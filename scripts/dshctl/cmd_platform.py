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
import subprocess
import urllib.error
import urllib.request
from pathlib import Path

from .common import (PACKAGES_DIR, PROD_WEB_SERVICE, fail, read_json, run,
                     write_json)

# dsh 版本线包名前缀（与 common.PLATFORM_DSH_LINE 同义，局部常量避免循环依赖误导）。
DSH_LINE = "@deepseek-ai/dsh"

# 官方 registry 固定直连——`npm view` 走用户配置的 registry（可能是镜像），
# 刚发布的版本在镜像上有同步延迟，会把"已发布"误判为"不存在"。
NPM_REGISTRY = "https://registry.npmjs.org"
REGISTRY_TIMEOUT = 20

VERSION_RE = re.compile(r"^\d+\.\d+\.\d+.*$")

# 升级 CLI 后的全局平台包一致性抽查清单（混合版本 = dsh 主包新 + 平台包旧，
# npm 对 prerelease 范围解析可能产生；抽查关键包即可暴露）。
PLATFORM_SPOT_CHECKS = (
    "dsh", "dsh-app-boot", "dsh-web-app", "dsh-base",
    "dsh-session", "dsh-agent-loop", "dsh-agent", "dsh-subagent",
    "dsh-client-connection", "dsh-api-gateway", "dsh-llm", "dsh-tool-subagent",
)


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


# ── upgrade-cli：安全升级全局 dsh CLI ────────────────────────────────

def running_dsh_processes() -> list[tuple[str, str]]:
    """探测从全局 CLI 启动的 dsh 进程（web/headless 等）。

    升级全局 CLI 会替换运行中进程依赖的全局包文件：进程内动态加载（worker、
    cordis loader 按需 require、子进程）可能读到不完整文件——曾导致生产 GUI
    黑屏。返回 [(pid, 命令行摘要)]。
    """
    proc = subprocess.run(["ps", "-eo", "pid=,args="], capture_output=True,
                          text=True, timeout=15)
    rows: list[tuple[str, str]] = []
    for line in proc.stdout.splitlines():
        pid, _, args = line.strip().partition(" ")
        if not pid.isdigit():
            continue
        if re.search(r"bin/dsh", args) and re.search(r"\b(web|headless)\b", args):
            rows.append((pid, args[:140]))
    return rows


def _global_package_dir() -> Path:
    """全局 node_modules 根（npm root -g）。"""
    proc = subprocess.run(["npm", "root", "-g"], capture_output=True, text=True,
                          timeout=15)
    return Path(proc.stdout.strip())


def global_platform_versions(root: Path | None = None) -> dict[str, str]:
    """读取全局平台抽查包的实际版本（key=包名短名）。"""
    base = root or _global_package_dir()
    out: dict[str, str] = {}
    for name in PLATFORM_SPOT_CHECKS:
        manifest = base / "@deepseek-ai" / name / "package.json"
        if manifest.is_file():
            out[name] = read_json(manifest).get("version", "?")
    return out


def cmd_upgrade_cli(args: object) -> None:
    """升级全局 dsh CLI（官方 registry）并校验版本一致性；运行中进程探测防御。

    背景：全局 npm 升级会替换运行中 dsh 进程依赖的包文件（曾致生产黑屏），
    且 npm 对 prerelease 范围解析可能留下"dsh 主包新 + 平台包旧"的混合版本。
    本命令默认拒绝在运行中进程存在时升级；升级后抽查平台包版本一致性。
    """
    version = getattr(args, "version", None)
    if not version or not VERSION_RE.match(version):
        fail("用法: dshctl.py upgrade-cli <版本>（如 0.1.3-alpha.2）")
    if not version_exists_on_registry(DSH_LINE, version):
        fail(f"官方 registry 上不存在 @deepseek-ai/dsh@{version}"
             "（刚发布需等待同步，稍后重试）")
    running = running_dsh_processes()
    if running and not getattr(args, "force", False):
        lines = "\n".join(f"    PID {pid}: {args_text}" for pid, args_text in running)
        fail(f"检测到 {len(running)} 个由全局 CLI 启动的 dsh 进程在运行：\n{lines}\n"
             "升级会替换运行中进程依赖的全局包文件，动态加载可能读到不完整文件"
             "（曾导致生产 GUI 黑屏）。请先停止这些进程再升级"
             f"（生产: sudo systemctl stop {PROD_WEB_SERVICE}；dev: dshctl dev down），"
             "或在维护窗口内明确承担风险后以 --force 执行")
    run(["npm", "install", "-g", f"{DSH_LINE}@{version}", "--registry", NPM_REGISTRY])
    proc = subprocess.run(["dsh", "--version"], capture_output=True, text=True,
                          timeout=30)
    installed = (proc.stdout or proc.stderr or "").strip()
    if version not in installed:
        fail(f"升级后 dsh --version 为 {installed!r}，与目标 {version} 不符，"
             "请检查上方 npm 输出")
    versions = global_platform_versions()
    mixed = {name: v for name, v in versions.items()
             if name != "dsh" and v != version}
    if mixed:
        detail = ", ".join(f"{n}@{v}" for n, v in mixed.items())
        print(f"[upgrade-cli] 警告：全局平台包版本不一致（{detail}）——"
              "npm 依赖解析未把平台包升到目标线（prerelease 范围陷阱）；"
              "建议重跑本命令或人工 npm i -g 各平台包", file=sys.stderr)
    else:
        print(f"[upgrade-cli] ✔ 全局 CLI 与抽查平台包已统一到 {version}")
    print("[upgrade-cli] 重启生效（生产: python3 scripts/dshctl.py restart-prod，"
          "需用户确认）")
