/**
 * 认证助手（官方 auth.ts 的等价实现）记录作用域行为测试。
 *
 * 作用域曾是硬编码镜像官方常量；硬编码一旦落后于官方，`list()` 会把本插件
 * 自己的登录记录判成他人的而**凭空消失**且无报错（与 compat 门控表手抄镜像
 * 同一类故障）。现由官方包根导出的 `recordKeyFor` 现场推导，本测试用与官方
 * 不同的作用域证明它真的跟着 `recordKeyFor` 走，而不是比对常量。
 * @module @dsh-plus/llm-pi/tests/auth-inline
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Context } from '@deepseek-ai/cordis'
import type { CredentialKey, CredentialRecord } from '@deepseek-ai/dsh-credentials'

import { credentialStoreFrom } from '../src/auth-inline.ts'

interface StoredKey {
  key: string
  kind: 'api-key' | 'grant'
}

/** 假 ctx：只提供 list() 用到的 credentials.listRecords（枚举归属判定）。 */
function ctxWith(records: readonly StoredKey[]): Context {
  return {
    get: (name: string) =>
      name === 'credentials'
        ? { listRecords: async () => records as unknown as readonly CredentialRecord[] }
        : undefined,
  } as unknown as Context
}

/** 官方作用域之外的记录键格式器（模拟官方改作用域后本插件必须跟随）。 */
function foreignRecordKeyFor(providerId: string): CredentialKey {
  return `tenant-b/${providerId}` as CredentialKey
}

test('given 记录键作用域非 llm-pi-ai, when 列举凭据, then 跟随 recordKeyFor 现场作用域', async () => {
  const store = credentialStoreFrom(
    ctxWith([
      { key: 'tenant-b/router-a', kind: 'api-key' },
      { key: 'llm-pi-ai/router-b', kind: 'api-key' },
      { key: 'tenant-b/oauth-c', kind: 'grant' },
    ]),
    foreignRecordKeyFor,
  )
  assert.deepEqual(await store.list(), [
    { providerId: 'router-a', type: 'api_key' },
    { providerId: 'oauth-c', type: 'oauth' },
  ])
})

test('given 无凭据服务, when 列举凭据, then 空列表而非抛错', async () => {
  const store = credentialStoreFrom(
    { get: () => undefined } as unknown as Context,
    foreignRecordKeyFor,
  )
  assert.deepEqual(await store.list(), [])
})
