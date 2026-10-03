/**
 * 卡片草稿纯逻辑测试：结算延迟校验与提交形状。
 * （draft.ts 不含 JSX/React，node --test 可直接导入。）
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  type ConfigValue,
  draftFromValue,
  SETTLE_MAX_MS,
  SETTLE_MIN_MS,
  settleTextOk,
  toPatch,
} from '../src/client/draft.ts'

test('给定结算延迟文本，当校验时，则只接受区间内的整数', () => {
  assert.equal(settleTextOk(String(SETTLE_MIN_MS)), true)
  assert.equal(settleTextOk(String(SETTLE_MAX_MS)), true)
  assert.equal(settleTextOk(String(SETTLE_MIN_MS - 1)), false)
  assert.equal(settleTextOk(String(SETTLE_MAX_MS + 1)), false)
  assert.equal(settleTextOk('1500ms'), false)
  assert.equal(settleTextOk(''), false)
})

test('给定解析值，当折算草稿再折算提交时，则数值往返一致', () => {
  const value: ConfigValue = { enabled: true, settleMs: 1500 }
  const draft = draftFromValue(value)
  assert.equal(draft.settleMsText, '1500')
  assert.deepEqual(toPatch(draft), value)
})

test('给定关闭状态，当折算提交时，则 enabled 原样保留', () => {
  const draft = draftFromValue({ enabled: false, settleMs: 200 })
  assert.deepEqual(toPatch(draft), { enabled: false, settleMs: 200 })
})
