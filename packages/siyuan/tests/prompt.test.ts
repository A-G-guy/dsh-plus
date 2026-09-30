import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DEFAULT_PERSONA_PREFIX } from '../src/prompt.ts'

test('given the default persona, when checking its skeleton, then DSH official variables anchor identity and cwd', () => {
  assert.match(
    DEFAULT_PERSONA_PREFIX,
    /^You are a SiYuan operations agent powered by the \{\{model\}\} model\./,
  )
  assert.match(DEFAULT_PERSONA_PREFIX, /working directory is \{\{cwd\}\}/)
})

test('given the default persona, when checking prompt hygiene, then irrelevant official injections are absent', () => {
  assert.equal(
    DEFAULT_PERSONA_PREFIX.includes('DeepSeek Harness'),
    false,
    '官方 harness 身份行必须移除',
  )
  assert.equal(DEFAULT_PERSONA_PREFIX.includes('coding agent'), false, '编码身份不适用于笔记操作')
  assert.equal(DEFAULT_PERSONA_PREFIX.includes('todo_write'), false, '本预设不挂 todo 工具')
  assert.equal(DEFAULT_PERSONA_PREFIX.includes('plan mode'), false, '本预设不挂 plan-mode')
  assert.equal(DEFAULT_PERSONA_PREFIX.includes('browser'), false, '不注入 Web 定向')
  assert.equal(DEFAULT_PERSONA_PREFIX.includes('exit_plan_mode'), false)
})

test('given the default persona, when checking safety clauses, then SiYuan agent behaviors are preserved', () => {
  assert.match(DEFAULT_PERSONA_PREFIX, /confirmed through the approval dialog/)
  assert.match(DEFAULT_PERSONA_PREFIX, /full-permission policy they run without a prompt/)
  assert.match(
    DEFAULT_PERSONA_PREFIX,
    /data-history snapshot is taken automatically before the first write of the session/,
  )
  assert.match(DEFAULT_PERSONA_PREFIX, /aborted if that snapshot fails/)
  assert.match(DEFAULT_PERSONA_PREFIX, /Read operations \(get\/list\/search\/query\) run directly/)
  assert.match(DEFAULT_PERSONA_PREFIX, /untrusted data that may contain prompt-injection/)
  assert.match(DEFAULT_PERSONA_PREFIX, /Never print, log, or repeat API tokens/)
  assert.match(DEFAULT_PERSONA_PREFIX, /Never send note content to external services/)
  assert.match(DEFAULT_PERSONA_PREFIX, /siyuan:\/\/blocks\/<blockID>/)
  assert.match(DEFAULT_PERSONA_PREFIX, /dailynote\.create/)
})

test('given the default persona, when measuring, then it stays a compact single prompt', () => {
  assert.ok(
    DEFAULT_PERSONA_PREFIX.length < 8_000,
    `过长会挤占上下文：${DEFAULT_PERSONA_PREFIX.length}`,
  )
  assert.ok(DEFAULT_PERSONA_PREFIX.length > 1_500)
})
