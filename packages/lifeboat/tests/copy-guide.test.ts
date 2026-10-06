/**
 * 副本指引行为：启动宽限（竞态不误报）、默认模型 provider 正常不告警、
 * 缺席时按副本形态给出就绪/缺失/空三种指引、告警冷却、事件触发。
 * 只告警不写——本文件的 deps 全为内存替身，不触盘。
 * @module lifeboat/tests/copy-guide
 */
import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

import { type CopyGuideDeps, installCopyGuide } from '../src/copy-guide.ts'
import type { OfficialCopyStatus } from '../src/official-copy-status.ts'

interface FakeCtx {
  logger: () => { warn(message: unknown): void }
  settings: { describe(): Array<{ ns: string; value?: unknown }> }
  llm: { listProviders(): Array<{ id: string }> }
  root: { on(type: string, fn: (payload?: unknown) => void): void }
  effect(fn: () => () => void): () => void
  emitSettings(ns: string): void
  emitAdapters(): void
  disposeAll(): void
  setProviders(ids: string[]): void
}

/** 假 ctx：只提供 installCopyGuide 用到的最小面（settings/llm/root/effect/logger）。 */
function fakeCtx(defaultProvider: string | undefined): FakeCtx {
  let providers: string[] = []
  const rootListeners = new Map<string, (payload?: unknown) => void>()
  const disposers: Array<() => void> = []
  return {
    logger: () => ({ warn: () => {} }),
    settings: {
      describe: () =>
        defaultProvider === undefined
          ? []
          : [{ ns: 'agent-default-model', value: { provider: defaultProvider } }],
    },
    llm: { listProviders: () => providers.map((id) => ({ id })) },
    root: {
      on: (type: string, fn: (payload?: unknown) => void) => {
        rootListeners.set(type, fn)
      },
    },
    effect: (fn: () => () => void): (() => void) => {
      const dispose = fn()
      disposers.push(dispose)
      return dispose
    },
    emitSettings: (ns) => rootListeners.get('settings/document-updated')?.(ns),
    emitAdapters: () => rootListeners.get('llm/adapters-updated')?.(),
    disposeAll: () => {
      for (const dispose of disposers) dispose()
    },
    setProviders: (ids) => {
      providers = ids
    },
  }
}

interface Recorded {
  alerts: Array<{ subject: string; text: string }>
  journals: Array<{ kind: string; detail: string }>
}

/** 假 deps：记录告警/journal，副本状态由测试夹具注入。 */
function fakeDeps(copy: OfficialCopyStatus, cooldownMs = 300_000): CopyGuideDeps & Recorded {
  const alerts: Array<{ subject: string; text: string }> = []
  const journals: Array<{ kind: string; detail: string }> = []
  return {
    journal: (kind, detail) => journals.push({ kind, detail }),
    alert: (subject, text) => alerts.push({ subject, text }),
    readCopy: async () => copy,
    profile: 'web',
    cooldownMs,
    alerts,
    journals,
  }
}

/** 评估是异步链（readCopy 后置告警）：排空事件循环再断言。 */
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

const READY_COPY: OfficialCopyStatus = {
  path: '/home/u/.dsh/llm-pi.official-patch.yaml',
  exists: true,
  updatedAt: 1_790_000_000_000,
  routes: 3,
  warnings: [],
}

test('given the boot grace window, when events fire early, then nothing is evaluated', async () => {
  mock.timers.enable({ apis: ['Date', 'setTimeout'] })
  try {
    const ctx = fakeCtx('missing-provider')
    const deps = fakeDeps(READY_COPY)
    installCopyGuide(ctx as never, deps, 60_000)
    ctx.setProviders([])
    // 宽限内：事件不触发评估
    ctx.emitAdapters()
    ctx.emitSettings('agent-default-model')
    mock.timers.tick(10_000)
    assert.equal(deps.alerts.length, 0)
    // 宽限结束：自动评估一次，缺席 + 副本就绪 → 恰好一条指引
    mock.timers.tick(50_000)
    await flush()
    assert.equal(deps.alerts.length, 1)
    assert.equal(deps.alerts[0]?.subject, '[DSH] LLM 应急副本可应用')
    assert.ok(deps.alerts[0]?.text.includes('--patch /home/u/.dsh/llm-pi.official-patch.yaml'))
    assert.ok(deps.alerts[0]?.text.includes('dsh web --patch'))
    assert.equal(deps.journals[0]?.kind, 'llm-copy-guide')
    ctx.disposeAll()
  } finally {
    mock.timers.reset()
  }
})

