"""dshctl pack / install-prod / restart-prod：生产分发链路。

铁律：生产 profile 只装 `pnpm pack` 产出的版本化 tarball，严禁 link: 依赖。
重启生产 = sudo systemctl restart <生产 web 服务>（会中断在用 GUI，需显式确认）。

防陈旧机制：vendor 内 tarball 文件名追加内容哈希（slug-version-<sha256前8位>.tgz），
内容变则 file: spec 字符串变，pnpm 必然重新解析安装——根治"同版本号、同文件名的
file: tarball 不刷新 node_modules"；安装后逐文件比对 tarball 与 node_modules 作证。

防双死机制（2026-08-30 事故教训：适配中途新旧版本错配 + lifeboat 写回失败
→ web 完全进不去）：
- 重启前自动快照 profile 配置层与 settings（~/.dsh/backups/install-prod-<ts>/）；
- 重启后健康检查（active + 端口可达 + index 应答 200/401 + journal 插件失败扫描）；
- 失败即自动回滚快照并二次重启；回滚也失败时给出明确的手工指引。
"""
from __future__ import annotations

import hashlib
import os
import shutil
import subprocess
import sys
import tarfile
import time
import urllib.error
import urllib.request
from pathlib import Path

from .common import (DIST_DIR, dsh_bin, PROD_HOME, PROD_WEB_PORT,
                     PROD_WEB_SERVICE, port_open, REPO_ROOT,
                     fail, find_package, find_platform_shadows,
                     platform_runtime_deps, read_json, run)


def _prod_profile_dir(home: Path | None = None, profile: str = "web") -> Path:
    return (home or PROD_HOME) / "profiles" / profile


def _guard_closure_no_platform_runtime_deps(closure: list[Path]) -> None:
    """闭包内任何包把平台包声明为运行时依赖 → 拒绝安装。

    平台包由 dsh 宿主提供单实例（profiles/node_modules fallback symlink 兜底），
    声明为 dependencies 会让 pnpm 把第二份副本装进 profile，hoisted 布局下顶层
    遮蔽宿主实例 → 跨实例 Symbol 错配（TOOL_RUNTIME_SCHEDULER 事故签名）。
    """
    offenders: list[str] = []
    for pkg in closure:
        meta = read_json(pkg / "package.json")
        bad = platform_runtime_deps(meta)
        if bad:
            offenders.append(f"{meta['name']}: {', '.join(bad)}")
    if offenders:
        shown = "\n".join(f"  - {o}" for o in offenders)
        fail(f"闭包含平台包运行时依赖，拒绝安装（必须改为 peerDependencies，"
             f"由 dsh 宿主提供单实例）：\n{shown}")


def _guard_no_platform_shadow(home: Path | None = None) -> None:
    """安装后兜底：profile 顶层出现平台包实体副本（含传递依赖带入）即失败。"""
    shadows = find_platform_shadows(home or PROD_HOME)
    if shadows:
        shown = "\n".join(f"  - {s}" for s in shadows)
        fail(f"生产 profile 顶层检出平台包副本（hoisted 遮蔽宿主实例，"
             f"工具调度会因跨实例 Symbol 错配必炸）：\n{shown}\n"
             "请卸载带入副本的包并将其平台依赖改为 peerDependencies")


def _guard_no_link_deps(pkg_dir: Path) -> None:
    meta = read_json(pkg_dir / "package.json")
    for section in ("dependencies", "devDependencies"):
        for dep, spec in meta.get(section, {}).items():
            if isinstance(spec, str) and spec.startswith("link:"):
                fail(f"{meta['name']} 存在 link: 依赖 {dep}，禁止打包分发")


