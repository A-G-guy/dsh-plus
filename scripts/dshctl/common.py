"""dshctl 公共层：路径常量、进程/命令工具、dev 环境约定。

本机差异一律外部化，严禁硬编码个人路径：
- 环境变量优先（DSHCTL_DSH_BIN / DSHCTL_TS_HOOK_REPO / DSHCTL_TOKEN_FILES）；
- 其次可选的 scripts/dshctl/local_config.py（gitignored 的机器本地覆盖，不入库）；
- 最后通用兜底（PATH 查找）。未配置时相关检查跳过或给出配置提示。
"""
from __future__ import annotations

import json
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

try:  # 机器本地覆盖（gitignored）：提供 TS_HOOK_REPO / EXTRA_TOKEN_FILES 等
    from . import local_config as _local_config
except ImportError:
    _local_config = None


def _local_value(key: str) -> str | None:
    if _local_config is None:
        return None
    value = getattr(_local_config, key, None)
    return value if isinstance(value, str) and value else None


def _resolve_dsh_bin() -> Path | None:
    override = os.environ.get("DSHCTL_DSH_BIN") or _local_value("DSH_BIN")
    if override:
        return Path(override)
    found = shutil.which("dsh")
    return Path(found) if found else None


REPO_ROOT = Path(__file__).resolve().parents[2]
PACKAGES_DIR = REPO_ROOT / "packages"
DIST_DIR = REPO_ROOT / "dist"

PROD_HOME = Path.home() / ".dsh"
DEV_HOME = Path.home() / ".dsh-dev"
DEV_RUN_DIR = DEV_HOME / "run"
DEV_PROFILE = "web"
DEV_PORT = 3082
MOCK_PORT = 3917

PROD_WEB_SERVICE = "dsh-web"
PROXY_SERVICE = "dsh-proxy"

# 外部文档时间戳工具仓库（可选）；None = 未配置，相关检查/安装跳过。
_ts_hook = os.environ.get("DSHCTL_TS_HOOK_REPO") or _local_value("TS_HOOK_REPO")
TS_HOOK_REPO: Path | None = Path(_ts_hook) if _ts_hook else None
# dsh CLI 入口；None = 未找到，调用处在使用时给出配置提示。
DSH_BIN: Path | None = _resolve_dsh_bin()


def dsh_bin() -> str:
    """dsh CLI 路径；未找到时给出配置方式后退出。"""
    if DSH_BIN is None:
        fail("未找到 dsh CLI：把 dsh 加入 PATH，或设置 DSHCTL_DSH_BIN 环境变量")
    return str(DSH_BIN)

# 开发实例环境清洗：这些真实密钥一律覆盖为 dummy，双保险防真实 API 调用。
REAL_KEY_VARS = [
    "NEWAPI_API_KEY",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "DEEPSEEK_API_KEY",
    "MOONSHOT_API_KEY",
    "KIMI_API_KEY",
]

# 生产 profile 端口（dsh 本体 3080 / 回环代理 3081），dev 严禁占用。
PROD_PORTS = {3080, 3081}

# ── 平台包单实例红线 ────────────────────────────────────────────────
# 平台包 = dsh 宿主安装树提供的包。插件必须经 peerDependencies 声明、运行时经
# profiles/node_modules fallback symlink 解析到宿主同一份实例；一旦作为运行时
# dependencies 被 pnpm 装进 profile，hoisted 布局下会在顶层形成第二份副本，
# 与宿主实例的 Symbol（如 TOOL_RUNTIME_SCHEDULER）错配 → 工具调度必炸。
PLATFORM_SCOPE = "@deepseek-ai/"
# 非 @deepseek-ai scope 但同样由 dsh 安装树闭包提供的平台包。
PLATFORM_EXTRA = {"@earendil-works/pi-ai"}
# profile 顶层需要扫描实体副本的 scope 目录。
PLATFORM_TOP_SCOPES = ("@deepseek-ai", "@earendil-works")


def is_platform_package(name: str) -> bool:
    return name.startswith(PLATFORM_SCOPE) or name in PLATFORM_EXTRA


def platform_runtime_deps(meta: dict) -> list[str]:
    """包 meta 的运行时依赖（dependencies + optionalDependencies）中的平台包。"""
    found: list[str] = []
    for section in ("dependencies", "optionalDependencies"):
        for dep in meta.get(section, {}):
            if is_platform_package(dep):
                found.append(dep)
    return sorted(found)


def find_platform_shadows(home: Path, profile: str = "web") -> list[str]:
    """profile 顶层 node_modules 下的平台包实体副本（hoisted 遮蔽）。

    symlink 是 isolated 布局的正常形态（指向 .pnpm），实体目录才是第二份副本。
    """
    nm = home / "profiles" / profile / "node_modules"
    shadows: list[str] = []
    for scope in PLATFORM_TOP_SCOPES:
        scope_dir = nm / scope
        if not scope_dir.is_dir():
            continue
        for child in sorted(scope_dir.iterdir()):
            if child.is_dir() and not child.is_symlink():
                shadows.append(f"{scope}/{child.name}")
    return shadows


