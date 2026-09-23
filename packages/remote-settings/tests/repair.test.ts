import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  type ConfigFormsLike,
  type FormLike,
  type FormSnapshotLike,
  type MirrorLike,
  type MirrorSnapshot,
  maybeRepairSettingsPlane,
  type SettingsApiLike,
} from '../src/client.ts'

interface MirrorOptions {
  withLoad?: boolean
  withSubscribe?: boolean
}

function fakeMirror(persistence: string | undefined, options: MirrorOptions = {}) {
  const state: MirrorSnapshot = {
    status: persistence === 'host' ? 'idle' : 'unavailable',
    view: undefined,
    error: null,
  }
  const listeners = new Set<() => void>()
  const loads: number[] = []
  const mirror: MirrorLike = {
    persistence,
    getSnapshot: () => state,
    ...(options.withLoad === false
      ? {}
      : {
          load: () => {
            loads.push(1)
            state.status = 'ready'
            state.view = { writable: true, namespaces: [] }
            for (const listener of listeners) listener()
            return Promise.resolve()
          },
        }),
    ...(options.withSubscribe === false
      ? {}
      : {
          subscribe: (listener: () => void) => {
            listeners.add(listener)
            return () => listeners.delete(listener)
          },
        }),
  }
  return { mirror, loads }
}

function fakeForm(persistence: string, options: { withStore?: boolean } = {}) {
  const snapshot: FormSnapshotLike & Record<string, unknown> = {
    mode: persistence,
    status: persistence === 'host' ? 'loading' : 'unavailable',
    value: undefined,
  }
  const derives: number[] = []
  const form: FormLike = {
    persistence,
    getSnapshot: () => snapshot,
    ...(options.withStore === false
      ? {}
      : {
          store: {
            update: (fn: (draft: FormSnapshotLike & Record<string, unknown>) => void) =>
              fn(snapshot),
          },
        }),
    derive: () => {
      derives.push(1)
      snapshot.status = 'ready'
    },
    subscribe: () => () => {},
  }
  return { form, snapshot, derives }
}

function fakeForms(options: {
  persistence?: string | undefined
  mirror?: MirrorLike
  forms?: Map<string, FormLike> | undefined
  withDescribe?: boolean
  devToolsScope?: FormLike
}) {
  const internal = fakeMirror(options.persistence)
  const mirror = options.mirror ?? internal.mirror
  const local = { getSnapshot: (): unknown => true, subscribe: () => () => {} }
  const forms: ConfigFormsLike = {
    persistence: options.persistence,
    ...(options.withDescribe === false ? {} : { describe: () => mirror }),
    ...(options.forms === undefined ? {} : { forms: options.forms }),
    ...(options.devToolsScope === undefined
      ? {}
      : { developerTools: { scope: options.devToolsScope, local, enabled: local } }),
  }
  return { forms, mirror, local, loads: options.mirror === undefined ? internal.loads : [] }
}

function fakeSettings(outcome: 'ok' | 'fail' | 'throw', onDescribe?: () => void) {
  let calls = 0
  const settings: SettingsApiLike = {
    describe: () => {
      calls += 1
      onDescribe?.()
      if (outcome === 'throw') return Promise.reject(new Error('network down'))
      return Promise.resolve({ ok: outcome === 'ok' })
    },
  }
  return { settings, calls: () => calls }
}

// ── 行为 1：非降级/探测不可达下的无操作 ──

test('given configForms 非 memory 降级（host 模式），when 执行修复, then 无操作且不探测', async () => {
  const { forms } = fakeForms({ persistence: 'host' })
  const { settings, calls } = fakeSettings('ok')
  const repaired = await maybeRepairSettingsPlane({ settings, forms })
  assert.equal(repaired, false)
  assert.equal(calls(), 0)
  assert.equal(forms.persistence, 'host')
})

test('given memory 降级但设置 RPC 被拒（直连无围栏放行）, when 执行修复, then 维持官方降级', async () => {
  const { forms } = fakeForms({ persistence: 'memory' })
  const { settings } = fakeSettings('fail')
  const repaired = await maybeRepairSettingsPlane({ settings, forms })
  assert.equal(repaired, false)
  assert.equal(forms.persistence, 'memory')
  assert.equal((forms.describe as () => MirrorLike)().persistence, 'memory')
})

test('given memory 降级且探测抛错（网络异常/未认证）, when 执行修复, then 维持官方降级', async () => {
  const { forms } = fakeForms({ persistence: 'memory' })
  const { settings } = fakeSettings('throw')
  const repaired = await maybeRepairSettingsPlane({ settings, forms })
  assert.equal(repaired, false)
  assert.equal(forms.persistence, 'memory')
})

// ── 行为 2：探活可达 → 翻转 provider/mirror、修复启动期表单并触发加载 ──

test('given 非 loopback 页面 memory 降级且 RPC 可达, when 执行修复, then configForms 与 mirror 翻回 host 并加载', async () => {
  const { forms, mirror, loads } = fakeForms({ persistence: 'memory' })
  const { settings, calls } = fakeSettings('ok')
  const repaired = await maybeRepairSettingsPlane({ settings, forms })
  assert.equal(repaired, true)
  assert.equal(calls(), 1)
  assert.equal(forms.persistence, 'host')
  assert.equal(mirror.persistence, 'host')
  assert.equal(loads.length, 1)
})

test('given 启动期已构造的 memory 表单, when 修复执行, then 表单翻 host、补订阅并 derive', async () => {
  const { form, snapshot, derives } = fakeForm('memory')
  const { forms, loads } = fakeForms({ persistence: 'memory', forms: new Map([['chat', form]]) })
  const { settings } = fakeSettings('ok')
  await maybeRepairSettingsPlane({ settings, forms })
  assert.equal(form.persistence, 'host')
  assert.equal(snapshot.mode, 'host')
  assert.notEqual(form.unsubscribe, undefined)
  // 首次 derive + mirror.load 通知订阅后的第二次 derive
  assert.equal(derives.length, 2)
  assert.equal(loads.length, 1)
  assert.equal(typeof form.getSnapshot().status, 'string')
})