def pack_one(pkg_dir: Path) -> Path:
    _guard_no_link_deps(pkg_dir)
    meta = read_json(pkg_dir / "package.json")
    run(["pnpm", "--filter", meta["name"], "build"], cwd=REPO_ROOT)
    DIST_DIR.mkdir(exist_ok=True)
    # pnpm pack 文件名规则：去 @、/ 转 -（@dsh-plus/x → dsh-plus-x-<ver>.tgz）
    slug = meta["name"].lstrip("@").replace("/", "-")
    tarball = DIST_DIR / f"{slug}-{meta['version']}.tgz"
    tarball.unlink(missing_ok=True)
    run(["pnpm", "--filter", meta["name"], "pack", "--pack-destination", str(DIST_DIR)],
        cwd=REPO_ROOT)
    if not tarball.exists():
        fail(f"{meta['name']} pack 未产出预期 tarball: {tarball.name}")
    print(f"[pack] {meta['name']}@{meta['version']} → {tarball}")
    return tarball


def cmd_pack(args) -> None:
    targets = [find_package(n) for n in args.packages] if args.packages else None
    if targets is None:
        from .common import package_dirs
        targets = package_dirs()
    for pkg in targets:
        pack_one(pkg)


def _prod_env() -> dict[str, str]:
    env = dict(os.environ)
    env["DSH_HOME"] = str(PROD_HOME)
    return env


def _check_prod_profile_clean() -> None:
    meta = read_json(PROD_HOME / "profiles/web/package.json")
    for dep, spec in meta.get("dependencies", {}).items():
        if isinstance(spec, str) and spec.startswith("link:"):
            fail(f"生产 profile 出现 link: 依赖 {dep}，请移除后重试")


def _confirm_restart() -> bool:
    print(f"[install-prod] 即将重启生产 {PROD_WEB_SERVICE} 服务：", file=sys.stderr)
    print("  - 正在使用的 Web GUI（含可能的本会话）会中断数秒", file=sys.stderr)
    print("  - 会话持久化于生产 home 的 sessions 目录，重启后可恢复", file=sys.stderr)
    print("  - 服务按开机自启配置自动拉起，反向代理映射无需重配", file=sys.stderr)
    answer = input(f"确认重启 {PROD_WEB_SERVICE}？[y/N] ").strip().lower()
    return answer == "y"


def _restart_prod() -> None:
    subprocess.run(["sudo", "systemctl", "restart", PROD_WEB_SERVICE], check=True)
    time.sleep(2)
    out = subprocess.run(["systemctl", "is-active", PROD_WEB_SERVICE],
                         capture_output=True, text=True).stdout.strip()
    print(f"[restart] {PROD_WEB_SERVICE}: {out}")
    if out != "active":
        fail(f"{PROD_WEB_SERVICE} 重启后未 active，"
             f"请立即 journalctl -u {PROD_WEB_SERVICE} 排查")


# ── 防双死：快照 / 健康检查 / 自动回滚 ─────────────────────────────

_SNAPSHOT_KEEP = 10
_SNAPSHOT_FILES = ("package.json", "pnpm-workspace.yaml", "cordis.yml",
                   "cordis.patch.yml")


def _snapshot_prod() -> Path:
    """重启前快照生产 profile 配置层 + settings + vendor，返回快照目录。

    快照对象是"可回滚的最小完整状态"：profile 声明文件决定 pnpm 安装结果，
    settings.yaml 决定插件配置；node_modules 由 `dsh plugin install` 依声明重建。
    """
    stamp = time.strftime("%Y%m%d-%H%M%S")
    snap = PROD_HOME / "backups" / f"install-prod-{stamp}"
    profile_dir = snap / "profiles/web"
    profile_dir.mkdir(parents=True)
    prod_profile = _prod_profile_dir()
    for name in _SNAPSHOT_FILES:
        src = prod_profile / name
        if src.exists():
            shutil.copy2(src, profile_dir / name)
    vendor = prod_profile / "vendor"
    if vendor.is_dir():
        shutil.copytree(vendor, profile_dir / "vendor")
    settings = PROD_HOME / "settings.yaml"
    if settings.exists():
        shutil.copy2(settings, snap / "settings.yaml")
    version = subprocess.run([dsh_bin(), "--version"], capture_output=True,
                             text=True, env=_prod_env())
    (snap / "dsh-version.txt").write_text(version.stdout.strip() + "\n",
                                          encoding="utf-8")
    # 滚动清理：只留最近 _SNAPSHOT_KEEP 份（定向删除具体快照目录，非通配）
    backups = sorted(PROD_HOME / "backups").glob("install-prod-*")
    for old in backups[: max(0, len(backups) - _SNAPSHOT_KEEP)]:
        if old.is_dir() and old != snap:
            shutil.rmtree(old)
    print(f"[snapshot] 生产配置层已快照 → {snap}")
    return snap


