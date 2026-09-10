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
import os
import re
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

from .common import (PACKAGES_DIR, PROD_WEB_SERVICE, _local_value, fail,
                     read_json, run, write_json)

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

    --defer <版本>：不立即升级，写入"待升级标记"并确保 systemd 升级闸门就位。
    之后用户在 WebUI 点一下 /reload：服务重启 → 闸门在 dsh 进程启动前完成
    升级 → 新版本启动——全程无需停止生产进程、无需用户离开 WebUI。
    --clear：清除待升级标记（闸门保留，无标记时直通）。
    """
    if getattr(args, "clear", False):
        _clear_upgrade_gate()
        return
    version = getattr(args, "version", None)
    if not version or not VERSION_RE.match(version):
        fail("用法: dshctl.py upgrade-cli <版本>（立即升级）| "
             "upgrade-cli --defer <版本>（写入标记，配合 WebUI /reload 完成）| "
             "upgrade-cli --clear（清除待升级标记）")
    if not version_exists_on_registry(DSH_LINE, version):
        fail(f"官方 registry 上不存在 @deepseek-ai/dsh@{version}"
             "（刚发布需等待同步，稍后重试）")
    if getattr(args, "defer", False):
        _defer_upgrade(version)
        return
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


# ── defer 模式：标记文件 + systemd 升级闸门 ──────────────────────────

GATE_MARKER = Path.home() / ".dsh/pending-cli-upgrade.json"
GATE_SCRIPT = Path.home() / ".dsh/scripts/dsh-web-cli-gate.sh"
GATE_LOG = Path.home() / ".dsh/logs/cli-upgrade.log"
GATE_UNIT_DROPIN = "/etc/systemd/system/dsh-web.service.d/20-cli-upgrade-gate.conf"
NPM_BIN = Path.home() / ".npm-global/bin/npm"
DSH_BIN_PATH = Path.home() / ".npm-global/bin/dsh"

# shell 环境单一来源（zsh/bash 共享）。闸门脚本是 20- drop-in 覆盖后的实际
# ExecStart，10-shell-env.conf 里的 source 会被顶掉，故由闸门自行注入：
# bash 工具继承 dsh 进程环境，不注入则只剩 systemd 默认 PATH。
SHELL_ENV_FILE = Path(os.environ.get("DSHCTL_SHELL_ENV_FILE")
                      or _local_value("SHELL_ENV_FILE")
                      or Path.home() / ".config/shell/env.sh")

# systemd drop-in：清空原 ExecStart 改走闸门 wrapper（升级完成/失败均直通启动
# dsh），并放宽启动超时——npm 完整重装闭包可能耗时 1-3 分钟。
GATE_DROPIN_TEMPLATE = """# dshctl upgrade-cli --defer 安装的 CLI 升级闸门（幂等，可安全删除以还原）：
# 服务启动前若存在待升级标记，先完成全局 CLI 升级再启动 dsh（进程未起，替换安全）。
[Service]
ExecStart=
ExecStart={gate} web --trusted-host miniserver.tail27b689.ts.net
TimeoutStartSec=600
"""

# 闸门脚本：先注入 shell 环境 → 存在标记则 npm 升级（失败保留标记待下次 reload
# 重试，不阻塞启动）→ dsh --version 校验 → 清标记；随后 exec 原 dsh 入口。
# 绝对路径避免服务环境 PATH 差异。
GATE_SCRIPT_TEMPLATE = """#!/usr/bin/env bash
# dshctl 安装的 CLI 升级闸门：dsh-web 服务启动前置钩子。
# 存在 $DSH_HOME/pending-cli-upgrade.json 时先升级全局 CLI（此时无 dsh 进程，
# 替换全局包文件安全），再启动 dsh。升级失败不阻塞启动（保留标记待重试）。
set -u
# 环境注入：本脚本是 20- drop-in 覆盖后的实际 ExecStart，10-shell-env.conf 的
# source 已被顶掉，须在此恢复同一份 shell 环境来源——否则 dsh 进程只拿到 systemd
# 默认 PATH，bash 工具随之缺 PATH/ANDROID_HOME 等变量。取源期间临时关闭 -u
# （用户环境文件常引用未定义变量），任何失败都不阻塞启动。
if [ -f "{env_file}" ]; then
  set +u
  . "{env_file}" || true
  set -u