test('given developerTools 以 memory 构造（enabled 与 local 同一）, when 修复执行, then 原地改读 Host 表单且身份不变', async () => {
  const { form: scope, snapshot } = fakeForm('memory')
  const { forms, local } = fakeForms({
    persistence: 'memory',
    forms: new Map([['ui-settings', scope]]),
    devToolsScope: scope,
  })
  const { settings } = fakeSettings('ok')
  await maybeRepairSettingsPlane({ settings, forms })
  const devTools = (forms.developerTools ?? {}) as { local: typeof local; enabled: unknown }
  // 对象身份不变：boot 期已按引用捕获的组件同步恢复
  assert.equal(devTools.enabled, local)
  assert.equal(local.getSnapshot(), false)
  snapshot.value = { enabled: false }
  assert.equal(local.getSnapshot(), false)
  snapshot.value = { enabled: true }
  assert.equal(local.getSnapshot(), true)
})

// ── 行为 3：漂移面缺失 → 对应阶段 no-op（不误伤、不抛错） ──

test('given configForms 漂移（persistence/describe 缺失）, when 执行修复, then 无操作且不探测', async () => {
  for (const options of [
    { persistence: undefined },
    { persistence: 'memory', withDescribe: false },
  ] as const) {
    const { forms } = fakeForms({ ...options })
    const { settings, calls } = fakeSettings('ok')
    const repaired = await maybeRepairSettingsPlane({ settings, forms })
    assert.equal(repaired, false)
    assert.equal(calls(), 0)
  }
})

test('given mirror 漂移（persistence 缺失或与 provider 不一致、load 缺失）, when 执行修复, then 无操作且不探测', async () => {
  const drifted: Array<{ persistence: string; mirror: MirrorLike }> = [
    { persistence: 'memory', mirror: fakeMirror(undefined).mirror },
    { persistence: 'memory', mirror: fakeMirror('host').mirror },
    { persistence: 'memory', mirror: fakeMirror('memory', { withLoad: false }).mirror },
  ]
  for (const entry of drifted) {
    const { forms } = fakeForms({ persistence: entry.persistence, mirror: entry.mirror })
    const { settings, calls } = fakeSettings('ok')
    const repaired = await maybeRepairSettingsPlane({ settings, forms })
    assert.equal(repaired, false)
    assert.equal(calls(), 0)
    assert.equal(forms.persistence, 'memory')
  }
})

test('given 探测期间降级已被解除（并发修复）, when 探测返回, then 复核失败不重复翻转', async () => {
  const { forms, loads } = fakeForms({ persistence: 'memory' })
  const { settings } = fakeSettings('ok', () => {
    // 模拟并发：探测应答前另一途径已把降级解除
    forms.persistence = 'host'
    const mirror = forms.describe?.()
    if (mirror !== undefined) mirror.persistence = 'host'
  })
  const repaired = await maybeRepairSettingsPlane({ settings, forms })
  assert.equal(repaired, false)
  assert.equal(loads.length, 0)
})

test('given mirror 无 subscribe 面, when 修复执行, then 仅翻 provider/mirror 并加载，表单维持原状', async () => {
  const { form, derives } = fakeForm('memory')
  const { mirror, loads } = fakeMirror('memory', { withSubscribe: false })
  const { forms } = fakeForms({ persistence: 'memory', mirror, forms: new Map([['chat', form]]) })
  const { settings } = fakeSettings('ok')
  const repaired = await maybeRepairSettingsPlane({ settings, forms })
  assert.equal(repaired, true)
  assert.equal(forms.persistence, 'host')
  assert.equal(loads.length, 1)
  assert.equal(form.persistence, 'memory')
  assert.equal(form.unsubscribe, undefined)
  assert.equal(derives.length, 0)
})

test('given forms Map 缺失或表单缺 store.update 面, when 修复执行, then 可修的照修、不可修的跳过', async () => {
  // Map 缺失：只翻 provider/mirror
  const noMap = fakeForms({ persistence: 'memory' })
  assert.equal(
    await maybeRepairSettingsPlane({ settings: fakeSettings('ok').settings, forms: noMap.forms }),
    true,
  )
  assert.equal(noMap.forms.persistence, 'host')

  // store.update 缺失：该表单跳过，其余照修
  const broken = fakeForm('memory', { withStore: false }).form
  const healthy = fakeForm('memory')
  const { forms } = fakeForms({
    persistence: 'memory',
    forms: new Map([
      ['broken', broken],
      ['healthy', healthy.form],
    ]),
  })
  await maybeRepairSettingsPlane({ settings: fakeSettings('ok').settings, forms })
  assert.equal(broken.persistence, 'memory')
  assert.equal(healthy.form.persistence, 'host')
})

test('given developerTools 漂移（enabled 与 local 非同一对象）, when 修复执行, then 不覆写', async () => {
  const { form: scope } = fakeForm('memory')
  const { forms, local } = fakeForms({ persistence: 'memory', devToolsScope: scope })
  const replaced = { getSnapshot: (): unknown => 'proxy', subscribe: () => () => {} }
  ;(forms.developerTools as { enabled: unknown }).enabled = replaced
  const { settings } = fakeSettings('ok')
  await maybeRepairSettingsPlane({ settings, forms })
  assert.equal((forms.developerTools as { enabled: unknown }).enabled, replaced)
  assert.equal(local.getSnapshot(), true)
})
