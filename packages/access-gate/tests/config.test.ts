/**
 * config.ts 单元测试：默认值物化与命名空间约定。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { unwrapVolatile } from '@dsh-plus/shared'

import { Config } from '../src/config.ts'
import { SETTINGS_NS } from '../src/ns.ts'

test('默认值：enabled=false / 空白名单 / 信任 XFF / 自动登录关闭', () => {
  const config = unwrapVolatile(Config({}))
  assert.equal(config.enabled, false)
  assert.deepEqual(config.allowedIps, [])
  assert.equal(config.trustForwardedFor, true)
  assert.equal(config.autoLoginTrustedIps, false, 'IP 信任自动登录默认关闭（fail-safe）')
})

test('schemastery array 缺省物化为 []（消费端语义按"未设置"处理）', () => {
  const config = unwrapVolatile(Config({}))
  assert.ok(Array.isArray(config.allowedIps))
})

test('命名空间字面量符合 dsh-plus 约定', () => {
  assert.equal(SETTINGS_NS, 'dsh-plus-access-gate')
})