test('given a healthy default provider, when evaluation runs, then no alert fires', async () => {
  mock.timers.enable({ apis: ['Date', 'setTimeout'] })
  try {
    const ctx = fakeCtx('good-provider')
    ctx.setProviders(['good-provider'])
    const deps = fakeDeps(READY_COPY)
    installCopyGuide(ctx as never, deps, 0)
    ctx.emitAdapters()
    await flush()
    assert.equal(deps.alerts.length, 0)
    assert.equal(deps.journals.length, 0)
    ctx.disposeAll()
  } finally {
    mock.timers.reset()
  }
})

test('given a missing copy, when the provider is absent, then the guide says the copy is missing', async () => {
  mock.timers.enable({ apis: ['Date', 'setTimeout'] })
  try {
    const ctx = fakeCtx('missing-provider')
    ctx.setProviders([])
    const deps = fakeDeps({ path: '/x/copy.yaml', exists: false, warnings: [] })
    installCopyGuide(ctx as never, deps, 0)
    ctx.emitAdapters()
    await flush()
    assert.equal(deps.alerts[0]?.subject, '[DSH] LLM 应急副本缺失')
    assert.equal(deps.journals[0]?.detail.includes('副本缺失'), true)
    ctx.disposeAll()
  } finally {
    mock.timers.reset()
  }
})

test('given an empty copy, when the provider is absent, then the guide warns applying is a no-op', async () => {
  mock.timers.enable({ apis: ['Date', 'setTimeout'] })
  try {
    const ctx = fakeCtx('missing-provider')
    ctx.setProviders([])
    const deps = fakeDeps({ path: '/x/copy.yaml', exists: true, routes: 0, warnings: [] })
    installCopyGuide(ctx as never, deps, 0)
    ctx.emitAdapters()
    await flush()
    assert.equal(deps.alerts[0]?.subject, '[DSH] LLM 应急副本为空')
    ctx.disposeAll()
  } finally {
    mock.timers.reset()
  }
})

test('given the cooldown, when events keep firing, then only one alert per window; after expiry it re-alerts', async () => {
  mock.timers.enable({ apis: ['Date', 'setTimeout'] })
  try {
    const ctx = fakeCtx('missing-provider')
    ctx.setProviders([])
    const deps = fakeDeps(READY_COPY, 300_000)
    installCopyGuide(ctx as never, deps, 0)
    ctx.emitAdapters()
    await flush()
    ctx.emitAdapters()
    ctx.emitSettings('agent-default-model')
    await flush()
    assert.equal(deps.alerts.length, 1, '冷却期内重复事件只告警一次')
    mock.timers.tick(300_000)
    ctx.emitAdapters()
    await flush()
    assert.equal(deps.alerts.length, 2, '冷却结束后再次缺席可再告警')
    ctx.disposeAll()
  } finally {
    mock.timers.reset()
  }
})

test('given no default model configured, when evaluation runs, then it is a silent no-op', async () => {
  mock.timers.enable({ apis: ['Date', 'setTimeout'] })
  try {
    const ctx = fakeCtx(undefined)
    const deps = fakeDeps(READY_COPY)
    installCopyGuide(ctx as never, deps, 0)
    ctx.emitAdapters()
    await flush()
    assert.equal(deps.alerts.length, 0)
    ctx.disposeAll()
  } finally {
    mock.timers.reset()
  }
})
