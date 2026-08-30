"""dshctl platform-sync：同步本机 dsh 平台包 tarball 缓存并刷新 .pnpmfile.cjs 映射。

背景：dsh 0.1.2-alpha.1 尚未发布 npm。插件的 @deepseek-ai/* 依赖（含 tarball
peer 传递闭包）必须解析到本机从源码构建的 tarball（官方 release:pack 产物）。
pnpm overrides 无法覆盖 tarball 的 peerDependencies（实测 pnpm 11.7），
故采用 .pnpmfile.cjs 的 readPackage 钩子重写全部 @deepseek-ai/* 引用。

本命令把「平台 tarball 事实源」收敛为单一缓存目录：
  1. 从 master 构建树（默认 ~/workspace/repos/deepseek-harness/dist/npm，
     可用 DSHCTL_PLATFORM_SOURCES 冒号分隔覆盖）同步 tarball 进缓存
     （默认 ~/.cache/dsh-plus/platform/<版本>/，DSHCTL_PLATFORM_CACHE 覆盖）；
  2. 把 .pnpmfile.cjs 中标记块内的 TARBALLS 映射重写为缓存现状；
     标记块外的钩子逻辑保留，重复执行幂等。

官方版本发布 npm 后：删除 .pnpmfile.cjs 即可回到 registry 解析。
"""
from __future__ import annotations

import json
import os
import re
import shutil
import tarfile
import tempfile
from pathlib import Path

from .common import PLATFORM_SCOPE, REPO_ROOT, fail, read_json

MARK_BEGIN = "// >>> dshctl platform-sync（自动生成，勿手改）"
MARK_END = "// <<< dshctl platform-sync"

PLATFORM_TARBALL_RE = re.compile(r"^deepseek-ai-(.+)-(\d+\.\d+\.\d+.*)\.tgz$")

PNPMFILE_TEMPLATE = """// .pnpmfile.cjs：把 @deepseek-ai/* 依赖（含 tarball peer 闭包）重写到本机平台 tarball。
// 由 dshctl platform-sync 生成/刷新；dsh 正式版发布 npm 后删除本文件即可。

__MARK_BEGIN__
const PLATFORM_CACHE = __CACHE_DIR__
const TARBALLS = __TARBALLS__
__MARK_END__

function rewrite(section) {
  if (!section) return
  for (const name of Object.keys(section)) {
    const tarball = TARBALLS[name]
    if (tarball && !String(section[name]).startsWith('file:')) {
      section[name] = `file:${PLATFORM_CACHE}/${tarball}`
    }
  }
}

module.exports = {
  hooks: {
    readPackage(pkg) {
      rewrite(pkg.dependencies)
      rewrite(pkg.devDependencies)
      rewrite(pkg.optionalDependencies)
      // workspace 项目（@dsh-plus/*）的 peerDependencies 必须保持 semver range
      //（pnpm 校验不接受 file:），其实例由 devDependencies 的 file: 重写提供。
      // 平台 tarball：peer 重写为 file: 不够（pnpm 不自动安装 file: peer，会缺实例），
      // 需同步下沉为 dependencies——同一 file: spec 指向同一 tarball，pnpm 天然去重，
      // 不会产生第二份实例。
      if (pkg.name && !pkg.name.startsWith('@dsh-plus/')) {
        rewrite(pkg.peerDependencies)
        for (const [name, spec] of Object.entries(pkg.peerDependencies || {})) {
          if (TARBALLS[name] && String(spec).startsWith('file:')) {
            pkg.dependencies = pkg.dependencies || {}
            if (!pkg.dependencies[name]) pkg.dependencies[name] = spec
          }
        }
      }
      return pkg
    },
  },
}
"""


def _default_source() -> Path:
    return Path.home() / "workspace/repos/deepseek-harness/dist/npm"


def _source_dirs() -> list[Path]:
    raw = os.environ.get("DSHCTL_PLATFORM_SOURCES")
    if raw:
        return [Path(p) for p in raw.split(":") if p]
    return [_default_source()]


def _cache_root() -> Path:
    override = os.environ.get("DSHCTL_PLATFORM_CACHE")
    if override:
        return Path(override)
    return Path.home() / ".cache/dsh-plus/platform"


def _tarball_meta(tarball: Path) -> tuple[str, str]:
    """读取 tarball 内 package/package.json 的 (name, version)。"""
    with tarfile.open(tarball) as tf:
        names = tf.getnames()
        if "package/package.json" not in names:
            fail(f"{tarball.name} 缺少 package/package.json")
        member = tf.extractfile("package/package.json")
        meta = json.loads(member.read().decode("utf-8"))  # type: ignore[union-attr]
    return meta["name"], meta["version"]


def _collect_sources(sources: list[Path]) -> dict[str, Path]:
    """源目录中全部平台 tarball：包名 → 源路径。"""
    found: dict[str, Path] = {}
    for src in sources:
        if not src.is_dir():
            continue
        for tgz in sorted(src.glob("*.tgz")):
            name, _version = _tarball_meta(tgz)
            found[name] = tgz
    return found


