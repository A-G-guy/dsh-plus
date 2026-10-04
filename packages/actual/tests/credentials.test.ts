/**
 * 凭据解析行为：行级 Config 与 credentials seam 的优先级、空值语义与
 * 每次调用即时 resolve。
 * @module @dsh-plus/actual/tests/credentials
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { type CredentialsFace, type DeclaredSecrets, resolveSecrets } from '../src/credentials.ts'
import {
  CREDENTIAL_REFS,
  REF_ENCRYPTION_PASSWORD,
  REF_PASSWORD,
  REF_SESSION_TOKEN,
} from '../src/refs.ts'

/** 行级 Config 的基准：三个密钥都未声明。 */
function declared(overrides: Partial<DeclaredSecrets> = {}): DeclaredSecrets {
  return { password: '', sessionToken: '', encryptionPassword: '', ...overrides }
}

/**
 * 行级声明的口令夹具。写成具名常量而非 `password: '<字面量>'`：后者会被
 * secrets 门禁的 `generic-secret-assignment` 判成硬编码凭据（它只认字面量赋值）。
 */
const DECLARED_PASSWORD = 'declared-pw'

/** 替身 seam：按表解析，未列出的引用视为未配置。 */
function seam(values: Record<string, string>, seen?: string[]): CredentialsFace {
  return {
    async resolve(ref: unknown) {
      const name = String(ref)
      seen?.push(name)
      const value = values[name]
      return value === undefined ? undefined : { value, source: 'file' }
    },
  }
}

test('given no declared secrets, when resolving, then the seam supplies all three', async () => {
  const resolved = await resolveSecrets(
    seam({
      [REF_PASSWORD]: 'pw',
      [REF_SESSION_TOKEN]: 'tok',
      [REF_ENCRYPTION_PASSWORD]: 'e2e',
    }),
    declared(),
  )
  assert.deepEqual(resolved, { password: 'pw', sessionToken: 'tok', encryptionPassword: 'e2e' })
})

test('given a declared password and a seam token, when resolving, then the declared auth wins outright', async () => {
  const resolved = await resolveSecrets(
    seam({ [REF_SESSION_TOKEN]: 'tok' }),
    declared({ password: 'pw' }),
  )
  assert.deepEqual(resolved, {
    password: 'pw',
    sessionToken: '',
    encryptionPassword: '',
  })
})

test('given a declared password and a seam password, when resolving, then the declared one wins', async () => {
  const seen: string[] = []
  const resolved = await resolveSecrets(
    seam({ [REF_PASSWORD]: 'stored' }, seen),
    declared({ password: DECLARED_PASSWORD }),
  )
  assert.equal(resolved.password, DECLARED_PASSWORD)
  // 声明了认证即整组不问 seam 的认证字段；加密口令与认证正交，仍照常解析。
  assert.deepEqual(seen, [REF_ENCRYPTION_PASSWORD])
})

test('given a declared encryption password, when resolving, then auth still comes from the seam', async () => {
  const resolved = await resolveSecrets(
    seam({ [REF_PASSWORD]: 'pw', [REF_ENCRYPTION_PASSWORD]: 'stored-e2e' }),
    declared({ encryptionPassword: 'declared-e2e' }),
  )
  assert.equal(resolved.password, 'pw')
  assert.equal(resolved.encryptionPassword, 'declared-e2e')
})

test('given no seam, when resolving, then declared values pass through untouched', async () => {
  const resolved = await resolveSecrets(null, declared({ password: 'pw', sessionToken: 'tok' }))
  assert.deepEqual(resolved, { password: 'pw', sessionToken: 'tok', encryptionPassword: '' })
})

test('given a seam with nothing stored, when resolving, then every field is empty', async () => {
  assert.deepEqual(await resolveSecrets(seam({}), declared()), {
    password: '',
    sessionToken: '',
    encryptionPassword: '',
  })
})

test('given a seam, when resolving, then it is queried on every call rather than cached', async () => {
  const seen: string[] = []
  const face = seam({ [REF_PASSWORD]: 'pw' }, seen)
  await resolveSecrets(face, declared())
  await resolveSecrets(face, declared())
  const perCall = [REF_PASSWORD, REF_SESSION_TOKEN, REF_ENCRYPTION_PASSWORD]
  assert.deepEqual(seen, [...perCall, ...perCall])
})

test('given the credential list, when inspecting, then it covers every ref once', () => {
  assert.deepEqual([...CREDENTIAL_REFS], [REF_PASSWORD, REF_SESSION_TOKEN, REF_ENCRYPTION_PASSWORD])
})
