/**
 * 运行期套件元信息：插件实际在用哪一份 pi-ai / 官方适配器，以及版本是否落在
 * 本插件验证过的区间内。
 *
 * 存在的理由：插件**按文件路径**动态加载已装 dsh 树里的 pi-ai（版本随 dsh 升级
 * 自动变化，见 resolve-dsh.ts），因此"当前生效版本"不是 manifest 上写的版本。
 * 配置页把它显示出来，版本漂移一眼可见；`VERIFIED_PI_AI_RANGE` 只用于**提示**，
 * 永不阻断——能不能用由运行期形状自检（assertKitShape）与逐项降级决定。
 * @module llm-pi/kit-meta
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 实际生效的三个版本；拿不到即省略（读文件失败不视为错误）。 */
export interface KitVersions {
  /** pi-ai（目录与协议实现的来源）。 */
  piAi?: string
  /** 官方 dsh-llm-pi-ai（PiAiAdapter 与 compat 门控的来源）。 */
  piAiAdapter?: string
  /** dsh 本体（安装树根 package.json，仅在根就是 dsh 包时可得）。 */
  dsh?: string
}

/** 本插件开发/测试覆盖过的 pi-ai 区间（semver range，仅用于状态行提示）。 */
export const VERIFIED_PI_AI_RANGE = '>=0.85.1 <0.88.0'

/** 读 package.json 的 version；文件不存在/非 JSON/无 version 都返回 undefined。 */
export function readPackageVersion(manifestPath: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const version = (parsed as { version?: unknown } | null)?.version
    return typeof version === 'string' && version.length > 0 ? version : undefined
  } catch {
    return undefined
  }
}

/** 读包目录的版本（`<dir>/package.json`）。 */
export function packageVersionOf(packageDir: string): string | undefined {
  return readPackageVersion(join(packageDir, 'package.json'))
}

/** 只读包名（判断安装树根是不是 dsh 本体）。 */
function readPackageName(manifestPath: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const name = (parsed as { name?: unknown } | null)?.name
    return typeof name === 'string' ? name : undefined
  } catch {
    return undefined
  }
}

/** 收集 dsh 安装树内实际加载的那几个包的版本。 */
export function collectTreeVersions(root: string): KitVersions {
  const nm = join(root, 'node_modules')
  const piAi = packageVersionOf(join(nm, '@earendil-works', 'pi-ai'))
  const adapter = packageVersionOf(join(nm, '@deepseek-ai', 'dsh-llm-pi-ai'))
  // 树根 package.json 是 dsh 本体时才算 dsh 版本（源码仓库布局下根可能是别的包）。
  const rootManifest = join(root, 'package.json')
  const dsh =
    readPackageName(rootManifest) === '@deepseek-ai/dsh' ? packageVersionOf(root) : undefined
  return {
    ...(piAi === undefined ? {} : { piAi }),
    ...(adapter === undefined ? {} : { piAiAdapter: adapter }),
    ...(dsh === undefined ? {} : { dsh }),
  }
}

/**
 * 由模块入口文件向上找包目录（最多 3 层，兼容 `<pkg>/{lib,dist}/index.js`
 * 与根目录入口两种布局）；找不到返回 undefined。
 */
function packageDirOf(entryFile: string): string | undefined {
  let dir = dirname(entryFile)
  for (let depth = 0; depth < 3; depth += 1) {
    if (readPackageName(join(dir, 'package.json')) !== undefined) return dir
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
  return undefined
}

/**
 * 解析已安装包的目录（本进程内解析，只用于读 package.json）。
 * 拿不到即返回 undefined（该版本号留空，不影响运行）。
 */
export function installedPackageDir(specifier: string): string | undefined {
  try {
    return packageDirOf(fileURLToPath(import.meta.resolve(specifier)))
  } catch {
    return undefined
  }
}

/** 收集插件 vendored 兜底副本的版本（回退路径下"生效版本"即这两份）。 */
export function collectVendoredVersions(): KitVersions {
  const piAiDir = installedPackageDir('@earendil-works/pi-ai')
  const adapterDir = installedPackageDir('@deepseek-ai/dsh-llm-pi-ai')
  const piAi = piAiDir === undefined ? undefined : packageVersionOf(piAiDir)
  const adapter = adapterDir === undefined ? undefined : packageVersionOf(adapterDir)
  return {
    ...(piAi === undefined ? {} : { piAi }),
    ...(adapter === undefined ? {} : { piAiAdapter: adapter }),
  }
}

/** 已验证区间的解析端点（与 {@link VERIFIED_PI_AI_RANGE} 同步维护）。 */
const VERIFIED_MIN: readonly [number, number, number] = [0, 85, 1]
const VERIFIED_MAX_EXCLUSIVE: readonly [number, number, number] = [0, 88, 0]

/** 解析 `x.y.z[-pre][+build]` 的数值三元组；形状不符返回 undefined。 */
function numericTriple(version: string): [number, number, number] | undefined {
  const core = version.split(/[-+]/, 1)[0] ?? ''
  const parts = core.split('.')
  if (parts.length !== 3) return undefined
  const nums = parts.map((part) => (/^\d+$/.test(part) ? Number.parseInt(part, 10) : Number.NaN))
  const [a, b, c] = nums
  if (a === undefined || b === undefined || c === undefined) return undefined
  if (!Number.isInteger(a) || !Number.isInteger(b) || !Number.isInteger(c)) return undefined
  return [a, b, c]
}

function compareTriple(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): number {
  for (let i = 0; i < 3; i += 1) {
    const diff = (left[i] as number) - (right[i] as number)
    if (diff !== 0) return diff
  }
  return 0
}

/**
 * 生效 pi-ai 版本不在已验证区间时的提示文案（**提示而非阻断**）。
 * 区间内或版本号形状无法解析时返回 undefined。
 */
export function piAiVersionNotice(version: string | undefined): string | undefined {
  if (version === undefined) return undefined
  const parsed = numericTriple(version)
  if (parsed === undefined) return undefined
  if (compareTriple(parsed, VERIFIED_MIN) < 0) {
    return `当前生效 pi-ai ${version} 低于本插件验证过的下限 ${VERIFIED_PI_AI_RANGE}`
  }
  if (compareTriple(parsed, VERIFIED_MAX_EXCLUSIVE) >= 0) {
    return (
      `当前生效 pi-ai ${version} 超出本插件验证过的区间 ${VERIFIED_PI_AI_RANGE}；` +
      '已启用现场推导与形状自检，若出现异常请先看诊断行'
    )
  }
  return undefined
}