def _journal_failures(since_epoch: float) -> list[str]:
    """重启后 journal 中的插件失败/隔离行（best-effort，无权限则跳过）。"""
    since = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(since_epoch))
    try:
        proc = subprocess.run(
            ["sudo", "-n", "journalctl", "-u", PROD_WEB_SERVICE,
             "--since", since, "--no-pager"],
            capture_output=True, text=True, timeout=20)
    except (OSError, subprocess.TimeoutExpired):
        return []
    if proc.returncode != 0:
        return []
    markers = ("加载失败", "FAILED", "隔离", "shape changed", "quarantine")
    return [line for line in proc.stdout.splitlines()
            if any(m in line for m in markers)][:20]


def _health_check(since_epoch: float) -> list[str]:
    """重启后健康检查，返回问题列表（空 = 健康）。

    健康 = 服务 active + 端口监听 + index 应答 200/401（官方认证上线后
    401 即正常）。journal 中的插件加载失败单列（lifeboat 会隔离止损，
    web 仍可用，但必须醒目提示）。
    """
    problems: list[str] = []
    out = subprocess.run(["systemctl", "is-active", PROD_WEB_SERVICE],
                         capture_output=True, text=True).stdout.strip()
    if out != "active":
        problems.append(f"服务状态 {out!r}（期望 active）")
    deadline = time.time() + 30
    while not port_open(PROD_WEB_PORT) and time.time() < deadline:
        time.sleep(0.5)
    if not port_open(PROD_WEB_PORT):
        problems.append(f"端口 {PROD_WEB_PORT} 30s 内未监听")
    else:
        try:
            req = urllib.request.Request(f"http://127.0.0.1:{PROD_WEB_PORT}/",
                                         method="GET")
            urllib.request.urlopen(req, timeout=5)
        except urllib.error.HTTPError as exc:
            if exc.code not in (200, 401):
                problems.append(f"index 应答 HTTP {exc.code}（期望 200/401）")
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            problems.append(f"index 不可达: {exc}")
    failures = _journal_failures(since_epoch)
    if failures:
        print("[health] 警告：重启后 journal 检出插件失败/隔离迹象：",
              file=sys.stderr)
        for line in failures:
            print(f"  {line}", file=sys.stderr)
    return problems


def _restore_snapshot(snap: Path) -> None:
    """按快照还原 profile 声明层与 settings，并依声明重建 node_modules。"""
    prod_profile = _prod_profile_dir()
    for name in _SNAPSHOT_FILES:
        backup = snap / "profiles/web" / name
        if backup.exists():
            shutil.copy2(backup, prod_profile / name)
    vendor_backup = snap / "profiles/web/vendor"
    if vendor_backup.is_dir():
        vendor = prod_profile / "vendor"
        if vendor.exists():
            shutil.rmtree(vendor)
        shutil.copytree(vendor_backup, vendor)
    settings_backup = snap / "settings.yaml"
    if settings_backup.exists():
        shutil.copy2(settings_backup, PROD_HOME / "settings.yaml")
    run([dsh_bin(), "plugin", "--profile", "web", "install"], env=_prod_env())
    print(f"[rollback] 已从快照还原: {snap}")


