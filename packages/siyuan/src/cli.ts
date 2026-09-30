/**
 * kernel CLI 执行与 help 树采集（并发 + 预算截断）。
 * 全部经注入的 `execFile`，测试以替身驱动。
 * @module @dsh-plus/siyuan/cli
 */

import { CLI_EXCLUDED_FAMILIES } from './cli-map.ts'
import type { ConnectionDeps } from './connection.ts'
import type { SiyuanConnection } from './contract.ts'
import type { KernelHelp } from './help.ts'
import { parseKernelHelp } from './help.ts'

/** 并发上限：docker exec 单次约 150–200ms，10 路约 1s 内完成整树采集。 */
const CONCURRENCY = 10

/** 以连接的 CLI 前缀执行 `kernel …`；调用方负责解析 stdout/stderr。 */
export function execKernel(
  deps: Pick<ConnectionDeps, 'execFile'>,
  conn: SiyuanConnection,
  argv: string[],
  options?: { signal?: AbortSignal },
): Promise<{ stdout: string; stderr: string; code: number }> {
  const [file, ...prefix] = conn.cli
  if (file === undefined) return Promise.reject(new Error('SiYuan CLI 未配置'))
  return deps.execFile(file, [...prefix, ...argv], options)
}

/** 有界并发映射：保持输入顺序，失败项由调用方在 fn 内自吞。 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      const item = items[index]
      if (item !== undefined) results[index] = await fn(item, index)
    }
  })
  await Promise.all(workers)
  return results
}

/** 从 `kernel --help` 根输出提取可包装的顶层家族名。 */
export function parseRootFamilies(rootHelp: string): string[] {
  return parseKernelHelp(rootHelp)
    .subcommands.map((sub) => sub.name)
    .filter((name) => !CLI_EXCLUDED_FAMILIES.has(name))
}

/**
 * 采集家族级 help 树（root + 每家族一层）。
 * @param deadline - 绝对截止时间戳（毫秒）；超时停止新任务并返回已采集部分。
 */
export async function collectFamilyHelps(
  deps: Pick<ConnectionDeps, 'execFile'>,
  conn: SiyuanConnection,
  deadline: number,
): Promise<Map<string, KernelHelp>> {
  const helps = new Map<string, KernelHelp>()
  const root = await execKernel(deps, conn, ['--help']).catch(() => undefined)
  if (root === undefined || root.code !== 0) return helps
  const families = parseRootFamilies(root.stdout)
  await mapLimit(families, CONCURRENCY, async (family) => {
    if (Date.now() > deadline) return
    const res = await execKernel(deps, conn, [family, '--help']).catch(() => undefined)
    if (res === undefined || res.code !== 0) return
    helps.set(family, parseKernelHelp(res.stdout))
  })
  return helps
}

/**
 * 采集 action 级 help（`kernel <family> <action> --help`），供降级发现
 * 派生各 action 的 flag 细节；键为 `${family} ${action}`。
 */
export async function collectActionHelps(
  deps: Pick<ConnectionDeps, 'execFile'>,
  conn: SiyuanConnection,
  families: Map<string, KernelHelp>,
  deadline: number,
): Promise<Map<string, KernelHelp>> {
  const jobs: string[][] = []
  for (const [family, help] of families) {
    for (const sub of help.subcommands) jobs.push([family, sub.name])
  }
  const helps = new Map<string, KernelHelp>()
  await mapLimit(jobs, CONCURRENCY, async ([family, action]) => {
    if (family === undefined || action === undefined || Date.now() > deadline) return
    const res = await execKernel(deps, conn, [family, action, '--help']).catch(() => undefined)
    if (res === undefined || res.code !== 0) return
    helps.set(`${family} ${action}`, parseKernelHelp(res.stdout))
  })
  return helps
}

/** 采集调用级 help（子命令优先，其次家族级缓存）。 */
export async function collectInvokeHelp(
  deps: Pick<ConnectionDeps, 'execFile'>,
  conn: SiyuanConnection,
  family: string,
  action: string | undefined,
  familyHelp: KernelHelp | undefined,
): Promise<KernelHelp> {
  if (action === undefined || action === '') {
    if (familyHelp !== undefined) return familyHelp
    const res = await execKernel(deps, conn, [family, '--help'])
    if (res.code !== 0)
      throw new Error(`SiYuan CLI help 不可用：${family}\n${res.stderr || res.stdout}`)
    return parseKernelHelp(res.stdout)
  }
  const res = await execKernel(deps, conn, [family, action, '--help'])
  if (res.code !== 0) {
    throw new Error(
      `SiYuan CLI 子命令不存在或不可用：${family} ${action}\n${res.stderr || res.stdout}`,
    )
  }
  return parseKernelHelp(res.stdout)
}
