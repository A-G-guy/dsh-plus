"""dshctl release：npm 发版链路（status / bump / publish）。

约定：
- 官方 registry 固定 https://registry.npmjs.org——查询与发布都必须显式覆盖，
  严禁发到镜像源。
- 凭据走 ~/.npmrc 的 ${NPM_TOKEN} 插值；token 自动按序解析：环境变量 →
  ~/.npmrc 字面量 _authToken → shell 环境文件中的 export NPM_TOKEN。
  额外查找文件可经 DSHCTL_TOKEN_FILES 环境变量（os.pathsep 分隔）补充。
  token 只在子进程 env 内传递，绝不打印明文。
- workspace:* 依赖在 pnpm publish 时自动落成真实版本号；多包同发按 workspace
  依赖拓扑排序（被依赖者先发），保证 registry 上依赖始终可解析。
- 幂等：registry 已存在 name@version 自动跳过，重跑安全。
"""
from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from pathlib import Path

from .common import (REPO_ROOT, _local_value, fail, find_package, package_dirs,
                     read_json, run, write_json)

NPM_REGISTRY = "https://registry.npmjs.org"
SCOPE = "@dsh-plus/"
VERSION_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")
REGISTRY_TIMEOUT = 15

# token 自动解析的 shell 环境文件查找链（按序，首个命中即止）；
# 额外文件经 DSHCTL_TOKEN_FILES（os.pathsep 分隔）或 local_config.EXTRA_TOKEN_FILES 补充。
TOKEN_ENV_FILES = (
    "~/.zshenv",
    "~/.zshrc",
    "~/.bashrc",
    "~/.profile",
)
_NPMRC_TOKEN_RE = re.compile(
    r"^//registry\.npmjs\.org/:_authToken\s*=\s*(\S+)\s*$", re.MULTILINE)
_EXPORT_TOKEN_RE = re.compile(
    r"^\s*export\s+NPM_TOKEN\s*=\s*[\"']?([^\"'\s]+)[\"']?\s*$", re.MULTILINE)


def _literal_token(text: str, pattern: re.Pattern[str]) -> str | None:
    """从文本提取 token；${...} 插值占位一律跳过。"""
    match = pattern.search(text)
    if not match:
        return None
    value = match.group(1)
    return None if value.startswith("${") else value


def _extra_token_files() -> list[str]:
    """环境变量与本地覆盖补充的额外查找文件。"""
    extras = os.environ.get("DSHCTL_TOKEN_FILES", "")
    files = [p for p in extras.split(os.pathsep) if p]
    local = _local_value("EXTRA_TOKEN_FILES")
    if local:
        files.append(local)
    return files


def resolve_npm_token(home: Path | None = None,
                      extra_files: list[str] | None = None) -> tuple[str, str] | None:
    """解析 npm token，返回 (token, 来源描述)；找不到返回 None。绝不打印 token。"""
    token = os.environ.get("NPM_TOKEN")
    if token:
        return token, "环境变量 NPM_TOKEN"
    base = home or Path.home()
    npmrc = base / ".npmrc"
    if npmrc.exists():
        found = _literal_token(npmrc.read_text(encoding="utf-8"), _NPMRC_TOKEN_RE)
        if found:
            return found, str(npmrc)
    chain = [*(extra_files if extra_files is not None else _extra_token_files()),
             *TOKEN_ENV_FILES]
    for rel in chain:
        path = Path(rel.replace("~", str(base), 1)).expanduser()
        if not path.exists():
            continue
        found = _literal_token(path.read_text(encoding="utf-8"), _EXPORT_TOKEN_RE)
        if found:
            return found, str(path)
    return None


def bump_version(current: str, spec: str) -> str:
    """patch/minor/major 递增或显式 x.y.z；显式版本必须大于当前版本。"""
    match = VERSION_RE.match(current)
    if not match:
        fail(f"当前版本号非法: {current}")
    base = tuple(int(x) for x in match.groups())
    if spec == "patch":
        return f"{base[0]}.{base[1]}.{base[2] + 1}"
    if spec == "minor":
        return f"{base[0]}.{base[1] + 1}.0"
    if spec == "major":
        return f"{base[0] + 1}.0.0"
    target = VERSION_RE.match(spec)
    if not target:
        fail(f"版本规格非法: {spec}（patch/minor/major 或 x.y.z）")
    if tuple(int(x) for x in target.groups()) <= base:
        fail(f"显式版本 {spec} 必须大于当前版本 {current}")
    return spec


def registry_document(name: str) -> dict | None:
    """读取 registry 包文档；404（从未发布）返回 None。"""
    url = f"{NPM_REGISTRY}/{name.replace('/', '%2f')}"
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=REGISTRY_TIMEOUT) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return None
        fail(f"registry 查询失败 {name}: HTTP {exc.code}")
    except urllib.error.URLError as exc:
        fail(f"registry 不可达: {exc.reason}（需要代理时先 export HTTPS_PROXY）")
    return None