def _restart_prod_guarded() -> None:
    """快照 → 重启 → 健康检查 → 失败自动回滚（再重启再检查）。"""
    snap = _snapshot_prod()
    started = time.time()
    _restart_prod()
    problems = _health_check(started)
    if not problems:
        print("[health] ✔ 重启后健康检查通过（active + 端口 + index 应答）")
        return
    print("[health] 健康检查未通过：", file=sys.stderr)
    for problem in problems:
        print(f"  - {problem}", file=sys.stderr)
    print("[rollback] 自动回滚到重启前快照…", file=sys.stderr)
    _restore_snapshot(snap)
    started = time.time()
    _restart_prod()
    remaining = _health_check(started)
    if remaining:
        fail(f"回滚后仍未恢复健康：{'; '.join(remaining)}。快照保留在 {snap}，"
             f"请人工 journalctl -u {PROD_WEB_SERVICE} 排查")
    print("[rollback] ✔ 已回滚并恢复健康；新安装未生效，问题快照保留备查")


def _workspace_dep_closure(pkg_dir: Path) -> list[Path]:
    """目标包及其 workspace:* 传递闭包对应的包目录（自内向外排序）。"""
    from .common import package_dirs
    by_name = {read_json(p / "package.json")["name"]: p for p in package_dirs()}
    ordered: list[Path] = []
    visiting = [pkg_dir]
    while visiting:
        current = visiting.pop()
        if current in ordered:
            continue
        ordered.insert(0, current)
        meta = read_json(current / "package.json")
        for dep, spec in meta.get("dependencies", {}).items():
            if spec == "workspace:*" and dep in by_name:
                visiting.append(by_name[dep])
    return ordered


def _register_bundle_in_prod(meta: dict, home: Path | None = None) -> None:
    """bundle 包（带 dsh.bundle.patch）自动登记进生产 profile 的 bundles 列表。"""
    if "bundle" not in meta.get("dsh", {}):
        return
    pkg_json = _prod_profile_dir(home) / "package.json"
    prod = read_json(pkg_json)
    bundles = prod.setdefault("dsh", {}).setdefault("profile", {}).setdefault("bundles", [])
    if meta["name"] not in bundles:
        bundles.append(meta["name"])
        from .common import write_json
        write_json(pkg_json, prod)
        print(f"[install-prod] bundle 已登记进生产 profile bundles: {meta['name']}")


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def hashed_vendor_name(tarball: Path) -> str:
    """vendor 文件名：在规范名基础上注入内容哈希（内容变则文件名变）。"""
    stem = tarball.name[: -len(".tgz")]
    return f"{stem}-{_sha256(tarball)[:8]}.tgz"


def _vendor_into_prod_profile(named: list[tuple[str, Path]],
                              home: Path | None = None,
                              profile: str = "web") -> dict[str, str]:
    """tarball 复制进生产 profile 的 vendor/，返回 {包名: file: 相对spec}。

    私有包不在 registry，单靠 pnpm add 会解析传递依赖失败；
    dependencies + pnpm.overrides 双写 file: spec 才能把闭包全部落到本地。
    同包旧 tarball 一并清理，避免 vendor 无限堆积。
    """
    profile_dir = _prod_profile_dir(home, profile)
    vendor = profile_dir / "vendor/dsh-plus"
    vendor.mkdir(parents=True, exist_ok=True)
    specs: dict[str, str] = {}
    for pkg_name, tarball in named:
        dest = vendor / hashed_vendor_name(tarball)
        slug = pkg_name.lstrip("@").replace("/", "-")
        # 版本号以数字开头，避免误伤 slug 前缀相同的兄弟包（如 shared vs shared-foo）
        for stale in vendor.glob(f"{slug}-[0-9]*.tgz"):
            if stale.name != dest.name:
                stale.unlink()
                print(f"[install-prod] 清理旧 vendor tarball: {stale.name}")
        dest.write_bytes(tarball.read_bytes())
        specs[pkg_name] = f"file:./vendor/dsh-plus/{dest.name}"
    return specs


def _apply_prod_profile_specs(specs: dict[str, str], home: Path | None = None,
                              profile: str = "web") -> None:
    from .common import write_json
    profile_dir = _prod_profile_dir(home, profile)
    pkg_json = profile_dir / "package.json"
    prod = read_json(pkg_json)
    prod.setdefault("dependencies", {}).update(specs)
    prod.setdefault("pnpm", {}).setdefault("overrides", {}).update(specs)
    write_json(pkg_json, prod)
    _ensure_release_age_exclude(profile_dir, specs)


