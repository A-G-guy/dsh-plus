"""dshctl doctor / test：环境体检与单元测试。"""
from __future__ import annotations

import shutil
import subprocess
import sys

from .common import (DEV_HOME, DEV_PORT, DEV_RUN_DIR, DSH_BIN, MOCK_PORT,
                     PROD_HOME, PROD_PORTS, REPO_ROOT, TS_HOOK_REPO,
                     find_platform_shadows, package_dirs, read_json, run,
                     yaml_scalar)

CHECKS: list[tuple[str, bool, str]] = []


def _check(label: str, ok: bool, hint: str = "") -> None:
    CHECKS.append((label, ok, hint))


def _check_toolchain() -> None:
    _check("node >= 22", _node_major() >= 22, "升级 node")
    _check("pnpm 可用", shutil.which("pnpm") is not None,
           "PATH 需包含 pnpm")
    _check("dsh CLI 可用", DSH_BIN is not None and DSH_BIN.exists(),
           "把 dsh 加入 PATH，或设置 DSHCTL_DSH_BIN")
    if TS_HOOK_REPO is not None:
        _check("md-doc-timestamp-hook 仓库在位", (TS_HOOK_REPO / "src").is_dir(),
               f"DSHCTL_TS_HOOK_REPO 指向无效路径: {TS_HOOK_REPO}")
    _check("biome 配置与可执行在位",
           (REPO_ROOT / "biome.json").exists()
           and (REPO_ROOT / "node_modules/.bin/biome").exists(),
           "缺 biome.json 或 node_modules/.bin/biome（pnpm install）")


def _node_major() -> int:
    try:
        out = subprocess.run(["node", "--version"], capture_output=True, text=True)
        return int(out.stdout.strip().lstrip("v").split(".")[0])
    except (OSError, ValueError):
        return 0


def _check_hooks() -> None:
    hooks = REPO_ROOT / "scripts" / "git-hooks" / "pre-commit"
    _check("pre-commit hook 已安装", hooks.exists(), "运行 dshctl.py init-hooks")
    if TS_HOOK_REPO is None:
        return  # 文档时间戳链为可选外部工具，未配置不检查
    cfg = REPO_ROOT / ".md-doc-timestamp.json"
    if not cfg.exists():
        _check(".md-doc-timestamp.json 存在", False, "运行 dshctl.py init-hooks")
        return
    missing = [r for r in read_json(cfg).get("doc_roots", [])
               if not any(REPO_ROOT.glob(r)) ]
    _check("doc_roots 均有匹配", not missing, f"无匹配: {missing}")


def _check_packages() -> None:
    for pkg in package_dirs():
        meta = read_json(pkg / "package.json")
        label = f"包 {meta['name']} 可独立分发"
        ok = bool(meta.get("version")) and "files" in meta
        link_deps = [d for s in ("dependencies", "devDependencies")
                     for d, spec in meta.get(s, {}).items()
                     if isinstance(spec, str) and spec.startswith("link:")]
        _check(label, ok and not link_deps, f"link: 依赖 {link_deps}" if link_deps else "")


def _check_isolation() -> None:
    _check("dev home 已初始化", (DEV_HOME / "profiles/web/package.json").exists(),
           "运行 dshctl.py dev init")
    settings = DEV_HOME / "settings.yaml"
    if settings.exists():
        text = settings.read_text(encoding="utf-8")
        _check("dev settings 仅指向 mock", "127.0.0.1" in text
               and "miniserver" not in text,
               f"检查 {settings} 不得含真实网关")
    _check("dev 端口规划", DEV_PORT not in PROD_PORTS and MOCK_PORT not in PROD_PORTS,
           f"dev/mock 端口不得占用生产端口 {PROD_PORTS}")


