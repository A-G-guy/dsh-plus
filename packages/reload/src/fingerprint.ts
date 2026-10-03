/**
 * 产物指纹：启动时记录 profile 直接依赖的构建产物内容哈希，供 /reload 判定
 * 「哪些包的本体在进程启动后被改动」。这类变更位于 `node_modules`，上游
 * dsh-hmr 的模块替换对其直接跳过（依赖遍历遇 `/node_modules/` 即返回空集），
 * 因此只能重启生效；本模块只做事实判定与点名，不尝试绕过。
 * 文件系统经端口注入（测试用内存实现），递归有深度与文件数上限。
 * @module reload/fingerprint
 */
import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'

export type ArtifactEntry =
  | { kind: 'dir'; children: string[] }
  | { kind: 'file'; bytes: Uint8Array }
  | undefined

/** 文件系统访问面：目录给子项名、文件给内容、不存在/不可读给 undefined。 */
export interface ArtifactPort {
  read(path: string): Promise<ArtifactEntry>
}

/** 生产端口：任何读失败都按「不存在」处理——指纹只做事实判定，不因权限或竞态抛错。 */
export const systemArtifacts: ArtifactPort = {
  async read(path) {
    try {
      const info = await stat(path)
      if (info.isDirectory()) return { kind: 'dir', children: await readdir(path) }
      if (!info.isFile()) return undefined
      return { kind: 'file', bytes: await readFile(path) }
    } catch {
      return undefined
    }
  },
}

/** 计入指纹的构建产物目录（存在才纳入）。 */
const BUILD_DIRS = ['lib', 'dist']
/** 递归深度上限：构建产物结构固定，留足余量的同时防异常深树。 */
const MAX_DEPTH = 8
/** 单包纳入哈希的文件数上限：插件产物量级远低于此，越界即停止收集。 */
const MAX_FILES = 4096

export interface PackageFingerprint {
  /** 参与哈希的文件数（诊断用）。 */
  files: number
  /** 全部文件（相对路径 + 内容）的 sha256 十六进制摘要。 */
  hash: string
}

export type Fingerprints = Readonly<Record<string, PackageFingerprint>>

interface CollectedFile {
  path: string
  bytes: Uint8Array
}

/** 递归收集一个目录下的文件（跳过点开头项与嵌套 node_modules）。 */
async function collectFiles(
  port: ArtifactPort,
  base: string,
  dir: string,
  depth: number,
  out: CollectedFile[],
): Promise<void> {
  if (depth > MAX_DEPTH || out.length >= MAX_FILES) return
  const entries = await port.read(dir)
  if (entries?.kind !== 'dir') return
  for (const name of [...entries.children].sort()) {
    if (out.length >= MAX_FILES) return
    if (name.startsWith('.') || name === 'node_modules') continue
    const path = join(dir, name)
    const entry = await port.read(path)
    if (entry?.kind === 'dir') await collectFiles(port, base, path, depth + 1, out)
    else if (entry?.kind === 'file') out.push({ path: relative(base, path), bytes: entry.bytes })
  }
}

/** 单包指纹：`package.json` + `lib/`、`dist/` 下全部文件，按相对路径排序后哈希。 */
async function fingerprintPackage(
  port: ArtifactPort,
  profileDir: string,
  name: string,
): Promise<PackageFingerprint> {
  const base = join(profileDir, 'node_modules', name)
  const files: CollectedFile[] = []
  const manifest = await port.read(join(base, 'package.json'))
  if (manifest?.kind === 'file') files.push({ path: 'package.json', bytes: manifest.bytes })
  for (const buildDir of BUILD_DIRS) {
    await collectFiles(port, base, join(base, buildDir), 0, files)
  }
  files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(file.path)
    hash.update('\0')
    hash.update(file.bytes)
    hash.update('\0')
  }
  return { files: files.length, hash: hash.digest('hex') }
}

/**
 * 采集一组包在 profile 安装目录下的产物指纹。
 * @param profileDir - profile 根目录（其下 `node_modules/<name>` 为安装位置）。
 * @param names - 参与采集的包名；未安装的包得到空文件集的稳定指纹。
 * @param port - 文件系统访问面。
 * @returns 包名 → 指纹（键按包名升序写入）。
 */
export async function captureFingerprints(
  profileDir: string,
  names: readonly string[],
  port: ArtifactPort,
): Promise<Fingerprints> {
  const result: Record<string, PackageFingerprint> = {}
  for (const name of [...names].sort()) {
    result[name] = await fingerprintPackage(port, profileDir, name)
  }
  return result
}

/** 指纹差异：产物内容变化的包名（含新增与消失），升序。 */
export function diffFingerprints(before: Fingerprints, after: Fingerprints): string[] {
  const names = new Set([...Object.keys(before), ...Object.keys(after)])
  return [...names].filter((name) => before[name]?.hash !== after[name]?.hash).sort()
}
