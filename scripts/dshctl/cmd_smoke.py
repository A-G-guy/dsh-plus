"""dshctl smoke：零费用端到端冒烟——mock 脚本化发起工具调用，验证插件全链路。

链路：headless 会话 → mock LLM 弹出脚本化 tool_call → dsh 真执行 text_transform
→ 回传结果 → mock 给出脚本化终答。全程本机回环，零真实 API 费用。

smoke-prod：生产布局回归。scratch DSH_HOME + 真实 tgz vendor 安装 + 被测
nodeLinker 布局 + 内置 bash 工具调用——复现 hoisted 顶层平台副本遮蔽宿主实例
导致 TOOL_RUNTIME_SCHEDULER 跨实例 Symbol 错配的事故面，peer 化后必须双向通过。
"""
from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from .cmd_dev import (HEADLESS_DISABLED_IDS, MOCK_SETTINGS, _dev_profile_dir,
                      clear_mock_script, ensure_mock_running, write_mock_script)
from .common import (DEV_HOME, dsh_bin, PROD_HOME, dev_env, fail,
                     find_platform_shadows, read_json, run, write_json,
                     yaml_scalar)

SMOKE_MARKER = "SMOKE_OK"
SMOKE_PROMPT = "Call text_transform with text=abc op=uppercase, then answer briefly."
# match 按请求体子串命中：entry1 命中用户提示，entry2 命中工具结果回传（含 ABC），
# 会话标题等辅助请求不带 match 不会消费脚本条目。
SMOKE_SCRIPT = [
    {"match": "text_transform with text=abc",
     "tool_calls": [{"name": "text_transform",
                     "arguments": {"text": "abc", "op": "uppercase"}}]},
    {"match": "ABC", "content": f"{SMOKE_MARKER}: tool returned ABC"},
]


def cmd_smoke(_args) -> None:
    if not (DEV_HOME / "settings.yaml").exists():
        fail("dev home 未初始化，请先运行: dshctl.py dev init")
    if not (_dev_profile_dir("headless") / "package.json").exists():
        fail("headless profile 未初始化，请先运行: dshctl.py dev init")
    ensure_mock_running()
    write_mock_script(SMOKE_SCRIPT)
    proc = subprocess.run(
        [dsh_bin(), "--profile", "headless", SMOKE_PROMPT],
        env=dev_env(), capture_output=True, text=True, timeout=120)
    clear_mock_script()
    if proc.returncode != 0:
        print(proc.stderr[-2000:], file=sys.stderr)
        fail("headless 冒烟会话失败")
    if SMOKE_MARKER not in proc.stdout:
        print(proc.stdout[-2000:], file=sys.stderr)
        fail(f"终答未见 {SMOKE_MARKER}，工具调用链路未按脚本走通")
    print(f"[smoke] ✔ 工具调用全链路通过（{SMOKE_MARKER}），全程本机 mock，零 API 费用")


# ── smoke-prod：生产布局回归 ─────────────────────────────────────
SMOKE_PROD_MARKER = "SMOKE_PROD_OK"
SMOKE_PROD_PROMPT = "Run `echo dsh-plus-smoke` via the bash tool, then answer briefly."
SMOKE_PROD_SCRIPT = [
    {"match": "echo dsh-plus-smoke",
     "tool_calls": [{"name": "bash",
                     "arguments": {"command": "echo dsh-plus-smoke",
                                   "description": "smoke echo"}}]},
    {"match": "dsh-plus-smoke",
     "content": f"{SMOKE_PROD_MARKER}: bash tool returned"},
]
SMOKE_PROFILE = "headless"


def _prod_linker() -> str:
    ws = PROD_HOME / "profiles/web/pnpm-workspace.yaml"
    if ws.exists():
        linker = yaml_scalar(ws.read_text(encoding="utf-8"), "nodeLinker")
        if linker:
            return linker
    return "hoisted"


