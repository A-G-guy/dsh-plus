"""dshctl dev：开发实例生命周期（init/link/up/down/restart/logs/status）与 mock 脚本助手。

铁律：全部操作只作用于 DEV_HOME（~/.dsh-dev）与 DEV_PORT/MOCK_PORT，
绝不触碰生产 home、生产服务与网络映射。
"""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

from .common import (DEV_HOME, DEV_PORT, DEV_PROFILE, DEV_RUN_DIR, dsh_bin,
                     MOCK_PORT, PACKAGES_DIR, REPO_ROOT, daemon_running,
                     daemon_status, dev_env, fail, port_open, read_json, run,
                     start_daemon, stop_daemon, wait_port, write_json)

MOCK_SETTINGS = """\
# dev 专用：所有 provider 指向本机 mock LLM（127.0.0.1），严禁填入真实网关。
# 模型 id 复用 catalog 已知条目以继承元数据；mock 不区分模型，一律回显/脚本化应答。
agent-default-model:
  provider: deepseek
  model: deepseek-v4-flash

llm-pi-ai:
  providers:
    deepseek:
      displayName: local-mock(openai-chat)
      apiKeyEnv: DSH_DEV_MOCK_KEY
      baseURL: http://127.0.0.1:3917/v1
      models:
        - id: deepseek-v4-flash
          name: Mock Flash
permission:
  defaultPreset: danger-full-access
"""

# dev home 下统一管理的 profile；headless 用于零费用冒烟。
PROFILES = ("web", "headless")
DEFAULT_BUNDLES = {
    "web": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"],
    "headless": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless"],
}
MOCK_SCRIPT_FILE = DEV_RUN_DIR / "mock-script.jsonl"


def ensure_mock_running() -> None:
    """确保 mock-llm 守护进程在跑（smoke/seed/mock 共用入口）。"""
    if daemon_running("mock-llm"):
        return
    env = dev_env()
    env["MOCK_SCRIPT_FILE"] = str(MOCK_SCRIPT_FILE)
    start_daemon(["python3", str(REPO_ROOT / "scripts/mock_llm.py"),
                  "--port", str(MOCK_PORT)], env=env, name="mock-llm")
    wait_port(MOCK_PORT, "mock-llm")


def write_mock_script(entries: list[dict]) -> None:
    """覆盖写入 mock 脚本化响应队列（JSONL，每行一个响应对象）。"""
    MOCK_SCRIPT_FILE.write_text(
        "\n".join(json.dumps(e, ensure_ascii=False) for e in entries) + "\n",
        encoding="utf-8")


def clear_mock_script() -> None:
    """消费完毕/中断后清理脚本队列，避免残留条目污染后续会话。"""
    MOCK_SCRIPT_FILE.unlink(missing_ok=True)


def _workspace_link_deps() -> dict[str, str]:
    deps: dict[str, str] = {}
    for pkg_json in sorted(PACKAGES_DIR.glob("*/package.json")):
        meta = read_json(pkg_json)
        deps[meta["name"]] = f"link:{pkg_json.parent}"
    return deps


def _dev_profile_dir(profile: str = DEV_PROFILE) -> Path:
    return DEV_HOME / "profiles" / profile


def _ensure_profile(env: dict[str, str], profile: str) -> None:
    """触发 profile 模板自动初始化（首次使用时 dsh 自建）。"""
    if (_dev_profile_dir(profile) / "package.json").exists():
        return
    run([dsh_bin(), "--profile", profile, "--dump-config"], env=env)
    if not (_dev_profile_dir(profile) / "package.json").exists():
        fail(f"{profile} profile 自动初始化失败，请手动检查 dsh 输出")


# 示例工具仅经 dev profile 用户补丁层注入（供 smoke/调试），不进 bundle-main、不进生产。
DEMO_TOOL_ROW = """\
# ── dsh-plus 示例工具（仅开发环境注入，勿复制到生产）──────────────────
- insert:
    - id: dsh-plus-text-transform
      name: '@dsh-plus/tool-text-transform'
"""