def _platform_version(cache_root: Path, source_map: dict[str, Path]) -> str:
    """平台版本 = dsh 主包 tarball 的版本号（缓存优先，其次源目录）。"""
    for cached in cache_root.glob("*/deepseek-ai-dsh-*.tgz"):
        match = PLATFORM_TARBALL_RE.match(cached.name)
        if match and match.group(1) == "dsh":
            return match.group(2)
    if "@deepseek-ai/dsh" in source_map:
        return _tarball_meta(source_map["@deepseek-ai/dsh"])[1]
    fail("无法确定平台版本：缓存与源目录都没有 deepseek-ai-dsh-*.tgz")


def _sync_cache(source_map: dict[str, Path], cache: Path) -> tuple[int, int]:
    """把源 tarball 同步进缓存（新增/更新），返回 (新增更新数, 缓存总数)。

    先拷到临时文件再原子替换目标；缓存中源目录没有的条目保留
    （构建树可能只 pack 了部分 family，缓存才是全量事实源）。
    """
    cache.mkdir(parents=True, exist_ok=True)
    updated = 0
    for src in source_map.values():
        target = cache / src.name
        if target.exists() and target.stat().st_size == src.stat().st_size:
            continue
        with tempfile.NamedTemporaryFile(dir=cache, delete=False) as tmp:
            shutil.copyfileobj(src.open("rb"), tmp)
        Path(tmp.name).replace(target)
        updated += 1
    return updated, len(list(cache.glob("*.tgz")))


def _used_platform_packages() -> list[str]:
    """packages/*/package.json 的 peer/dev/dependencies 中实际用到的平台包（缺失自检用）。"""
    used: set[str] = set()
    for manifest in sorted(REPO_ROOT.glob("packages/*/package.json")):
        meta = read_json(manifest)
        for section in ("dependencies", "peerDependencies", "devDependencies"):
            for dep in meta.get(section, {}):
                if dep.startswith(PLATFORM_SCOPE):
                    used.add(dep)
    return sorted(used)


def _cache_tarballs(cache: Path) -> dict[str, str]:
    """缓存中全部 tarball：包名 → 文件名。"""
    result: dict[str, str] = {}
    for tgz in sorted(cache.glob("*.tgz")):
        name, _version = _tarball_meta(tgz)
        result[name] = tgz.name
    return result


def _write_pnpmfile(cache: Path, tarballs: dict[str, str]) -> None:
    path = REPO_ROOT / ".pnpmfile.cjs"
    # 生成物必须 biome 格式稳定（单引号），否则 lint 门禁反复报格式差异
    block_json = "{\n" + "".join(
        f"  '{name}': '{filename}',\n" for name, filename in tarballs.items()) + "}"
    cache_js = f"'{cache}'"
    if not path.exists():
        content = (PNPMFILE_TEMPLATE
                   .replace("__MARK_BEGIN__", MARK_BEGIN)
                   .replace("__MARK_END__", MARK_END)
                   .replace("__CACHE_DIR__", cache_js)
                   .replace("__TARBALLS__", block_json))
        path.write_text(content, encoding="utf-8")
        return
    text = path.read_text(encoding="utf-8")
    pattern = re.compile(re.escape(MARK_BEGIN) + r".*?" + re.escape(MARK_END), re.DOTALL)
    new_block = (f"{MARK_BEGIN}\nconst PLATFORM_CACHE = {cache_js}\n"
                 f"const TARBALLS = {block_json}\n{MARK_END}")
    if not pattern.search(text):
        fail(f"{path} 已存在但缺少标记块，请人工合并 platform-sync 生成逻辑")
    path.write_text(pattern.sub(new_block, text), encoding="utf-8")


def cmd_platform_sync(_args: object) -> None:
    sources = _source_dirs()
    source_map = _collect_sources(sources)
    cache_root = _cache_root()
    version = _platform_version(cache_root, source_map)
    cache = cache_root / version
    if source_map:
        updated, total = _sync_cache(source_map, cache)
    else:
        updated, total = 0, len(list(cache.glob("*.tgz")))
    if total == 0:
        fail(f"缓存 {cache} 为空：先构建平台包（release:pack）或配置 DSHCTL_PLATFORM_SOURCES")
    tarballs = _cache_tarballs(cache)
    missing = [name for name in _used_platform_packages() if name not in tarballs]
    if missing:
        fail(f"缓存缺少平台包 tarball: {', '.join(missing)}（先构建并同步平台包）")
    _write_pnpmfile(cache, tarballs)
    print(f"[dshctl] 平台版本 {version}，缓存 {cache}（{total} 个 tarball，本次同步 {updated} 个）")
    print(f"[dshctl] .pnpmfile.cjs 映射 {len(tarballs)} 个平台包，已刷新")
    print("[dshctl] 继续：pnpm install 使映射生效")