def _init_scratch_profile(scratch: Path, env: dict[str, str], linker: str) -> Path:
    """scratch home 初始化 headless profile 并覆写为被测布局。"""
    (scratch / "settings.yaml").write_text(MOCK_SETTINGS, encoding="utf-8")
    run([dsh_bin(), "--profile", SMOKE_PROFILE, "--dump-config"], env=env)
    profile = scratch / "profiles" / SMOKE_PROFILE
    if not (profile / "package.json").exists():
        fail(f"scratch {SMOKE_PROFILE} profile 初始化失败")
    (profile / "pnpm-workspace.yaml").write_text(
        f"packages:\n  - .\n\nnodeLinker: {linker}\nautoInstallPeers: false\n"
        # node-pty 优先 prebuilds 免编译，允许其 install 脚本（否则 pnpm 以
        # ERR_PNPM_IGNORED_BUILDS 非零退出）；与生产 profile 决策一致。
        "allowBuilds:\n  node-pty: true\n",
        encoding="utf-8")
    # 0.1.2-alpha.1 起 boot 把「等待不存在的服务」当硬失败（rc 期为挂起）；
    # headless 无 webServer，与 dev headless 同策禁用 web 系插件。
    rows = "\n".join(f"- id: {pid}\n  disabled: true" for pid in HEADLESS_DISABLED_IDS)
    (profile / "cordis.patch.yml").write_text(
        "# web 系插件在 headless 禁用（无 webServer/UI 面）\n" + rows + "\n",
        encoding="utf-8")
    return profile


def _vendor_bundle_into_scratch(scratch: Path, profile: str) -> None:
    """bundle-main 闭包打成 tgz 并 vendor 进 scratch profile（镜像生产结构）。"""
    from .cmd_pack import (_apply_prod_profile_specs,
                           _guard_closure_no_platform_runtime_deps,
                           _vendor_into_prod_profile, _workspace_dep_closure)
    from .common import find_package
    closure = _workspace_dep_closure(find_package("bundle-main"))
    _guard_closure_no_platform_runtime_deps(closure)
    from .cmd_pack import pack_one
    named = [(read_json(p / "package.json")["name"], pack_one(p)) for p in closure]
    specs = _vendor_into_prod_profile(named, home=scratch, profile=profile)
    _apply_prod_profile_specs(specs, home=scratch, profile=profile)
    pkg_json = scratch / "profiles" / profile / "package.json"
    meta = read_json(pkg_json)
    bundles = meta.setdefault("dsh", {}).setdefault("profile", {}) \
        .setdefault("bundles", [])
    if "@dsh-plus/bundle-main" not in bundles:
        bundles.append("@dsh-plus/bundle-main")
    write_json(pkg_json, meta)


def cmd_smoke_prod(args) -> None:
    linker = args.linker or _prod_linker()
    scratch = Path(tempfile.mkdtemp(prefix="dsh-smoke-prod-"))
    env = dev_env()
    env["DSH_HOME"] = str(scratch)
    try:
        _init_scratch_profile(scratch, env, linker)
        _vendor_bundle_into_scratch(scratch, SMOKE_PROFILE)
        run([dsh_bin(), "plugin", "--profile", SMOKE_PROFILE, "install"], env=env)
        shadows = find_platform_shadows(scratch, SMOKE_PROFILE)
        if shadows:
            fail(f"scratch profile 顶层检出平台包副本（{linker} 布局下 peer 化未生效？）: "
                 + ", ".join(shadows))
        print(f"[smoke-prod] ✔ {linker} 布局下 profile 顶层无平台包副本")
        ensure_mock_running()
        write_mock_script(SMOKE_PROD_SCRIPT)
        proc = subprocess.run(
            [dsh_bin(), "--profile", SMOKE_PROFILE, SMOKE_PROD_PROMPT],
            env=env, capture_output=True, text=True, timeout=120)
        clear_mock_script()
        if proc.returncode != 0:
            print(proc.stderr[-2000:], file=sys.stderr)
            fail("scratch headless 冒烟会话失败")
        if SMOKE_PROD_MARKER not in proc.stdout:
            print(proc.stdout[-2000:], file=sys.stderr)
            fail(f"终答未见 {SMOKE_PROD_MARKER}——若报 Cannot read properties of "
                 "undefined (reading 'prepare') 即平台副本遮蔽复发")
        print(f"[smoke-prod] ✔ {linker} 布局 bash 工具调用全链路通过"
              f"（{SMOKE_PROD_MARKER}），零 API 费用")
    finally:
        shutil.rmtree(scratch, ignore_errors=True)