# headless profile 无 webServer/UI 面：这些 bundle 插件行必须禁用，否则 boot
# 卡在 pending（waiting for service: webServer）导致 hl/smoke 全灭。
HEADLESS_DISABLED_IDS = (
    "dsh-plus-access-gate",
    "dsh-plus-usage-panel",
    "dsh-plus-lifeboat",
    "dsh-plus-web-terminal",
)


def _ensure_demo_tool_row(profile: str) -> None:
    patch = _dev_profile_dir(profile) / "cordis.patch.yml"
    if not patch.exists():
        return
    text = patch.read_text(encoding="utf-8")
    if "dsh-plus-text-transform" in text:
        return
    stripped = text.rstrip()
    if stripped.endswith("[]"):
        # 空数组模板：去掉 [] 行后追加示例行
        stripped = stripped[: stripped.rfind("[]")].rstrip()
    patch.write_text(stripped + "\n" + DEMO_TOOL_ROW, encoding="utf-8")
    print(f"[dev] 示例工具行已注入 {profile}/cordis.patch.yml")


def _ensure_headless_disables() -> None:
    """headless 用户补丁层补齐 web 系插件禁用行（缺失才追加，幂等）。"""
    patch = _dev_profile_dir("headless") / "cordis.patch.yml"
    if not patch.exists():
        return
    text = patch.read_text(encoding="utf-8")
    missing = [pid for pid in HEADLESS_DISABLED_IDS if f"id: {pid}" not in text]
    if not missing:
        return
    rows = "\n".join(f"- id: {pid}\n  disabled: true" for pid in missing)
    patch.write_text(text.rstrip() + "\n\n"
                     "# ── web 系插件在 headless 禁用（无 webServer/UI 面）─────\n"
                     + rows + "\n", encoding="utf-8")
    print(f"[dev] headless 补丁层已禁用 web 系插件: {', '.join(missing)}")


def _link_workspace_packages(profile: str) -> None:
    pkg_json = _dev_profile_dir(profile) / "package.json"
    meta = read_json(pkg_json)
    deps = meta.setdefault("dependencies", {})
    current = _workspace_link_deps()
    # 清除已删除/改名的 workspace 包残留 link（只动指向本仓库的 @dsh-plus/* link）
    for name, spec in list(deps.items()):
        if (name not in current and name.startswith("@dsh-plus/")
                and isinstance(spec, str) and spec.startswith("link:")
                and str(PACKAGES_DIR) in spec):
            del deps[name]
    deps.update(current)
    prof = meta.setdefault("dsh", {}).setdefault("profile", {})
    bundles = prof.setdefault("bundles", DEFAULT_BUNDLES.get(profile, []))
    if "@dsh-plus/bundle-main" not in bundles:
        bundles.append("@dsh-plus/bundle-main")
    write_json(pkg_json, meta)
    _ensure_demo_tool_row(profile)
    if profile == "headless":
        _ensure_headless_disables()
    run([dsh_bin(), "plugin", "--profile", profile, "install"], env=dev_env())


def cmd_dev_init(_args) -> None:
    env = dev_env()
    DEV_RUN_DIR.mkdir(parents=True, exist_ok=True)
    settings = DEV_HOME / "settings.yaml"
    if not settings.exists():
        settings.write_text(MOCK_SETTINGS, encoding="utf-8")
        print(f"[dev] 已写入 mock 版 settings.yaml → {settings}")
    for extra in ("AGENTS.md", "skills"):
        src = Path.home() / ".dsh" / extra
        dst = DEV_HOME / extra
        if src.exists() and not dst.exists():
            if src.is_dir():
                shutil.copytree(src, dst)
            else:
                shutil.copy2(src, dst)
    for profile in PROFILES:
        _ensure_profile(env, profile)
        _link_workspace_packages(profile)
    prod_patch = Path.home() / ".dsh/profiles/web/cordis.patch.yml"
    dev_patch = _dev_profile_dir("web") / "cordis.patch.yml"
    if prod_patch.exists() and dev_patch.read_text(encoding="utf-8").strip().endswith("[]"):
        shutil.copy2(prod_patch, dev_patch)
        print("[dev] 已复制生产 cordis.patch.yml（subagent 路由到 mock provider）")
    print("[dev] 初始化完成：DSH_HOME=~/.dsh-dev，模型全部走本机 mock")


