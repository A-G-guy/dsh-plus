/**
 * 启动宽限回归：llm-pi 等兄弟插件的 adapter 注册晚于 lifeboat 就绪，
 * 宽限期内不得评估——否则每次重启都误发「应急翻译 + 已还原」通知。
 * @module lifeboat/tests/fallback-grace
 */
import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

import { type FallbackDeps, installLlmFallback } from '../src/fallback-llm.ts'

/** 假 ctx：只提供 installLlmFallback 用到的最小面。 */
function fakeCtx(providers: string[]) {
  const rootListeners = new Map<string, (payload?: unknown) => void>()
  const listeners = new Map<string, (payload?: unknown) => void>()
  const disposers: Array<() => void> = []
  const ctxOn = (type: string, fn: (payload?: unknown) => void) => {
    listeners.set(type, fn)
  }
  return {
    logger: () => ({ warn: () => {} }),
    settings: { get: () => undefined },
    llm: { listProviders: () => providers },
    root: {
      on: (type: string, fn: (payload?: unknown) => void) => {
        rootListeners.set(type, fn)
      },
    },
    // 'ready' 经 ctx.events.on 注册（平台 events 的字符串重载，'ready' 非声明事件）；
    // ctx.on 是同一批方法混入 ctx 的别名，两个面都提供以贴合真实 ctx 形状。
    events: { on: ctxOn },
    on: ctxOn,
    effect: (fn: () => () => void): (() => void) => {
      const dispose = fn()
      disposers.push(dispose)
      return dispose
    },
    /** 触发一次 ready（宽限内的典型来源）。 */
    emitReady: () => listeners.get('ready')?.(),
    disposers,
  }
}

/** 假 deps：以 readState 计数评估执行（evaluate 每次必调；journal 仅 activate/revert 时调）。 */
function fakeDeps(onEvaluate: () => void): FallbackDeps {
  return {
    journal: () => {},
    alert: () => {},
    readState: () => {
      onEvaluate()
      return null
    },
    writeState: async () => {},
  }
}

test('given the boot grace window, when ready fires early, then no evaluation runs (no restart notification spam)', () => {
  mock.timers.enable({ apis: ['Date', 'setTimeout'] })
  try {
    let evaluations = 0
    const ctx = fakeCtx([])
    installLlmFallback(
      ctx as never,
      fakeDeps(() => {
        evaluations += 1
      }),
      60_000,
    )
    // 宽限内：ready / llm 事件都不触发评估
    ctx.emitReady()
    mock.timers.tick(10_000)
    assert.equal(evaluations, 0)
    // 宽限结束：自动评估一次（此时兄弟插件已就绪，provider 命中则无事发生）
    mock.timers.tick(50_000)
    assert.equal(evaluations, 1)
  } finally {
    mock.timers.reset()
  }
})

test('given a zero grace, when ready fires, then evaluation runs immediately (provider actually missing still alerts)', () => {
  mock.timers.enable({ apis: ['Date', 'setTimeout'] })
  try {
    let evaluations = 0
    const ctx = fakeCtx([])
    installLlmFallback(
      ctx as never,
      fakeDeps(() => {
        evaluations += 1
      }),
      0,
    )
    ctx.emitReady()
    assert.equal(evaluations, 1)
  } finally {
    mock.timers.reset()
  }
})
