/**
 * config.ts 单元测试：默认值物化与旧配置键兼容。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { Config } from '../src/config.ts'
import { SETTINGS_NS } from '../src/ns.ts'

test('默认值：enabled=false / 空白名单 / 信任 XFF', () => {
  const config = Config({})
  assert.equal(config.enabled, false)
  assert.deepEqual(config.allowedIps, [])
  assert.equal(config.trustForwardedFor, true)
})

test('schemastery array 缺省物化为 []（消费端语义按"未设置"处理）', () => {
  const config = Config({})
  assert.ok(Array.isArray(config.allowedIps))
})

test('旧配置键（token/cookieMaxAgeHours 等）透传忽略，不阻断加载', () => {
  // 合并官方认证前的 settings.yaml 仍带旧键；schemastery 透传未知键，
  // 升级后插件必须能直接加载旧配置（实测行为固定为回归防线）。
  const legacy = {
    enabled: true,
    token: 'legacy-secret',
    cookieMaxAgeHours: 720,
    loginFailLimit: 10,
    loginCooldownMs: 60000,
    allowedIps: ['100.108.58.63'],
  }
  const config = Config(legacy)
  assert.equal(config.enabled, true)
  assert.deepEqual(config.allowedIps, ['100.108.58.63'])
})

test('命名空间字面量符合 dsh-plus 约定', () => {
  assert.equal(SETTINGS_NS, 'dsh-plus-access-gate')
})
