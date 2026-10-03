/**
 * 卡片草稿纯逻辑测试：优先级文本 ↔ 后端序列、超时校验、提交形状。
 * （draft.ts 不含 JSX/React，node --test 可直接导入。）
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  draftFromValue,
  parsePriority,
  priorityTextOk,
  timeoutTextOk,
  toPatch,
} from '../src/client/draft.ts'

test('给定含空行与空格的优先级文本，当解析时，则只保留有效后端且顺序不变', () => {
  const parsed = parsePriority('\n  exa \n\ntavily\n\n')
  assert.deepEqual(parsed.backends, ['exa', 'tavily'])
  assert.deepEqual(parsed.unknown, [])
  assert.deepEqual(parsed.duplicated, [])
})

test('给定未知后端或重复后端，当解析时，则分别归入 unknown 与 duplicated 且不可保存', () => {
  const parsed = parsePriority('tavily\ncontext7\ntavily')
  assert.deepEqual(parsed.backends, ['tavily'])
  assert.deepEqual(parsed.unknown, ['context7'])
  assert.deepEqual(parsed.duplicated, ['tavily'])
  assert.equal(priorityTextOk('tavily\ncontext7'), false)
  assert.equal(priorityTextOk('tavily\ntavily'), false)
})

test('给定空优先级文本，当校验时，则判为无效（空链会让搜索恒失败）', () => {
  assert.equal(priorityTextOk(''), false)
  assert.equal(priorityTextOk('   \n  '), false)
})

test('给定合法优先级文本，当校验时，则为有效', () => {
  assert.equal(priorityTextOk('tavily\nexa\nopenai-chat'), true)
})

test('给定超时文本，当校验时，则下限 1000 且只接受整数', () => {
  assert.equal(timeoutTextOk('1000'), true)
  assert.equal(timeoutTextOk(' 55000 '), true)
  assert.equal(timeoutTextOk('999'), false)
  assert.equal(timeoutTextOk('1000.5'), false)
  assert.equal(timeoutTextOk('abc'), false)
  assert.equal(timeoutTextOk(''), false)
})

test('给定解析值，当折算草稿再折算提交时，则数组与数值往返一致', () => {
  const value = {
    scriptPath: '/opt/search.py',
    envFile: '~/.config/search-services/env',
    python: 'py -3',
    priority: ['exa', 'tavily'] as const,
    timeoutMs: 30_000,
  }
  const draft = draftFromValue({ ...value, priority: [...value.priority] })
  assert.equal(draft.priorityText, 'exa\ntavily')
  assert.deepEqual(toPatch(draft), { ...value, priority: ['exa', 'tavily'] })
})
