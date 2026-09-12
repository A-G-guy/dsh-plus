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
- **存在性判定只走版本端点**（`/<name>/<version>`）：包文档端点带
  `Cache-Control: public, max-age=300`，刚发布的版本在 CDN 缓存窗口内读不到，
  据此判定会把"已发布"误判为"待发"——进而重复发布触发 EPUBLISHCONFLICT，
  或在 `doctor --release` 里误报"待发布"（2026-09-12 实测踩中）。版本端点无缓存头
  （Age 恒缺失）：200 = 已发布，404 = 未发布。文档端点仅用于展示 latest 标签，
  且加时间戳查询参数绕过缓存。
- 发布成功后轮询官方 registry 确认可见；platform-sync 的版本核验同样直连官方
  registry，不受本机镜像配置影响。
"""
from __future__ import annotations

import json
import os
import re
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from .common import (NPM_REGISTRY, REGISTRY_TIMEOUT, REPO_ROOT, _local_value, fail,
                     find_package, forget_registry_version, package_dirs, read_json,
                     run, write_json)
from .common import registry_has_version as _registry_has_version

SCOPE = "@dsh-plus/"
VERSION_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")
# 发布后可见性确认：轮询次数与间隔（官方 registry 传播通常秒级）。
PUBLISH_CONFIRM_ATTEMPTS = 6
PUBLISH_CONFIRM_INTERVAL = 2.0
# 并发度：registry 只读查询轻量放宽；真实发布（构建+上传）收敛防拥塞。
PUBLISH_QUERY_WORKERS = 8
PUBLISH_WORKERS = 4
# npm publish 对已存在版本的典型拒绝特征（同步窗口内重发/误判"未发布"）。
PUBLISH_CONFLICT_RE = re.compile(
    r"EPUBLISHCONFLICT|cannot publish over|publish over the", re.I)

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
    """读取 registry 包文档（用于展示 latest 标签）；404（从未发布）返回 None。

    **不要用本文档判定"某版本是否已发布"**：该端点带 `Cache-Control:
    public, max-age=300`，刚发布的版本在 CDN 缓存窗口内读不到（实测 Age 恒有值），
    据此判定会误判。存在性判定一律走 {@link registry_has_version}（版本端点无缓存）。
    查询自带时间戳参数，尽量绕开缓存拿到新鲜文档。
    """
    stamp = int(time.time())
    url = f"{NPM_REGISTRY}/{name.replace('/', '%2f')}?t={stamp}"
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


def registry_has_version(name: str, version: str, *, cached: bool = True) -> bool:
    """`name@version` 是否已发布——委托 common 的版本端点判定（单一事实源）。

    保留本模块同名包装：既有调用点与单测按 `cmd_release.registry_has_version`
    打桩，转发不改变可测性。cached=False 绕过进程内备忘（发布后确认可见用）。
    """
    return _registry_has_version(name, version, cached=cached)


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
    """版本对照表：已发布 / 待发布。

    "待发布"只表示本地版本尚未在 registry 可见（版本端点判定，无缓存），
    是**信息性状态而非异常**：收尾链路的正常中间态，或镜像/CDN 延迟所致。
    故不计入 doctor 失败、不打警告。
    """
    rows = []
    for pkg in publish_order(_resolve_targets(args.packages)):
        meta = read_json(pkg / "package.json")
        latest = (registry_document(meta["name"]) or {}).get(
            "dist-tags", {}).get("latest", "-")
        state = "已发布" if registry_has_version(meta["name"], meta["version"]) else "待发布"
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


def wait_published(name: str, version: str,
                   attempts: int = PUBLISH_CONFIRM_ATTEMPTS,
                   interval: float = PUBLISH_CONFIRM_INTERVAL) -> bool:
    """发布后轮询官方 registry 直到 name@version 可见（覆盖发布传播窗口）。

    用版本端点（无 CDN 缓存）判定，避免"刚发布读不到"的假阴性；返回是否在超时前
    确认可见。返回 False 不代表发布失败——npm publish 已成功，只是尚未确认可见，
    调用方据此给提示（幂等重跑即跳过），不算错误。
    """
    for _ in range(max(1, attempts)):
        # 绕过备忘：刚发布，必须看 registry 的当前答案而非发布前的旧结论。
        if registry_has_version(name, version, cached=False):
            return True
        time.sleep(interval)
    return False


def publish_one(pkg: Path, *, token: str | None = None,
                prechecked: bool = False) -> str:
    """构建并发布单包；registry 已有同版本则跳过。返回 published/skipped。

    prechecked=True 跳过发布前的 registry 查询（调用方已并发预筛，见
    publish_many），只省查询不省守门：scope/private/access 校验照常。
    """
    meta = read_json(pkg / "package.json")
    _guard_publishable(meta)
    if not prechecked and registry_has_version(meta["name"], meta["version"]):
        print(f"[release] 跳过 {meta['name']}@{meta['version']}（registry 已存在）")
        return "skipped"
    run(["pnpm", "--filter", meta["name"], "build"], cwd=REPO_ROOT)
    env = dict(os.environ)
    if token:
        env["NPM_TOKEN"] = token
    proc = run(["pnpm", "publish", "--registry", NPM_REGISTRY, "--no-git-checks"],
               cwd=pkg, env=env, check=False)
    if proc.returncode != 0:
        detail = (proc.stderr or "") + (proc.stdout or "")
        if PUBLISH_CONFLICT_RE.search(detail):
            fail(f"npm 拒绝 {meta['name']}@{meta['version']}（版本已存在）。"
                 "若刚发布过同版本，可能是 registry 同步窗口内的重复提交："
                 "重跑 dshctl 即幂等跳过，无需其他处理")
        fail(f"发布失败 {meta['name']}@{meta['version']}（exit {proc.returncode}），"
             "详见上方报错与日志")
    if wait_published(meta["name"], meta["version"]):
        print(f"[release] ✔ 已发布并确认可见 {meta['name']}@{meta['version']}")
    else:
        # 非错误：npm publish 已成功，只是官方 registry 尚未确认可见。
        print(f"[release] ✔ 已发布 {meta['name']}@{meta['version']}"
              "（registry 传播中，稍后可见；重跑 dshctl 幂等跳过）")
    # 该版本此刻起必然已存在：失效发布前的备忘，后续阶段（如 finish 的安装判定）
    # 不会读到"发布前 = 未发布"的旧结论。
    forget_registry_version(meta["name"], meta["version"])
    return "published"


def split_pending(dirs: list[Path]) -> tuple[list[Path], list[Path]]:
    """并发查询 registry，按拓扑序拆出（待发, 已发）两组。

    串行版每包一次 registry 往返是发版链路的最大耗时（十余包全量巡查时
    尤甚）；只读查询无副作用，全并发安全。
    """
    ordered = publish_order(dirs)
    metas = {d: read_json(d / "package.json") for d in ordered}

    def needs_publish(pkg: Path) -> bool:
        meta = metas[pkg]
        return not registry_has_version(meta["name"], meta["version"])

    if not ordered:
        return [], []
    with ThreadPoolExecutor(
            max_workers=min(PUBLISH_QUERY_WORKERS, len(ordered))) as pool:
        flags = list(pool.map(needs_publish, ordered))
    pending = [d for d, flag in zip(ordered, flags) if flag]
    done = [d for d, flag in zip(ordered, flags) if not flag]
    return pending, done


def publish_layers(pending: list[Path]) -> list[list[Path]]:
    """待发包按 workspace:* 依赖分层：被依赖者所在层先发，层内互不依赖可并发。"""
    by_name = {read_json(d / "package.json")["name"]: d for d in pending}
    depth: dict[str, int] = {}

    def depth_of(name: str) -> int:
        if name in depth:
            return depth[name]
        meta = read_json(by_name[name] / "package.json")
        deps = [dep for dep, spec in meta.get("dependencies", {}).items()
                if spec == "workspace:*" and dep in by_name]
        depth[name] = 0 if not deps else 1 + max(depth_of(dep) for dep in deps)
        return depth[name]

    layers: dict[int, list[Path]] = {}
    for name in sorted(by_name):
        layers.setdefault(depth_of(name), []).append(by_name[name])
    return [layers[level] for level in sorted(layers)]


def publish_many(dirs: list[Path], token: str | None = None) -> list[Path]:
    """并发发布全部待发版本；返回本次真实发布的包目录（拓扑序）。

    - 预筛（split_pending）：全部包 registry 查询并发；
    - 发布：按 workspace 依赖分层，层内并发构建+发布，层间串行等待——
      保证 registry 上依赖始终先于依赖方可解析。
    任一包失败即整体 fail（工作线程的 SystemExit 经 future 重抛到主线程）。
    """
    pending, done = split_pending(dirs)
    for pkg in done:
        meta = read_json(pkg / "package.json")
        print(f"[release] 跳过 {meta['name']}@{meta['version']}（registry 已存在）")
    published: list[Path] = []
    for layer in publish_layers(pending):
        with ThreadPoolExecutor(max_workers=min(PUBLISH_WORKERS, len(layer))) as pool:
            # map 保序且在首个异常处重抛（工作线程 SystemExit → 主线程干净退出）
            list(pool.map(lambda pkg: publish_one(pkg, token=token, prechecked=True),
                          layer))
        published.extend(layer)
    return published


def cmd_release_publish(args) -> None:
    token = guard_npm_auth()
    targets = publish_order(_resolve_targets(args.packages))
    if not args.skip_tests:
        from .cmd_doctor import cmd_test
        cmd_test(args)  # 发版守门：构建 + 全部单测（无网络、零费用）
    total = len(targets)
    published = len(publish_many(targets, token))
    print(f"[release] 完成：{published} 个发布，{total - published} 个跳过")
    if published:
        print("[release] 后续：提交并推送 git；生产更新走 "
              "install-prod <包> --restart（vendor tarball 机制不变）")
