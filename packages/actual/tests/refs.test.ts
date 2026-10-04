/**
 * 引用名与 CLI 环境变量名的一致性：两者必须逐字相同。
 *
 * 若漂移，`$DSH_HOME/.credentials.yaml` 里的配置只会被 seam 解析到，而 CLI
 * 自身继承环境的那条路径就断了——表现为「卡片显示已配置，工具却报未认证」，
 * 故用测试钉住，而不是靠注释约定。
 * @module @dsh-plus/actual/tests/refs
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { SECRET_ENV } from '@dsh-plus/actual-mcp'

import {
  CREDENTIAL_REFS,
  REF_ENCRYPTION_PASSWORD,
  REF_PASSWORD,
  REF_SESSION_TOKEN,
} from '../src/refs.ts'

test('given the CLI secret env names, when comparing, then the credential refs match them', () => {
  assert.deepEqual(
    [REF_PASSWORD, REF_SESSION_TOKEN, REF_ENCRYPTION_PASSWORD],
    [SECRET_ENV.password, SECRET_ENV.sessionToken, SECRET_ENV.encryptionPassword],
  )
})

test('given the credential list, when inspecting, then every entry is an ACTUAL_-prefixed name', () => {
  for (const ref of CREDENTIAL_REFS) {
    assert.match(ref, /^ACTUAL_[A-Z0-9_]+$/)
  }
})
