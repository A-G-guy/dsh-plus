/**
 * `/var` contribution 的跨边界契约单测。
 *
 * 官方 dsh-client-ui-commands 在候选合成期对每个 contribution 调
 * `description()`（0.1.5-rc.1 起；alpha 线读的是字符串字面量）。这里用一个
 * 复现该调用序列的最小假 commandUi，把契约钉在单测里：形状漂移会在这里
 * 失败，而不是在生产环境被 input-trigger 静默摘除整个 `command` 源。
 * 假服务只复现官方行为，不引入任何平台依赖。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import type {
  CommandContribution,
  PopupSelectSpec,
} from '@deepseek-ai/dsh-client-ui-commands/client'

import { registerVarCommand } from '../src/client/command.ts'

/** 官方会话上下文：从 contribution 契约取形，免引入整条 input-trigger 依赖。 */
type SessionArg = Parameters<CommandContribution['available']>[0]

/**
 * 造一个官方会话上下文：sessionId 是编译期品牌字符串（dsh-brand 明示
 * 「比较、日志、序列化都保持底层 primitives 行为」），运行期形状就是
 * `{ sessionId: string }`，故经 unknown 断言。
 */
function sessionOf(sessionId: string): SessionArg {
  return { sessionId } as unknown as SessionArg
}

/** 生产注册的 ui 恒为 popupSelect 壳；按官方判别式把它从 CommandUiSpec 收窄出来。 */
function popupOf(contribution: CommandContribution | undefined): PopupSelectSpec {
  const ui = contribution?.ui
  if (ui === undefined || ui.kind !== 'popupSelect') {
    throw new Error('expected a popupSelect contribution')
  }
  return ui
}

/** 最小假 commandUi：capture 注册，并按官方候选合成的方式消费它。 */
function fakeScope() {
  const registered: CommandContribution[] = []
  const disposers: Array<() => void> = []
  let injectKeys: readonly string[] = []
  const scope = {
    commandUi: {
      register(contribution: CommandContribution) {
        registered.push(contribution)
        return () => {
          registered.splice(registered.indexOf(contribution), 1)
        }
      },
    },
    effect(execute: () => () => void, label?: string) {
      void label
      disposers.push(execute())
      return undefined
    },
  }
  const ctx = {
    inject(keys: readonly string[], callback: (s: typeof scope) => void) {
      injectKeys = keys
      callback(scope)
      return undefined
    },
  }
  return { ctx, registered, disposers, injectKeys: () => injectKeys }
}

const SESSION = sessionOf('session-1')

test('given commandUi 可用, when 注册 /var, then 只注入 commandUi 且注册一条 var', () => {
  const f = fakeScope()
  registerVarCommand(f.ctx, {}, (key) => `t:${key}`)

  assert.deepEqual(f.injectKeys(), ['commandUi'])
  assert.equal(f.registered.length, 1)
  assert.equal(f.registered[0]?.name, 'var')
})

test('given 已注册的 /var, when 官方候选合成读取 description, then 以函数求值而不抛错', () => {
  const f = fakeScope()
  registerVarCommand(f.ctx, {}, (key) => `t:${key}`)

  const description = f.registered[0]?.description
  assert.equal(typeof description, 'function')
  assert.equal(description?.(), 't:command.description')
})

test('given 会话为子代理, when 候选合成过滤可用性, then /var 不出现', () => {
  const f = fakeScope()
  const sessions = { subagentAddress: (id: string) => (id === 'sub' ? { depth: 1 } : undefined) }
  registerVarCommand(f.ctx, sessions, (key) => key)

  const available = f.registered[0]?.available
  assert.equal(available?.(sessionOf('session-1')), true)
  assert.equal(available?.(sessionOf('sub')), false)
})

test('given sessions 服务无 subagentAddress, when 判可用性, then 全部会话可用', () => {
  const f = fakeScope()
  registerVarCommand(f.ctx, {}, (key) => key)

  assert.equal(f.registered[0]?.available(SESSION), true)
})

test('given 已注册的 /var, when 打开 popup 选项, then 给出单个 open 选项', async () => {
  const f = fakeScope()
  registerVarCommand(f.ctx, {}, (key) => `t:${key}`)

  const ui = popupOf(f.registered[0])
  assert.equal(ui.kind, 'popupSelect')
  // 官方候选合成以 (session, signal) 调用 options；signal 用于取消慢候选。
  assert.deepEqual(await ui.options(SESSION, new AbortController().signal), [
    { id: 'open', label: 't:command.openPanel' },
  ])
})

test('given 已注册的 /var, when 退订 disposer 执行, then 注册被移除', () => {
  const f = fakeScope()
  registerVarCommand(f.ctx, {}, (key) => key)

  assert.equal(f.registered.length, 1)
  for (const dispose of f.disposers) dispose()
  assert.equal(f.registered.length, 0)
})
