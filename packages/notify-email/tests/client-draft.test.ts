/**
 * 卡片草稿纯逻辑测试：脱敏值 → 草稿 → 提交形状的往返，以及正整数判定。
 * （draft.ts 不含 JSX/React，node --test 可直接导入。）
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { draftFromValue, isPositiveInt, toPatch } from '../src/client/draft.ts'

const VALUE = {
  enabled: true,
  smtp: {
    host: 'smtp.example.com',
    port: 465,
    secure: true,
    user: 'me@example.com',
    from: 'me@example.com',
  },
  to: ['a@example.com', 'b@example.com'],
  triggers: {
    onComplete: true,
    onError: true,
    onAborted: false,
    onQuestion: true,
    onPlanReview: false,
  },
  idleDebounceMs: 3000,
  maxBodyChars: 4000,
  dryRun: false,
}

test('给定脱敏解析值，当折算草稿时，则 pass 清空、收件人合并为逗号文本', () => {
  const draft = draftFromValue(VALUE)
  assert.equal(draft.pass, '')
  assert.equal(draft.toText, 'a@example.com, b@example.com')
  assert.equal(draft.port, '465')
  assert.deepEqual(draft.triggers, VALUE.triggers)
})

test('给定草稿，当折算提交形状时，则数值折算、收件人拆分去空、pass 原样带回', () => {
  const draft = {
    ...draftFromValue(VALUE),
    toText: ' a@example.com , , b@example.com ',
    pass: 'secret',
  }
  const patch = toPatch(draft)
  assert.deepEqual(patch['to'], ['a@example.com', 'b@example.com'])
  assert.deepEqual(patch['smtp'], {
    host: 'smtp.example.com',
    port: 465,
    secure: true,
    user: 'me@example.com',
    pass: 'secret',
    from: 'me@example.com',
  })
  assert.equal(patch['idleDebounceMs'], 3000)
  assert.equal(patch['maxBodyChars'], 4000)
  assert.equal(patch['dryRun'], false)
})

test('给定文本，当判断正整数时，则只接受非零纯数字', () => {
  assert.equal(isPositiveInt('1'), true)
  assert.equal(isPositiveInt('465'), true)
  assert.equal(isPositiveInt('0'), false)
  assert.equal(isPositiveInt(''), false)
  assert.equal(isPositiveInt('-1'), false)
  assert.equal(isPositiveInt('4.5'), false)
})