def run(cmd: list[str], *, env: dict[str, str] | None = None,
        cwd: Path | None = None, check: bool = True,
        fail_banner: bool = True) -> subprocess.CompletedProcess[str]:
    """统一执行入口：输出经 output.run_logged 摘要（成功一行，警告/报错原文汇总）。

    check=True 且命令失败时，报错原文与日志路径已打印，此处转为干净退出。
    fail_banner=False 用于非零退出属正常探测语义的命令（如 git diff --quiet）。
    """
    from .output import run_logged
    env = dict(env) if env is not None else dict(os.environ)
    if DSH_BIN is not None:
        npm_bin = str(DSH_BIN.parent)
        if npm_bin not in env.get("PATH", ""):
            env["PATH"] = npm_bin + os.pathsep + env.get("PATH", "")
    try:
        return run_logged(cmd, env=env, cwd=cwd, check=check,
                          fail_banner=fail_banner)
    except subprocess.CalledProcessError as exc:
        if check:
            fail(f"命令失败（exit {exc.returncode}），详见上方报错与日志")
        return subprocess.CompletedProcess(cmd, exc.returncode, exc.output, exc.stderr)


def fail(msg: str, code: int = 1) -> None:
    print(f"[dshctl] 错误: {msg}", file=sys.stderr)
    raise SystemExit(code)


def port_open(port: int) -> bool:
    """127.0.0.1 回环端口连通性探测（仅用于本机 dev/mock 端口）。"""
    with socket.socket() as sock:
        sock.settimeout(0.5)
        return sock.connect_ex(("127.0.0.1", port)) == 0


def wait_port(port: int, name: str, timeout: float = 20.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if port_open(port):
            return
        time.sleep(0.3)
    fail(f"{name} 未在 {timeout}s 内监听 {port}，日志见 {DEV_RUN_DIR}/{name}.log")


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def yaml_scalar(text: str, key: str) -> str | None:
    """读取顶层 `key: value` 标量（profile pnpm-workspace.yaml 只有扁平标量，无需 yaml 库）。"""
    match = re.search(rf"^{re.escape(key)}:\s*(\S+)\s*$", text, re.MULTILINE)
    return match.group(1) if match else None


def write_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def package_dirs() -> list[Path]:
    return sorted(p.parent for p in PACKAGES_DIR.glob("*/package.json"))


def find_package(name_or_dir: str) -> Path:
    """按包名（@dsh-plus/xxx 或目录名）或路径定位插件包目录。"""
    candidate = Path(name_or_dir)
    if candidate.is_dir():
        return candidate.resolve()
    for pkg in package_dirs():
        meta = read_json(pkg / "package.json")
        if name_or_dir in {meta["name"], meta["name"].split("/")[-1], pkg.name}:
            return pkg
    fail(f"找不到包: {name_or_dir}（可用: {', '.join(p.name for p in package_dirs())}）")


def dev_env() -> dict[str, str]:
    """开发实例专用环境：DSH_HOME 切到 dev、真实密钥覆盖为 dummy。"""
    env = dict(os.environ)
    env["DSH_HOME"] = str(DEV_HOME)
    env["DSH_DEV_MOCK_KEY"] = "mock-local-key"
    # mock usage 注入：非零计数供 usage-panel 端到端校验（仍是假 LLM，零费用）
    env.setdefault("MOCK_USAGE_IN", "1234")
    env.setdefault("MOCK_USAGE_OUT", "567")
    for var in REAL_KEY_VARS:
        env[var] = "mock-disabled"
    env.pop("NODE_USE_ENV_PROXY", None)
    return env


def pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def start_daemon(cmd: list[str], *, env: dict[str, str], name: str) -> int:
    DEV_RUN_DIR.mkdir(parents=True, exist_ok=True)
    log = open(DEV_RUN_DIR / f"{name}.log", "ab")
    proc = subprocess.Popen(cmd, env=env, stdout=log, stderr=subprocess.STDOUT,
                            start_new_session=True)
    (DEV_RUN_DIR / f"{name}.pid").write_text(str(proc.pid))
    return proc.pid


def stop_daemon(name: str) -> bool:
    pidfile = DEV_RUN_DIR / f"{name}.pid"
    if not pidfile.exists():
        return False
    pid = int(pidfile.read_text().strip())
    if pid_alive(pid):
        os.killpg(pid, signal.SIGTERM)
        for _ in range(30):
            if not pid_alive(pid):
                break
            time.sleep(0.2)
        if pid_alive(pid):
            os.killpg(pid, signal.SIGKILL)
    pidfile.unlink(missing_ok=True)
    return True


def daemon_status(name: str) -> str:
    pidfile = DEV_RUN_DIR / f"{name}.pid"
    if not pidfile.exists():
        return "stopped"
    pid = int(pidfile.read_text().strip())
    return f"running (pid {pid})" if pid_alive(pid) else f"stale (pid {pid} 已退出)"


def daemon_running(name: str) -> bool:
    """进程真实存活才算 running；stale pidfile 直接清除，避免误判为在跑。"""
    pidfile = DEV_RUN_DIR / f"{name}.pid"
    if not pidfile.exists():
        return False
    pid = int(pidfile.read_text().strip())
    if pid_alive(pid):
        return True
    pidfile.unlink(missing_ok=True)
    return False
