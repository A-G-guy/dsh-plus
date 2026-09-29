/**
 * Python 解释器发现：Windows 与桌面端常无 `python3` 命令（桌面端自带的捆绑
 * 运行时落在 `$DSH_HOME/dsh-runtimes/dsh-primary-runtime`），按候选链解析——
 * 显式配置（可含参数，如 `py -3`）→ 捆绑运行时（浅层 BFS 找解释器）→
 * PATH 扫描 → 平台兜底名（未验证，交 spawn 时再判）。
 *
 * 全部为同步纯逻辑 + 注入文件系统视图，零 spawn：`available()` 是廉价本地检查，
 * 具体候选 spawn ENOENT 时由调用方逐个换下一个（见 provider.run）。
 * @module web-search-services/python
 */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** 候选来源：config=用户显式配置；bundled=桌面端捆绑运行时；path=PATH 扫描命中；fallback=未验证兜底名。 */
export type PythonSource = 'config' | 'bundled' | 'path' | 'fallback'

export interface PythonCandidate {
  command: string
  argsPrefix: readonly string[]
  source: PythonSource
}

/** 注入的文件系统视图（测试在 Linux 上覆盖 win32 形态）。 */
export interface PythonFs {
  exists: (path: string) => boolean
  /** 列目录一层；目录不存在/不可读返回空表。 */
  list: (path: string) => readonly { name: string; dir: boolean }[]
}

export interface PythonDiscoveryEnv {
  platform: NodeJS.Platform
  pathValue: string | undefined
  /** 桌面端捆绑运行时根；undefined = 无（跳过 BFS）。 */
  bundledRoot: string | undefined
  fs: PythonFs
}

interface PlatformCommand {
  name: string
  argsPrefix: readonly string[]
}

interface PlatformSpec {
  /** PATH 扫描尝试的文件名（win32 带 .exe 后缀）。 */
  pathNames: readonly PlatformCommand[]
  /** 未验证兜底（PATH 扫描落空时信任 spawn 的 PATH 解析）。 */
  fallbacks: readonly PlatformCommand[]
  /** 捆绑运行时 BFS 中接受的解释器文件名。 */
  bundledNames: ReadonlySet<string>
}

const POSIX_SPEC: PlatformSpec = {
  pathNames: [
    { name: 'python3', argsPrefix: [] },
    { name: 'python', argsPrefix: [] },
  ],
  fallbacks: [
    { name: 'python3', argsPrefix: [] },
    { name: 'python', argsPrefix: [] },
  ],
  bundledNames: new Set(['python3', 'python']),
}

const WIN32_SPEC: PlatformSpec = {
  pathNames: [
    { name: 'python.exe', argsPrefix: [] },
    { name: 'python3.exe', argsPrefix: [] },
    // Python 启动器：-3 显式锁 Python 3，避免用户配置默认 py2。
    { name: 'py.exe', argsPrefix: ['-3'] },
  ],
  fallbacks: [
    { name: 'python', argsPrefix: [] },
    { name: 'py', argsPrefix: ['-3'] },
    { name: 'python3', argsPrefix: [] },
  ],
  bundledNames: new Set(['python.exe', 'python3.exe', 'python3', 'python']),
}

/** 捆绑运行时 BFS 的边界：层数与访问目录数双上限，防畸形布局拖慢 available()。 */
const BUNDLED_MAX_DEPTH = 3
const BUNDLED_MAX_VISITS = 512
/** 与解释器无关的大目录（Windows CPython 的 Lib/site-packages 等），跳过。 */
const NOISE_DIRS: ReadonlySet<string> = new Set([
  'Lib',
  'lib',
  'lib64',
  'include',
  'share',
  'site-packages',
  'test',
  'tests',
  'doc',
  'docs',
])

function specOf(platform: NodeJS.Platform): PlatformSpec {
  return platform === 'win32' ? WIN32_SPEC : POSIX_SPEC
}

/** 显式配置 → 单候选（按空白拆分，支持 `py -3` 形态）。 */
function configCandidate(configPython: string): PythonCandidate | undefined {
  const parts = configPython
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0)
  const [command, ...argsPrefix] = parts
  if (command === undefined) return undefined
  return { command, argsPrefix, source: 'config' }
}

/** 在捆绑运行时根下浅层 BFS 找解释器文件（先按层扫文件名，再入队子目录）。 */
function findBundled(root: string, env: PythonDiscoveryEnv): string | undefined {
  if (!env.fs.exists(root)) return undefined
  const spec = specOf(env.platform)
  const queue: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }]
  let visits = 0
  while (queue.length > 0 && visits < BUNDLED_MAX_VISITS) {
    const item = queue.shift()
    if (item === undefined) break
    visits += 1
    for (const entry of env.fs.list(item.dir)) {
      if (!entry.dir && spec.bundledNames.has(entry.name)) return join(item.dir, entry.name)
      if (
        entry.dir &&
        item.depth < BUNDLED_MAX_DEPTH &&
        !entry.name.startsWith('.') &&
        !NOISE_DIRS.has(entry.name) &&
        !spec.bundledNames.has(entry.name)
      ) {
        queue.push({ dir: join(item.dir, entry.name), depth: item.depth + 1 })
      }
    }
  }
  return undefined
}

/** PATH 逐目录扫描（名字在外层：win32 任一处的 python.exe 优先于 python3.exe）。 */
function scanPath(env: PythonDiscoveryEnv, spec: PlatformSpec): PythonCandidate[] {
  // PATH 分隔符按【被发现的平台】而非宿主平台取：测试可在 Linux 上覆盖 win32 形态。
  const listSep = env.platform === 'win32' ? ';' : ':'
  const dirs = (env.pathValue ?? '').split(listSep).filter((dir) => dir.length > 0)
  const out: PythonCandidate[] = []
  const seen = new Set<string>()
  for (const { name, argsPrefix } of spec.pathNames) {
    for (const dir of dirs) {
      const full = join(dir, name)
      if (seen.has(full)) continue
      seen.add(full)
      if (env.fs.exists(full)) out.push({ command: full, argsPrefix, source: 'path' })
    }
  }
  return out
}

/**
 * 解析解释器候选链（有序）：显式配置独占；否则 捆绑运行时 → PATH 命中 → 平台兜底名。
 * 兜底名永远追加在末尾（供 spawn ENOENT 时逐个回退），但 `source: 'fallback'`
 * 不算「已验证」——`available()` 只信任 config/bundled/path。
 */
export function pythonCandidates(env: PythonDiscoveryEnv, configPython: string): PythonCandidate[] {
  const explicit = configCandidate(configPython)
  if (explicit !== undefined) return [explicit]
  const spec = specOf(env.platform)
  const out: PythonCandidate[] = []
  if (env.bundledRoot !== undefined) {
    const bundled = findBundled(env.bundledRoot, env)
    if (bundled !== undefined) out.push({ command: bundled, argsPrefix: [], source: 'bundled' })
  }
  out.push(...scanPath(env, spec))
  for (const { name, argsPrefix } of spec.fallbacks) {
    if (!out.some((candidate) => candidate.command === name)) {
      out.push({ command: name, argsPrefix, source: 'fallback' })
    }
  }
  return out
}

/** 生产文件系统视图（真实 fs；list 对不可读目录返回空表）。 */
export function realPythonFs(): PythonFs {
  return {
    exists: (path: string) => existsSync(path),
    list: (path: string) => {
      try {
        return readdirSync(path, { withFileTypes: true }).map((entry) => ({
          name: entry.name,
          dir: entry.isDirectory(),
        }))
      } catch {
        return []
      }
    },
  }
}
