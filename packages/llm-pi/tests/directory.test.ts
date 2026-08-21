import assert from 'node:assert/strict'
import { test } from 'node:test'

import { commitDirectory, type DirectoryEntry } from '../src/directory.ts'

function entry(provider: string): DirectoryEntry {
  return {
    provider,
    displayName: provider,
    settingsNs: 'dsh-plus-llm-pi',
    settingsPath: ['providers', provider],
    declared: true,
  }
}

/** 模拟官方目录：anthropic 已被既有注册占用，整批原子拒绝。 */
function registerWithConflict(held: string[]) {
  const batches: string[][] = []
  return {
    batches,
    register: (entries: DirectoryEntry[]) => {
      batches.push(entries.map((e) => e.provider))
      const hit = entries.find((e) => held.includes(e.provider))
      if (hit) {
        const error = new Error(`configurable provider "${hit.provider}" is already declared`)
        error.name = 'LlmError'
        throw error
      }
    },
  }
}

test('整批被拒时剔除冲突条目重试，其余条目照常注册', () => {
  // Given —— 官方目录已声明 anthropic（内置 provider）
  const { batches, register } = registerWithConflict(['anthropic'])
  const warnings: string[] = []
  // When —— 提交 [chat, anthropic, chatds]
  commitDirectory(register, [entry('chat'), entry('anthropic'), entry('chatds')], (m) =>
    warnings.push(m),
  )
  // Then —— 首轮整批被拒，剔除 anthropic 后次轮成功；告警点名冲突条目
  assert.deepEqual(batches, [
    ['chat', 'anthropic', 'chatds'],
    ['chat', 'chatds'],
  ])
  assert.ok(warnings.some((m) => m.includes('"anthropic"')))
})

test('非冲突错误原样上抛，不做无限重试', () => {
  const register = () => {
    throw new Error('some other failure')
  }
  assert.throws(() => commitDirectory(register, [entry('chat')], () => {}), /some other failure/)
})

test('冲突消息匹配但剔除无效（防死循环护栏）时上抛原错误', () => {
  // 构造一个永远报同名冲突的注册器（剔除后仍报同名）
  const register = () => {
    throw new Error('configurable provider "ghost" is already declared')
  }
  assert.throws(() => commitDirectory(register, [entry('chat')], () => {}), /already declared/)
})
