/**
 * 故障隔离：监听兄弟 dsh-plus 插件的 fiber FAILED 转移（host 侧直接监听；
 * 浏览器侧经哨兵 HTTP 回报），把对应 loader 条目禁用写进 profile 用户 patch 层。
 * 只处理 dsh-plus- 前缀且排除自身/bundle——官方条目与救生艇自身一概不碰。
 * @module lifeboat/quarantine
 */
import type { Context } from '@deepseek-ai/cordis'

import type { Alerter } from './notify.ts'
import { appendDisable } from './patch-file.ts'

/** Runtime mirror: FiberState 是 cordis 跨包 const enum（官方 dsh-host-plugin-inventory 同款做法）。 */
const FIBER_FAILED = 3

/** 永不隔离的条目：救生艇自身与聚合 bundle（禁了它们等于关掉整个防线/全家）。 */
const EXCLUDED = new Set(['dsh-plus-lifeboat', 'dsh-plus-bundle-main'])

const GUARD_RE = /^dsh-plus-[a-z0-9-]+$/

/** 名字是否属于可隔离的 dsh-plus 兄弟插件（entry id 与插件 name 同字面量是本仓库约定）。 */
export function isGuardedPlugin(name: unknown): name is string {
  return typeof name === 'string' && GUARD_RE.test(name) && !EXCLUDED.has(name)
}

export interface QuarantineDeps {
  patchFile: string
  alertCooldownMs: number
  journal: (kind: string, detail: string) => void
  alert: Alerter
}

export interface Quarantine {
  /** 隔离指定插件（幂等；冷却期内重复触发只计 journal 不写文件）。 */
  quarantine(name: string, origin: 'host' | 'client'): Promise<void>
}

/** 装配隔离执行器（纯逻辑，可测）。 */
export function createQuarantine(ctx: Context, deps: QuarantineDeps): Quarantine {
  const logger = ctx.logger('lifeboat')
  const lastAlertAt = new Map<string, number>()
  const inFlight = new Set<string>()

  async function quarantine(name: string, origin: 'host' | 'client'): Promise<void> {
    if (!isGuardedPlugin(name)) return
    if (inFlight.has(name)) return
    inFlight.add(name)
    try {
      const written = await appendDisable(deps.patchFile, name)
      deps.journal('quarantine', `${name}（来源 ${origin}，${written ? '已写入禁用' : '已存在禁用'}）`)
      const now = Date.now()
      const last = lastAlertAt.get(name) ?? 0
      if (now - last >= deps.alertCooldownMs) {
        lastAlertAt.set(name, now)
        deps.alert(
          `[DSH] 插件 ${name} 加载失败，已自动隔离`,
          `检测到插件 ${name} 的 fiber 进入 FAILED（来源：${origin}）。\n` +
            `已向 ${deps.patchFile} 写入 disabled 覆盖，重启/刷新后该插件不再加载，其余插件不受影响。\n` +
            `修复后删除该条覆盖即可恢复。`,
        )
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.warn(`隔离 ${name} 失败: ${message}`)
      deps.journal('quarantine-error', `${name}: ${message}`)
      deps.alert(`[DSH] 插件 ${name} 加载失败，自动隔离未果`, `隔离写入失败：${message}\n请手动在 patch 层禁用该插件。`)
    } finally {
      inFlight.delete(name)
    }
  }

  return { quarantine }
}

/**
 * host 侧监听：root context 上兄弟 fiber 的 internal/status 转移。
 * fiber.name 对 loader 条目即插件 display name（模块导出的 name 字段）。
 */
export function installHostWatch(ctx: Context, q: Quarantine): void {
  ctx.root.on('internal/status', (fiber: { state: number; name: string }) => {
    if (fiber.state !== FIBER_FAILED) return
    if (!isGuardedPlugin(fiber.name)) return
    void q.quarantine(fiber.name, 'host')
  })
}