def _ensure_release_age_exclude(profile_dir: Path, specs: dict[str, str]) -> None:
    """把已 vendor 的包同步进 pnpm-workspace.yaml（overrides + minimumReleaseAgeExclude）。

    pnpm 11 两处变化：
    1. package.json 的 `pnpm.overrides` 不再被读取（必须写进 pnpm-workspace.yaml），
       否则 bundle tarball 传递来的 semver 依赖（publish 时 workspace:* 转写而成）
       会去 registry 解析，私有包直接 404；
    2. 开启 minimumReleaseAge（本机 1440 分钟）时，发布未满龄的新包同样被拒收，
       exclude 以「包名」形式登记（不带版本，永续生效）。
    清单去重后原样保留人工维护的既有条目。
    """
    ws = profile_dir / "pnpm-workspace.yaml"
    if not ws.exists():
        return
    lines = ws.read_text(encoding="utf-8").splitlines()
    pkg_names = sorted(specs)

    existing_exclude: set[str] = set()
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("- ") and not stripped.startswith("- ."):
            existing_exclude.add(stripped[2:].strip().strip("'\""))

    missing = [name for name in pkg_names if name not in existing_exclude]
    all_exclude = sorted(existing_exclude | set(missing))
    existing_overrides = _read_workspace_overrides(lines)
    missing_overrides = {k: v for k, v in specs.items() if existing_overrides.get(k) != v}
    if not missing and not missing_overrides:
        return

    out = _rewrite_workspace_sections(lines, all_exclude, {**existing_overrides, **specs})
    ws.write_text("\n".join(out) + "\n", encoding="utf-8")
    if missing:
        print(f"[install-prod] minimumReleaseAgeExclude 已同步: {', '.join(missing)}")
    if missing_overrides:
        print(f"[install-prod] workspace overrides 已同步: "
              + ", ".join(sorted(missing_overrides)))


def _read_workspace_overrides(lines: list[str]) -> dict[str, str]:
    """读取 pnpm-workspace.yaml 的 overrides: 块（扁平 name: spec 映射）。"""
    overrides: dict[str, str] = {}
    in_block = False
    for line in lines:
        if line.startswith("overrides:"):
            in_block = True
            continue
        if in_block:
            stripped = line.strip()
            if stripped.startswith("'") or stripped.startswith('"'):
                key, _, value = stripped[1:].rpartition("': ")
                if value:
                    overrides[key.strip("'\"")] = value.strip("'\"")
                continue
            if not stripped:
                continue
            in_block = False
    return overrides


def _rewrite_workspace_sections(
    lines: list[str], all_exclude: list[str], all_overrides: dict[str, str],
) -> list[str]:
    """重建 pnpm-workspace.yaml：替换/追加 overrides 与 minimumReleaseAgeExclude 块。

    块的缩进固定两空格（列表项 `  - `，映射项 `  'name': spec`）。
    """
    out: list[str] = []
    skip_block: str | None = None

    def emit_block(header: str, entries: list[str]) -> None:
        out.append(f"{header}:")
        for entry in entries:
            out.append(f"  {entry}")

    for line in lines:
        if skip_block is not None:
            stripped = line.strip()
            if stripped.startswith("- ") or stripped.startswith("'") or stripped.startswith('"'):
                continue
            skip_block = None
            if line.strip() == "":
                continue
        if line.startswith("overrides:"):
            skip_block = "overrides"
            emit_block("overrides", [f"'{k}': '{v}'" for k, v in sorted(all_overrides.items())])
            continue
        if line.startswith("minimumReleaseAgeExclude:"):
            skip_block = "exclude"
            emit_block(
                "minimumReleaseAgeExclude",
                [f"- '{name}'" for name in all_exclude],
            )
            continue
        out.append(line)

    if not any(line.startswith("overrides:") for line in out):
        if out and out[-1].strip():
            out.append("")
        emit_block("overrides", [f"'{k}': '{v}'" for k, v in sorted(all_overrides.items())])
    if not any(line.startswith("minimumReleaseAgeExclude:") for line in out):
        if out and out[-1].strip():
            out.append("")
        emit_block("minimumReleaseAgeExclude", [f"- '{name}'" for name in all_exclude])
    return out


