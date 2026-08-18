/**
 * 浏览器半哨兵：bundle 首位加载，在 root context 监听兄弟 fiber 的 FAILED 转移，
 * 经同源 HTTP 回报 host 半隔离。boot 失败页是内核所有（fail-loud），本次启动
 * 无法挽回——哨兵保证的是「刷新一次即恢复」。
 *
 * 零依赖铁律：不 import 任何包（含 cordis/shared），FiberState.FAILED 以字面量
 * 3 镜像一个道理（官方 dsh-host-plugin-inventory 同款做法）；任何异常止步自身。
 * @module @dsh-plus/lifeboat/client
 */
import type { Context } from '@deepseek-ai/cordis'

export const name = 'dsh-plus-lifeboat'

/** Runtime mirror: FiberState 是 cordis 跨包 const enum（FAILED = 3，cordis 4.0.1）。 */
const FIBER_FAILED = 3

/** 永不回报的条目：救生艇自身与聚合 bundle。 */
const EXCLUDED = new Set(['dsh-plus-lifeboat', 'dsh-plus-bundle-main'])

const GUARD_RE = /^dsh-plus-[a-z0-9-]+$/

export function apply(ctx: Context): void {
  try {
    const reported = new Set<string>()
    ctx.root.on('internal/status', (fiber: { state: number; name: string }) => {
      try {
        if (fiber.state !== FIBER_FAILED) return
        const plugin = fiber.name
        if (!GUARD_RE.test(plugin) || EXCLUDED.has(plugin) || reported.has(plugin)) return
        reported.add(plugin)
        void fetch('/dsh-plus/lifeboat/quarantine', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: plugin }),
        }).catch(() => {
          // boot 失败期连接未必就绪；host 半的监听仍是主通道，这里失败静默。
        })
      } catch {
        // 哨兵监听器绝不向外抛异常（fail-loud 启动门下，自身异常会卡死整页）。
      }
    })
  } catch {
    // apply 自身同理。
  }
}
