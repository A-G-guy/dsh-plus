/**
 * injectPluginConfigCard 两槽位注册（0.2.1-alpha.2）：key/名称拼装正确、
 * inject 面两槽位共用、注册回调按槽位声明周期执行（fake slots 只记录，无 DOM）。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DSH_PLUS_BUNDLE, injectPluginConfigCard } from '../src/client/config-slots.ts'
import type { SlotsLike } from '../src/client/plugin-context.ts'

interface InjectCall {
  key: string
  callback: () => unknown
}

/** 手动受控的 fake slots：inject 记录挂起回调，register 记录 options/component。 */
function fakeSlots() {
  const injects: InjectCall[] = []
  const registers: Array<{ options: Record<string, unknown>; component: unknown }> = []
  const slots: SlotsLike = {
    inject: (key: string, callback: () => unknown) => {
      injects.push({ key, callback })
      return () => {}
    },
    register: (options: Record<string, unknown>, component: unknown) => {
      registers.push({ options, component })
      return () => {}
    },
  }
  return { slots, injects, registers }
}

const REG = {
  ns: 'dsh-plus-demo',
  rowId: 'dsh-plus-demo',
  pkg: '@dsh-plus/demo',
  component: function DemoCard() {},
  inject: () => ({ t: () => '' }),
}

test('向插件页两个配置槽位挂起注入（不再注册已删除的 legacy 槽位）', () => {
  const { slots, injects } = fakeSlots()
  injectPluginConfigCard(slots, REG)
  assert.deepEqual(
    injects.map((call) => call.key),
    ['plugins.row.config', 'plugins.bundle.config'],
  )
})

test('注册键拼装：row 用 bundle#rowId，bundle 用包名', () => {
  const { slots, injects, registers } = fakeSlots()
  injectPluginConfigCard(slots, REG)
  for (const call of injects) call.callback()
  assert.equal(registers.length, 2)
  const [row, bundle] = registers
  assert.ok(row && bundle, '两个槽位各产生一次注册')
  assert.equal(row.options.name, 'plugins.row.config')
  assert.equal(row.options.key, `${DSH_PLUS_BUNDLE}#dsh-plus-demo`)
  assert.equal(bundle.options.name, 'plugins.bundle.config')
  assert.equal(bundle.options.key, '@dsh-plus/demo')
})

test('locale/inject 面与组件两槽位共用同一份', () => {
  const { slots, injects, registers } = fakeSlots()
  injectPluginConfigCard(slots, REG)
  for (const call of injects) call.callback()
  for (const entry of registers) {
    assert.equal(entry.options.locale, 'dsh-plus-demo')
    assert.equal(typeof entry.options.inject, 'function')
    assert.equal(entry.component, REG.component)
  }
})