def _tarball_file_hashes(tarball: Path) -> dict[str, str]:
    """tarball 内常规文件的 {相对路径: sha256}（剥离 pnpm 的 package/ 前缀）。"""
    hashes: dict[str, str] = {}
    with tarfile.open(tarball) as tf:
        for member in tf.getmembers():
            if not member.isreg():
                continue
            rel = member.name[len("package/"):] if member.name.startswith("package/") \
                else member.name
            data = tf.extractfile(member).read()
            hashes[rel] = hashlib.sha256(data).hexdigest()
    return hashes


def _verify_installed(named: list[tuple[str, Path]]) -> None:
    """安装校验：tarball 内每个文件与 node_modules 实际落盘内容逐字节对哈希。

    这是"同版本号重复 install 是否真刷新"的可证验收；不一致即失败并列出差异。
    """
    nm_root = PROD_HOME / "profiles/web/node_modules"
    mismatches: list[str] = []
    for pkg_name, tarball in named:
        pkg_dir = nm_root / pkg_name
        for rel, digest in _tarball_file_hashes(tarball).items():
            target = pkg_dir / rel
            if not target.is_file() or _sha256(target) != digest:
                mismatches.append(f"{pkg_name}/{rel}")
    if mismatches:
        shown = "\n".join(f"  - {m}" for m in mismatches[:20])
        fail(f"安装校验失败：{len(mismatches)} 个文件与 tarball 不一致"
             f"（pnpm 未刷新 node_modules？请重跑 install-prod）：\n{shown}")
    print(f"[install-prod] ✔ 安装校验通过：{len(named)} 个包与 tarball 逐文件一致")


def install_one(pkg_dir: Path) -> dict:
    """vendor 安装单包（含 workspace 闭包）进生产 profile 并逐文件校验；不重启。

    返回包 meta，供调用方判断后续动作（bundle 登记、组合树提示已内含）。
    """
    meta = read_json(pkg_dir / "package.json")
    closure = _workspace_dep_closure(pkg_dir)
    _guard_closure_no_platform_runtime_deps(closure)
    named = [(read_json(p / "package.json")["name"], pack_one(p)) for p in closure]
    specs = _vendor_into_prod_profile(named)
    _apply_prod_profile_specs(specs)
    run([dsh_bin(), "plugin", "--profile", "web", "install"], env=_prod_env())
    _check_prod_profile_clean()
    _guard_no_platform_shadow()
    _verify_installed(named)
    _register_bundle_in_prod(meta)
    dump = run([dsh_bin(), "--profile", "web", "--dump-config"], env=_prod_env())
    if meta["name"] in dump.stdout:
        print(f"[install-prod] 组合树已包含 {meta['name']}")
    else:
        print(f"[install-prod] 提示: 组合树中未见 {meta['name']}，"
              "若这是 bundle 之外的插件，请确认已在 bundle patch 中 insert", file=sys.stderr)
    return meta


def cmd_install_prod_dry_run(pkg_dir: Path) -> None:
    """--dry-run：只预览闭包、将写入的 file: spec 与运行时依赖图，不写任何文件。"""
    closure = _workspace_dep_closure(pkg_dir)
    _guard_closure_no_platform_runtime_deps(closure)
    print("[dry-run] 闭包（自内向外）与运行时依赖图：")
    for pkg in closure:
        meta = read_json(pkg / "package.json")
        deps = sorted(meta.get("dependencies", {}))
        third_party = [d for d in deps if not d.startswith("@dsh-plus/")]
        print(f"  {meta['name']}@{meta['version']}"
              f"（第三方运行时依赖: {', '.join(third_party) or '无'}）")
    prod = read_json(_prod_profile_dir() / "package.json")
    existing = set(prod.get("dependencies", {}))
    names = [read_json(p / "package.json")["name"] for p in closure]
    new = [n for n in names if n not in existing]
    print(f"[dry-run] 将 vendor 安装 {len(names)} 个包"
          f"（新增: {', '.join(new) if new else '无'}），"
          "dependencies 与 pnpm.overrides 双写 file: spec（未执行）")