def _check_prod_vendor() -> None:
    """生产 profile 中 file: spec 指向的 vendor tarball 必须真实存在。"""
    pkg_json = PROD_HOME / "profiles/web/package.json"
    if not pkg_json.exists():
        _check("生产 profile 存在", False, str(pkg_json))
        return
    meta = read_json(pkg_json)
    missing = []
    for section, key in (("dependencies", None), ("overrides", "pnpm")):
        table = meta.get(key, {}).get(section, {}) if key else meta.get(section, {})
        for dep, spec in table.items():
            if isinstance(spec, str) and spec.startswith("file:"):
                if not (pkg_json.parent / spec[len("file:"):]).exists():
                    missing.append(dep)
    _check("生产 vendor file: spec 文件均存在", not missing, f"缺失: {missing}")


def _check_prod_platform_shadow() -> None:
    """生产 profile 顶层不得有平台包实体副本（hoisted 遮蔽宿主实例 → Symbol 错配）。"""
    shadows = find_platform_shadows(PROD_HOME)
    _check("生产 profile 无平台包顶层遮蔽", not shadows,
           f"检出 {len(shadows)} 个副本: {', '.join(shadows[:8])}"
           "——将带入包的平台依赖改为 peerDependencies 后重装")


def _check_prod_layout() -> None:
    """生产 profile pnpm-workspace.yaml：跟随 dsh 模板默认 + 不自动装 peer。

    hoisted 是 dsh 模板默认（留在上游测试路径上），且顶层提升让遮蔽可被
    find_platform_shadows 检出；isolated 会把副本藏进 .pnpm 逃过顶层扫描，
    反而造成静默坏。真正防线是 peer 化 + install 守卫，见 docs/repo/adr/0001。
    """
    ws = PROD_HOME / "profiles/web/pnpm-workspace.yaml"
    if not ws.exists():
        _check("生产 pnpm-workspace.yaml 存在", False, str(ws))
        return
    text = ws.read_text(encoding="utf-8")
    linker = yaml_scalar(text, "nodeLinker")
    _check("生产 nodeLinker 跟随 dsh 模板默认（hoisted）", linker == "hoisted",
           f"当前 {linker}，见 docs/repo/adr/0001")
    _check("生产 autoInstallPeers=false（不自动装 peer 副本）",
           yaml_scalar(text, "autoInstallPeers") == "false",
           "置为 false，让平台 peer 走 profiles/node_modules fallback 单实例")


def cmd_doctor(args) -> None:
    CHECKS.clear()
    _check_toolchain()
    _check_hooks()
    _check_packages()
    _check_isolation()
    _check_prod_vendor()
    _check_prod_platform_shadow()
    _check_prod_layout()
    failed = 0
    for label, ok, hint in CHECKS:
        mark = "✔" if ok else "✖"
        print(f"{mark} {label}" + (f" —— {hint}" if hint and not ok else ""))
        failed += 0 if ok else 1
    print(f"\n[doctor] {len(CHECKS) - failed}/{len(CHECKS)} 项通过")
    if getattr(args, "release", False):
        from . import cmd_release
        print("\n[doctor] release status 对照（npm registry 查询）：")
        cmd_release.cmd_release_status(type("A", (), {"packages": []})())
    if failed:
        sys.exit(1)


def cmd_test(_args) -> None:
    from .cmd_lint import biome_check_cmd

    run(biome_check_cmd(), cwd=REPO_ROOT)
    print("[test] biome check 通过（lint + format + import 整理）")
    run(["pnpm", "-r", "build"], cwd=REPO_ROOT)
    tests = sorted(REPO_ROOT.glob("packages/*/tests/*.test.ts"))
    if tests:
        run(["node", "--test", *[str(t) for t in tests]], cwd=REPO_ROOT)
        print(f"[test] {len(tests)} 个 TS 测试文件全部通过（纯逻辑，无网络）")
    else:
        print("[test] 未发现 TS 测试文件")
    py_tests = REPO_ROOT / "scripts/tests"
    if any(py_tests.glob("test_*.py")):
        run(["python3", "-m", "unittest", "discover", "-s", "scripts/tests",
             "-t", "scripts"], cwd=REPO_ROOT)
        print("[test] Python 单元测试全部通过（dshctl 纯逻辑，无网络）")
