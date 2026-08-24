/**
 * config.ts 单元测试：默认值物化与 fail-closed 判定。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { Config, isFailClosed } from '../src/config.ts'
import { SETTINGS_NS } from '../src/ns.ts'

test('默认值：enabled=false / 信任 XFF / 720 小时 cookie', () => {
  const config = Config({})
  assert.equal(config.enabled, false)
  assert.equal(config.token, '')
  assert.deepEqual(config.allowedIps, [])
  assert.equal(config.trustForwardedFor, true)
  assert.equal(config.cookieMaxAgeHours, 720)
  assert.equal(config.loginFailLimit, 10)
  assert.equal(config.loginCooldownMs, 60000)
})

test('schemastery array 缺省物化为 []（消费端语义按"未设置"处理）', () => {
  const config = Config({})
  assert.ok(Array.isArray(config.allowedIps))
})

test('isFailClosed：enabled 且 token 空且白名单空', () => {
  assert.ok(!isFailClosed({ enabled: false, token: '', allowedIps: [], trustForwardedFor: true }))
  assert.ok(!isFailClosed({ enabled: true, token: 'x', allowedIps: [], trustForwardedFor: true }))
  assert.ok(
    !isFailClosed({ enabled: true, token: '', allowedIps: ['1.2.3.4'], trustForwardedFor: true }),
  )
  assert.ok(isFailClosed({ enabled: true, token: '', allowedIps: [], trustForwardedFor: true }))
})

test('命名空间字面量符合 dsh-plus 约定', () => {
  assert.equal(SETTINGS_NS, 'dsh-plus-access-gate')
})