def published_versions(doc: dict | None) -> set[str]:
    """从 registry 文档提取已发版本集合；None（未发布）为空集。"""
    if not doc:
        return set()
    return set(doc.get("versions", {}))


def publish_order(dirs: list[Path]) -> list[Path]:
    """按 workspace:* 依赖拓扑排序（被依赖者在前）；成环即报错。"""
    selected = {read_json(d / "package.json")["name"]: d for d in dirs}
    ordered: list[str] = []
    state: dict[str, int] = {}  # 1=访问中 2=已完成

    def visit(name: str) -> None:
        if state.get(name) == 2:
            return
        if state.get(name) == 1:
            fail(f"workspace 依赖成环: {name}")
        state[name] = 1
        meta = read_json(selected[name] / "package.json")
        for dep, spec in meta.get("dependencies", {}).items():
            if spec == "workspace:*" and dep in selected:
                visit(dep)
        state[name] = 2
        ordered.append(name)

    for name in sorted(selected):
        visit(name)
    return [selected[n] for n in ordered]


def _resolve_targets(names: list[str]) -> list[Path]:
    return [find_package(n) for n in names] if names else package_dirs()


def cmd_release_status(args) -> None:
    rows = []
    for pkg in publish_order(_resolve_targets(args.packages)):
        meta = read_json(pkg / "package.json")
        doc = registry_document(meta["name"])
        latest = (doc or {}).get("dist-tags", {}).get("latest", "-")
        if doc is None:
            state = "首发待发"
        elif meta["version"] in published_versions(doc):
            state = "已发布"
        else:
            state = "待发布"
        rows.append((meta["name"], meta["version"], latest, state))
    width = max(len(r[0]) for r in rows)
    for name, local, latest, state in rows:
        print(f"{name:<{width}}  本地 {local:<8}  npm {latest:<8}  {state}")


def cmd_release_bump(args) -> None:
    pkg_json = find_package(args.package) / "package.json"
    meta = read_json(pkg_json)
    meta["version"] = bump_version(meta["version"], args.spec)
    write_json(pkg_json, meta)
    print(f"[release] {meta['name']} → {meta['version']}"
          "（提交 git 后 release publish 生效）")


def _guard_publishable(meta: dict) -> None:
    name = meta.get("name", "")
    if not name.startswith(SCOPE):
        fail(f"{name} 不在 {SCOPE} scope 下，拒绝发布")
    if meta.get("private"):
        fail(f"{name} 标记 private，拒绝发布")
    if meta.get("publishConfig", {}).get("access") != "public":
        fail(f"{name} 缺少 publishConfig.access=public")


def guard_npm_auth() -> str:
    """解析并返回 npm token；找不到则 fail（只列查找链，不含任何 token 内容）。"""
    resolved = resolve_npm_token()
    if resolved is None:
        fail("未找到 npm token。查找链：环境变量 NPM_TOKEN → ~/.npmrc 字面量 "
             "_authToken → shell 环境文件 export NPM_TOKEN（"
             + "、".join(TOKEN_ENV_FILES)
             + "；额外文件用 DSHCTL_TOKEN_FILES 补充）")
    token, source = resolved
    print(f"[release] npm token 已就绪（来源: {source}，不明文显示）")
    return token


def publish_one(pkg: Path, *, token: str | None = None) -> str:
    """构建并发布单包；registry 已有同版本则跳过。返回 published/skipped。"""
    meta = read_json(pkg / "package.json")
    _guard_publishable(meta)
    if meta["version"] in published_versions(registry_document(meta["name"])):
        print(f"[release] 跳过 {meta['name']}@{meta['version']}（registry 已存在）")
        return "skipped"
    run(["pnpm", "--filter", meta["name"], "build"], cwd=REPO_ROOT)
    env = dict(os.environ)
    if token:
        env["NPM_TOKEN"] = token
    run(["pnpm", "publish", "--registry", NPM_REGISTRY, "--no-git-checks"],
        cwd=pkg, env=env)
    print(f"[release] ✔ 已发布 {meta['name']}@{meta['version']}")
    return "published"


def cmd_release_publish(args) -> None:
    token = guard_npm_auth()
    targets = publish_order(_resolve_targets(args.packages))
    if not args.skip_tests:
        from .cmd_doctor import cmd_test
        cmd_test(args)  # 发版守门：构建 + 全部单测（无网络、零费用）
    results = [publish_one(p, token=token) for p in targets]
    published = results.count("published")
    print(f"[release] 完成：{published} 个发布，{results.count('skipped')} 个跳过")
    if published:
        print("[release] 后续：提交并推送 git；生产更新走 "
              "install-prod <包> --restart（vendor tarball 机制不变）")
