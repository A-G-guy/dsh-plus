import assert from 'node:assert/strict'
import { test } from 'node:test'

import { takeOverOpenPath } from '../src/open-path.ts'

/** 模拟上游 RemoteNamespaceService：方法为只有 getter 的 configurable 访问器。 */
function fakeRemoteSession(getter: () => unknown) {
  const holder: Record<string, unknown> = {}
  Object.defineProperty(holder, 'openWorkspacePath', {
    configurable: true,
    enumerable: true,
    get: getter,
  })
  return holder
}

/** 记录打开请求的假面板。 */
function fakePanel(requests: string[]) {
  return { requestOpen: (path: string) => requests.push(path) }
}

test('given a getter-only namespace method, when taking over, then the method is replaced and the panel opens absolute paths', async () => {
  // 回归：上游 api-gateway 以 getter-only 访问器安装命名空间方法，CJS 非严格
  // 模式下普通赋值静默失败（接管"看似存在、实际未生效"，文件点击仍走宿主
  // xdg-open）。defineProperty 重定义必须真正替换 getter。
  const original = async (request: { path: string }) => {
    throw new Error(`host opener for ${request.path}`)
  }
  const session = fakeRemoteSession(() => original)
  const requests: string[] = []
  const dispose = takeOverOpenPath(session as never, fakePanel(requests))
  const opened = await (
    session.openWorkspacePath as (request: { path: string }) => Promise<unknown>
  )({ path: '/home/agguy/a.py' })
  assert.deepEqual(requests, ['/home/agguy/a.py'])
  assert.deepEqual(opened, { ok: true, value: { opened: true } })
  // 非绝对路径回退原 RPC 实现
  await assert.rejects(
    (session.openWorkspacePath as (request: { path: string }) => Promise<unknown>)({
      path: 'relative/path.py',
    }),
    /host opener for relative\/path\.py/,
  )
  // 卸载后恢复原 RPC 函数（delete 会让后续调用缺方法，必须还原）
  dispose()
  await assert.rejects(
    (session.openWorkspacePath as (request: { path: string }) => Promise<unknown>)({
      path: '/home/agguy/a.py',
    }),
    /host opener for \/home\/agguy\/a\.py/,
  )
})

test('given a plain method property, when taking over, then assignment self-check passes', async () => {
  const original = async () => ({ ok: true, value: { opened: false } })
  const holder: Record<string, unknown> = { openWorkspacePath: original }
  const requests: string[] = []
  const dispose = takeOverOpenPath(holder as never, fakePanel(requests))
  await (holder.openWorkspacePath as (request: { path: string }) => Promise<unknown>)({
    path: '/tmp/x.txt',
  })
  assert.deepEqual(requests, ['/tmp/x.txt'])
  dispose()
  // 卸载后恢复原 RPC 函数（绑定形态），绝对路径不再进面板
  const result = await (
    holder.openWorkspacePath as (request: { path: string }) => Promise<unknown>
  )({ path: '/tmp/x.txt' })
  assert.deepEqual(result, { ok: true, value: { opened: false } })
  assert.equal(requests.length, 1)
})

test('given a non-configurable getter-only method, when takeover cannot replace it, then a warning is emitted and behavior stays native', () => {
  // 极端防御：属性不可配置时 defineProperty/赋值都无法替换，必须显式告警
  // 而非静默失效（生产 CJS 非严格模式下赋值会静默失败，正是此前的回归形态）。
  const holder: Record<string, unknown> = {}
  Object.defineProperty(holder, 'openWorkspacePath', {
    configurable: false,
    enumerable: true,
    get: () => async () => ({ ok: true, value: { opened: false } }),
  })
  const warnings: string[] = []
  const dispose = takeOverOpenPath(holder as never, fakePanel([]), (message) =>
    warnings.push(message),
  )
  assert.equal(warnings.length, 1)
  assert.match(warnings[0] ?? '', /takeover failed/)
  dispose()
})