def cmd_dev_link(_args) -> None:
    linked = []
    for profile in PROFILES:
        if (_dev_profile_dir(profile) / "package.json").exists():
            _link_workspace_packages(profile)
            linked.append(profile)
    if not linked:
        fail("dev profile 未初始化，请先运行: dshctl.py dev init")
    print(f"[dev] workspace 包已 link 进 dev profile: {', '.join(linked)}")


def _start_daemons() -> None:
    """拉起 mock-llm 与 dsh-web-dev（幂等：已在跑则跳过）。"""
    if not daemon_running("mock-llm"):
        ensure_mock_running()
        print(f"[dev] mock-llm 已启动 → http://127.0.0.1:{MOCK_PORT}/v1")
    if not daemon_running("dsh-web-dev"):
        if port_open(DEV_PORT):
            fail(f"端口 {DEV_PORT} 被非 dev 进程占用，请先释放")
        start_daemon([dsh_bin(), "web", "--port", str(DEV_PORT)],
                     env=dev_env(), name="dsh-web-dev")
        wait_port(DEV_PORT, "dsh-web-dev")
        print(f"[dev] dsh-web-dev 已启动 → {dev_authed_url()}")


def dev_authed_url(port: int = DEV_PORT) -> str:
    """dev 实例当前进程认证链接（含启动令牌；检索失败退化为裸地址 + 提示）。"""
    from .auth import authenticated_url
    try:
        return authenticated_url(
            port, host=f"127.0.0.1:{port}", scheme="http",
            service=None, dev_log=DEV_RUN_DIR / "dsh-web-dev.log")
    except SystemExit:
        return f"http://127.0.0.1:{port}（令牌检索失败，稍后可用 dshctl.py url --dev 重取）"


def cmd_dev_up(args) -> None:
    if not (_dev_profile_dir() / "package.json").exists():
        fail("dev profile 未初始化，请先运行: dshctl.py dev init")
    if not getattr(args, "fast", False):
        run(["pnpm", "-r", "build"], cwd=REPO_ROOT)
        for profile in PROFILES:
            if (_dev_profile_dir(profile) / "package.json").exists():
                _link_workspace_packages(profile)
    _start_daemons()
    cmd_dev_status(args)


def ensure_dev_up() -> None:
    """dev 未监听时按 fast 路径自动拉起（不重建）；供会话/mock/pw 命令调用。"""
    if port_open(DEV_PORT):
        return
    if not (_dev_profile_dir() / "package.json").exists():
        fail("dev profile 未初始化，请先运行: dshctl.py dev init && dshctl.py dev up")
    _start_daemons()
    print(f"[dev] dev 实例已自动拉起（未重建；改了源码请手动 dshctl.py dev up）",
          file=sys.stderr)


def cmd_dev_down(_args) -> None:
    stopped = [n for n in ("dsh-web-dev", "mock-llm") if stop_daemon(n)]
    print(f"[dev] 已停止: {', '.join(stopped) if stopped else '（无运行中的 dev 进程）'}")


def cmd_dev_restart(args) -> None:
    cmd_dev_down(args)
    cmd_dev_up(args)


def cmd_dev_logs(args) -> None:
    """打印守护进程日志尾部；缺省两个都打（mock 排障主入口）。"""
    names = [args.name] if args.name else ["mock-llm", "dsh-web-dev"]
    for name in names:
        log = DEV_RUN_DIR / f"{name}.log"
        if not log.exists():
            print(f"[dev] 无日志: {name}（未启动过？）")
            continue
        lines = log.read_text(encoding="utf-8", errors="replace") \
                   .splitlines()[-args.lines:]
        print(f"── {name}.log 末尾 {len(lines)} 行 ──")
        print("\n".join(lines))


def cmd_dev_status(_args) -> None:
    print(f"mock-llm    : {daemon_status('mock-llm')} (:{MOCK_PORT})")
    print(f"dsh-web-dev : {daemon_status('dsh-web-dev')} (:{DEV_PORT})")
    print(f"日志目录    : {DEV_RUN_DIR}")