fi
GATE_FILE="$HOME/.dsh/pending-cli-upgrade.json"
LOG="$HOME/.dsh/logs/cli-upgrade.log"
if [ -f "$GATE_FILE" ]; then
  echo "=== $(date '+%F %T') gate: 检测到待升级标记 ===" >> "$LOG"
  VERSION="$(python3 -c "import json;print(json.load(open('$GATE_FILE'))['version'])")"
  PREV="$(python3 -c "import json;print(json.load(open('$GATE_FILE')).get('prev',''))")"
  if {NPM} install -g "@deepseek-ai/dsh@$VERSION" --registry=https://registry.npmjs.org >> "$LOG" 2>&1; then
    ACTUAL="$({DSH} --version 2>&1 | tail -1)"
    if [ "$ACTUAL" = "$VERSION" ]; then
      rm -f "$GATE_FILE"
      echo "=== $(date '+%F %T') gate: 升级完成 $VERSION ===" >> "$LOG"
    else
      echo "=== $(date '+%F %T') gate: 版本不符（$ACTUAL != $VERSION），尝试回滚 $PREV ===" >> "$LOG"
      if [ -n "$PREV" ]; then
        {NPM} install -g "@deepseek-ai/dsh@$PREV" --registry=https://registry.npmjs.org >> "$LOG" 2>&1 || true
      fi
    fi
  else
    echo "=== $(date '+%F %T') gate: npm 升级失败，保留标记待下次 reload 重试 ===" >> "$LOG"
  fi
fi
exec {DSH} "$@"
"""


def _current_cli_version() -> str:
    proc = subprocess.run(["dsh", "--version"], capture_output=True, text=True,
                          timeout=30)
    return (proc.stdout or proc.stderr or "").strip() or "unknown"


def _gate_script_text() -> str:
    """闸门脚本文本（模板填充的唯一入口，避免线上脚本与模板漂移）。"""
    return GATE_SCRIPT_TEMPLATE.format(NPM=NPM_BIN, DSH=DSH_BIN_PATH,
                                       env_file=SHELL_ENV_FILE)


def _ensure_gate_installed() -> None:
    """确保闸门脚本与 systemd drop-in 就位（幂等）。"""
    GATE_SCRIPT.parent.mkdir(parents=True, exist_ok=True)
    GATE_LOG.parent.mkdir(parents=True, exist_ok=True)
    script = _gate_script_text()
    if not GATE_SCRIPT.exists() or GATE_SCRIPT.read_text(encoding="utf-8") != script:
        GATE_SCRIPT.write_text(script, encoding="utf-8")
    GATE_SCRIPT.chmod(0o755)
    dropin = GATE_DROPIN_TEMPLATE.format(gate=GATE_SCRIPT)
    proc = subprocess.run(["sudo", "-n", "tee", GATE_UNIT_DROPIN],
                          input=dropin, capture_output=True, text=True)
    if proc.returncode != 0:
        fail(f"写入 systemd drop-in 失败: {proc.stderr.strip() or proc.stdout.strip()}")
    subprocess.run(["sudo", "-n", "systemctl", "daemon-reload"], check=False)
    shown = subprocess.run(["systemctl", "show", "-p", "ExecStart", "--value",
                            PROD_WEB_SERVICE], capture_output=True, text=True)
    if str(GATE_SCRIPT) not in shown.stdout:
        fail(f"systemd 服务 {PROD_WEB_SERVICE} 的 ExecStart 未指向闸门脚本"
             f"（当前: {shown.stdout.strip()}），请检查 drop-in 是否生效")
    print(f"[upgrade-cli] ✔ 升级闸门就位：服务启动前自动完成 CLI 升级（{GATE_SCRIPT}）")


def _defer_upgrade(version: str) -> None:
    """写待升级标记并确保闸门就位；用户在 WebUI 点 /reload 即完成升级。"""
    _ensure_gate_installed()
    marker = {"version": version, "prev": _current_cli_version(),
              "writtenAt": time.strftime("%Y-%m-%dT%H:%M:%S")}
    GATE_MARKER.write_text(json.dumps(marker, indent=2) + "\n", encoding="utf-8")
    print(f"[upgrade-cli] ✔ 待升级标记已写入 {GATE_MARKER.name}"
          f"（目标 {version}，回滚基线 {marker['prev']}）")
    print("[upgrade-cli] 现在在 WebUI 中点一下 /reload（或设置页「重新加载」）：")
    print("[upgrade-cli] 服务重启时闸门会先完成 CLI 升级再启动，期间 GUI 短暂中断后自动恢复")


def _clear_upgrade_gate() -> None:
    """清除待升级标记（闸门保留，无标记时直通启动）。"""
    if GATE_MARKER.exists():
        GATE_MARKER.unlink()
        print("[upgrade-cli] ✔ 待升级标记已清除")
    else:
        print("[upgrade-cli] 无待升级标记")