def cmd_install_prod(args) -> None:
    pkg_dir = find_package(args.package)
    if args.dry_run:
        cmd_install_prod_dry_run(pkg_dir)
        return
    install_one(pkg_dir)
    if args.restart:
        if _confirm_restart():
            _restart_prod_guarded()
    else:
        print("[install-prod] 安装完成。择机重启生效: python3 scripts/dshctl.py restart-prod")


def _remaining_workspace_closure(exclude: set[str]) -> set[str]:
    """生产 profile 中仍登记的 @dsh-plus/* bundle 的传递闭包（排除待卸载包）。"""
    prod = read_json(PROD_HOME / "profiles/web/package.json")
    needed: set[str] = set()
    for bundle in prod.get("dsh", {}).get("profile", {}).get("bundles", []):
        if not bundle.startswith("@dsh-plus/") or bundle in exclude:
            continue
        try:
            pkg_dir = find_package(bundle)
        except SystemExit:
            continue
        needed |= {read_json(p / "package.json")["name"]
                   for p in _workspace_dep_closure(pkg_dir)}
    return needed


def _sweep_vendor_tarballs(prod: dict) -> None:
    """删除 vendor/ 中不再被 profile dependencies / pnpm.overrides 引用的 tgz。

    覆盖两类：卸载闭包清扫后留下的孤儿、以及历史上手工移除 spec 残留的孤儿。
    """
    vendor = _prod_profile_dir() / "vendor/dsh-plus"
    if not vendor.is_dir():
        return
    referenced: set[str] = set()
    for section, key in (("dependencies", None), ("overrides", "pnpm")):
        table = prod.get(key, {}).get(section, {}) if key else prod.get(section, {})
        for spec in table.values():
            if isinstance(spec, str) and spec.startswith("file:"):
                referenced.add(Path(spec).name)
    for tgz in sorted(vendor.glob("*.tgz")):
        if tgz.name not in referenced:
            tgz.unlink()
            print(f"[uninstall-prod] 清理孤儿 vendor tarball: {tgz.name}")


def cmd_uninstall_prod(args) -> None:
    pkg_dir = find_package(args.package)
    meta = read_json(pkg_dir / "package.json")
    names = {read_json(p / "package.json")["name"] for p in _workspace_dep_closure(pkg_dir)}
    from .common import write_json
    pkg_json = PROD_HOME / "profiles/web/package.json"
    prod = read_json(pkg_json)
    bundles = prod.get("dsh", {}).get("profile", {}).get("bundles", [])
    if meta["name"] in bundles:
        bundles.remove(meta["name"])
    write_json(pkg_json, prod)
    # 清扫：卸载闭包 ∪ 不再被任何留存 bundle 需要的孤儿 vendor 依赖
    keep = _remaining_workspace_closure(names)
    sweep = names | {n for n in prod.get("dependencies", {})
                     if n.startswith("@dsh-plus/") and n not in keep}
    for section, key in (("dependencies", None), ("overrides", "pnpm")):
        table = prod.get(key, {}).get(section, {}) if key else prod.get(section, {})
        for name in sweep:
            table.pop(name, None)
    write_json(pkg_json, prod)
    _sweep_vendor_tarballs(prod)
    run([dsh_bin(), "plugin", "--profile", "web", "install"], env=_prod_env())
    dump = run([dsh_bin(), "--profile", "web", "--dump-config"], env=_prod_env())
    gone = meta["name"] not in dump.stdout
    print(f"[uninstall-prod] {meta['name']} 已移除（清扫 {len(sweep)} 项），"
          f"组合树{'已无' if gone else '仍有'}该包")
    print("[uninstall-prod] 择机重启生效: python3 scripts/dshctl.py restart-prod")


def cmd_restart_prod(_args) -> None:
    if _confirm_restart():
        _restart_prod_guarded()
    else:
        print("[restart] 已取消")
