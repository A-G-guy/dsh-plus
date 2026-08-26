"""dshctl finish：开发收尾一条龙（测试 → bump → 提交 → push → npm 发布 → 本机安装）。

链路（全部复用既有能力，仅做串联；每步均可经开关跳过）：
  1. test       biome 静态检查 + 构建 + 全部单测（cmd_doctor.cmd_test，无网络、零 API 费用）
  2. bump       有改动且本地版本已上 npm 的包自动递增（cmd_release.bump_version）；
                本地版本尚未发布的包保持原版本，publish 阶段直接首发。
                目标包 = 显式指定或工作区改动，并级联 client 半静态打苞这些
                包的插件（bundle 内嵌依赖源码，不重发则线上仍是旧 bundle）
  3. commit     git add -A + Conventional Commits 提交（pre-commit 链照常生效）
  4. push       git push origin HEAD
  5. publish    cmd_release.publish_one 按依赖拓扑序发 npm，已发版本幂等跳过
  6. install    cmd_pack.install_one 把目标包（∪ 本次发布包）vendor 装进生产 profile

铁律：重启不在收尾链路内——dsh-web 重启会中断在用 GUI，必须用户显式确认后
另行执行 restart-prod。

bump 决策需要只读查询 npm registry；--no-publish 仅跳过发布步骤本身。
顺利时输出精简为每步一行；失败细节由 output.run_logged 原样展开。
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

from . import cmd_release
from .cmd_doctor import cmd_test
from .common import (REPO_ROOT, fail, find_package, package_dirs, read_json,
                     run, write_json)

COMMIT_RE = re.compile(
    r"^(feat|fix|docs|style|refactor|test|chore)(\([\w./-]+\))?!?: .+")


def valid_commit_message(message: str) -> bool:
    """首行必须符合 Conventional Commits（类型白名单 + 非空描述）。"""
    first = message.splitlines()[0].strip() if message.splitlines() else ""
    return bool(COMMIT_RE.match(first))


def dirty_package_dirs(porcelain: str) -> list[str]:
    """从 git status --porcelain 输出提取有改动的包目录名（去重排序）。"""
    names: set[str] = set()
    for line in porcelain.splitlines():
        path = line[3:].split(" -> ")[-1].strip('"') if len(line) > 3 else ""
        parts = Path(path).parts
        if len(parts) >= 2 and parts[0] == "packages":
            names.add(parts[1])
    return sorted(names)


QUOTED_SPEC_RE = re.compile(r"['\"]([^'\"]+)['\"]")
TSDOWN_ENTRY_RE = re.compile(r"entry:\s*['\"]([^'\"]*client[^'\"]*)['\"]")
CLIENT_ENTRY_FALLBACKS = ("src/client.tsx", "src/client.ts", "src/client/index.tsx",
                          "src/client/index.ts", "src/client/client.ts",
                          "src/client/client.tsx")


def _resolve_source(base: Path) -> Path | None:
    """解析源码路径（兼容带/不带扩展名、目录 index 与 .js→.ts/.tsx 换名）。"""
    candidates = [base, Path(f"{base}.ts"), Path(f"{base}.tsx"),
                  base / "index.ts", base / "index.tsx"]
    if base.suffix in (".js", ".jsx", ".mjs", ".cjs"):
        candidates += [base.with_suffix(".ts"), base.with_suffix(".tsx")]
    return next((c for c in candidates if c.is_file()), None)


def _client_entry(pkg_dir: Path) -> Path | None:
    """定位 client bundle 入口源码：exports 声明 ./client 为前提，入口路径优先
    取 tsdown.config.ts 中 client 构建的 entry，缺失时回退常见布局。"""
    pkg_json = pkg_dir / "package.json"
    if not pkg_json.is_file():
        return None
    if "./client" not in read_json(pkg_json).get("exports", {}):
        return None
    candidates: list[str] = []
    config = pkg_dir / "tsdown.config.ts"
    if config.is_file():
        text = config.read_text(encoding="utf-8", errors="ignore")
        candidates += TSDOWN_ENTRY_RE.findall(text)
    candidates += CLIENT_ENTRY_FALLBACKS
    for rel in candidates:
        found = _resolve_source(pkg_dir / rel)
        if found is not None:
            return found
    return None


def client_embeds(pkg_dir: Path, dep_name: str) -> bool:
    """pkg 的 client bundle（入口模块引用闭包）是否源码引用 dep_name。

    client bundle 构建时把 workspace 依赖源码打进自身产物；node 半经
    overrides 运行时解析，不计入（避免仅 node 依赖触发无谓级联）。
    闭包按全部带引号的字面量识别（覆盖 import/require 及 lifeboat 的
    `(require as ...)('./x.js')` 隔离惯用法）；误命中仅多走一步不可解析
    即弃，不影响结论。
    """
    entry = _client_entry(pkg_dir)
    if entry is None:
        return False
    seen: set[Path] = set()
    stack = [entry]
    while stack:
        path = stack.pop()
        if path in seen:
            continue
        seen.add(path)
        text = path.read_text(encoding="utf-8", errors="ignore")
        for spec in QUOTED_SPEC_RE.findall(text):
            if spec == dep_name or spec.startswith(f"{dep_name}/"):
                return True
            if spec.startswith("."):
                nxt = _resolve_source(path.parent / spec)
                if nxt is not None and nxt not in seen:
                    stack.append(nxt)
    return False


def cascade_client_dependents(dirty: list[str], dirs: list[Path]) -> list[str]:
    """级联扩展：client 半静态打苞了 dirty 包的插件一并纳入（递归，排序去重）。

    client bundle 构建时把 workspace 依赖源码打进自身产物；被依赖方（如
    shared）变更后若不重发重装这些插件，线上仍服务旧 bundle（?rev= 内容
    哈希不变），出现「有的变了有的没变」。node 半经 overrides 运行时解析，
    无需级联。
    """
    by_dir: dict[str, Path] = {d.name: d for d in dirs}
    names = {d.name: read_json(d / "package.json").get("name", d.name)
             for d in dirs if (d / "package.json").is_file()}
    expanded = set(dirty)
    queue = [names[n] for n in dirty if n in names]
    processed: set[str] = set()
    while queue:
        dep = queue.pop()
        if dep in processed:
            continue
        processed.add(dep)
        for dirname, pkg_name in names.items():
            if dirname not in expanded and client_embeds(by_dir[dirname], dep):
                expanded.add(dirname)
                queue.append(pkg_name)
    return sorted(expanded)


def plan_bumps(metas: list[dict], spec: str, is_published) -> list[tuple[str, str, str]]:
    """bump 计划：仅当本地版本已上 npm（再发必须递增）才递增。返回 (name, 旧, 新)。"""
    plan = []
    for meta in metas:
        if is_published(meta["name"], meta["version"]):
            plan.append((meta["name"], meta["version"],
                         cmd_release.bump_version(meta["version"], spec)))
    return plan


def install_targets(targets: list[Path], published: list[Path]) -> list[Path]:
    """本机安装目标：显式/脏包 ∪ 本次发布包，按目录去重保序。"""
    seen: set[Path] = set()
    ordered: list[Path] = []
    for d in [*targets, *published]:
        if d not in seen:
            seen.add(d)
            ordered.append(d)
    return ordered


def _git(args: list[str], check: bool = True,
         fail_banner: bool = True) -> subprocess.CompletedProcess[str]:
    return run(["git", *args], cwd=REPO_ROOT, check=check, fail_banner=fail_banner)


def _is_published(name: str, version: str) -> bool:
    return version in cmd_release.published_versions(cmd_release.registry_document(name))


def _target_dirs(packages: list[str]) -> list[Path]:
    """目标包目录：显式指定或工作区改动，并级联 client 半打苞依赖方。"""
    if packages:
        dirs = [find_package(n) for n in packages]
        dirty = [d.name for d in dirs]
    else:
        proc = _git(["status", "--porcelain", "--", "packages/"])
        dirty = dirty_package_dirs(proc.stdout)
        dirs = [REPO_ROOT / "packages" / n for n in dirty]
    by_name = {d.name: d for d in package_dirs()}
    expanded = cascade_client_dependents(dirty, package_dirs())
    extra = [n for n in expanded if n not in dirty and n in by_name]
    if extra:
        print("[finish] 级联纳入 client 打苞依赖方: " + ", ".join(extra))
    return [*dirs, *[by_name[n] for n in extra]]


def _apply_bumps(plan: list[tuple[str, str, str]]) -> None:
    for name, old, new in plan:
        pkg_json = find_package(name) / "package.json"
        meta = read_json(pkg_json)
        meta["version"] = new
        write_json(pkg_json, meta)
    if plan:
        print("[finish] bump: " + ", ".join(f"{n} {o} → {v}" for n, o, v in plan))


def _resolve_message(message: str | None) -> str:
    msg = message or (input("[finish] 提交信息（如 'feat: xxx'）: ").strip()
                      if sys.stdin.isatty() else "")
    if not msg:
        fail("缺少提交信息：用 -m 提供，或在交互终端中输入")
    if not valid_commit_message(msg):
        fail(f"提交信息不符合 Conventional Commits: {msg!r}"
             "（类型限 feat/fix/docs/style/refactor/test/chore，格式 '<type>: <描述>'）")
    return msg


def _step_bump(args, targets: list[Path]) -> list[tuple[str, str, str]]:
    if args.no_bump or not targets:
        return []
    metas = [read_json(d / "package.json") for d in targets]
    plan = plan_bumps(metas, args.bump, _is_published)
    _apply_bumps(plan)
    return plan


def _step_commit(args, plan: list[tuple[str, str, str]]) -> None:
    _git(["add", "-A"])
    if _git(["diff", "--cached", "--quiet"], check=False,
            fail_banner=False).returncode == 0:
        print("[finish] 工作区无改动，跳过提交")
        return
    message = _resolve_message(args.message)
    if plan:
        message += "\n\n" + "\n".join(f"- bump {n} {o} → {v}" for n, o, v in plan)
    _git(["commit", "-m", message])


def _step_publish() -> list[Path]:
    """按拓扑序发布全部待发版本；返回本次真实发布的包目录。"""
    token = cmd_release.guard_npm_auth()
    published: list[Path] = []
    skipped = 0
    for pkg in cmd_release.publish_order(package_dirs()):
        if cmd_release.publish_one(pkg, token=token) == "published":
            published.append(pkg)
        else:
            skipped += 1
    print(f"[finish] npm 发布完成：{len(published)} 个发布，{skipped} 个跳过")
    return published


def _step_install(targets: list[Path], published: list[Path]) -> None:
    from .cmd_pack import install_one
    for pkg in install_targets(targets, published):
        install_one(pkg)
    if targets or published:
        print("[finish] 本机安装完成。重启不在收尾链路内，确认后另行执行: "
              "python3 scripts/dshctl.py restart-prod")


def cmd_finish(args) -> None:
    if not args.skip_tests:
        cmd_test(args)
    targets = _target_dirs(args.packages)
    plan = _step_bump(args, targets)
    if not args.no_commit:
        _step_commit(args, plan)
    if not args.no_push:
        _git(["push", "origin", "HEAD"])
    published = _step_publish() if not args.no_publish else []
    if not args.no_install:
        _step_install(targets, published)
    print("[finish] 收尾完成 ✔")
