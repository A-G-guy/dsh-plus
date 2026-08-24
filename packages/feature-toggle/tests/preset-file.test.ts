import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { readPresetFile, syncPresetRows } from '../src/preset-file.ts'

/** standard 预设的代表性片段（组行 + 普通行 + !!js 平台行）。 */
const SAMPLE = `# preset sample
- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    text: hello

- id: tool-bash
  name: '@deepseek-ai/dsh-tool-bash'
  disabled: !!js process.platform === 'win32'

- id: delegation
  name: cordis:group
  group: true
  isolate:
    workflowEngine: true
  config:
    - id: tool-subagent-control
      name: '@deepseek-ai/dsh-tool-subagent-control'

    - id: tool-subagent
      name: '@deepseek-ai/dsh-tool-subagent'
      config:
        provider: spawn

- id: tool-web
  name: '@deepseek-ai/dsh-tool-web'
  config:
    fetch: false

- id: planning
  name: cordis:group
  group: true
  isolate:
    planMode: true
  config:
    - id: plan-mode
      name: '@deepseek-ai/dsh-plan-mode'
`

async function withPresetFile(initial: string, fn: (file: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'feature-toggle-preset-'))
  const file = join(dir, 'agent.cordis.yml')
  await writeFile(file, initial, 'utf-8')
  try {
    await fn(file)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('given preset with catalog rows, when reading state, then presence and disabled flags correct', async () => {
  await withPresetFile(SAMPLE, async (file) => {
    const state = await readPresetFile(file)
    assert.ok(state.present.has('delegation'))
    assert.ok(state.present.has('tool-web'))
    assert.ok(state.present.has('planning'))
    assert.equal(state.disabled.get('delegation'), false)
    // tool-bash 不在目录 preset 行集合（host 平面条件行），不追踪
    assert.ok(!state.present.has('tool-bash'))
  })
})

test('given delegation group, when disabling, then disabled: true added to group row only', async () => {
  await withPresetFile(SAMPLE, async (file) => {
    const written = await syncPresetRows(file, new Set(['delegation']))
    assert.ok(written)
    const text = await readFile(file, 'utf-8')
    // 组行节点的键序无关（disabled 追加在 config 之后也是合法同义），按节边界断言。
    assert.match(
      text,
      /- id: delegation\n {2}name: cordis:group\n {2}group: true\n {2}isolate:\n {4}workflowEngine: true\n {2}config:\n[\s\S]*?^ {2}disabled: true$/m,
    )
    // 子行不受影响（loader 级联禁用，不逐行标记）
    assert.doesNotMatch(
      text,
      /- id: tool-subagent\n {2}name: '@deepseek-ai\/dsh-tool-subagent'\n {2}disabled/,
    )
    // !!js 平台行保持原样
    assert.match(text, /disabled: !!js process\.platform === 'win32'/)
  })
})

test('given disabled delegation, when enabling, then disabled key removed and comments preserved', async () => {
  await withPresetFile(
    SAMPLE.replace(
      '- id: delegation\n  name: cordis:group',
      '- id: delegation\n  name: cordis:group\n  disabled: true',
    ),
    async (file) => {
      const written = await syncPresetRows(file, new Set())
      assert.ok(written)
      const text = await readFile(file, 'utf-8')
      assert.ok(!/- id: delegation\n {2}name: cordis:group\n {2}disabled/.test(text))
      assert.match(text, /# preset sample/)
    },
  )
})

test('given already-disabled row, when syncing same state, then idempotent without rewrite', async () => {
  const initial = SAMPLE.replace(
    '- id: delegation\n  name: cordis:group',
    '- id: delegation\n  name: cordis:group\n  disabled: true',
  )
  await withPresetFile(initial, async (file) => {
    const written = await syncPresetRows(file, new Set(['delegation']))
    assert.ok(!written)
    assert.equal(await readFile(file, 'utf-8'), initial)
  })
})

test('given js-expression disabled row, when enabling, then expression key never removed', async () => {
  await withPresetFile(SAMPLE, async (file) => {
    // tool-bash 的 disabled 是 !!js 表达式——目录外的行，sync 根本不该碰它。
    // 这里通过「禁用集合为空」验证该键在启用语义下被保留。
    await syncPresetRows(file, new Set())
    const text = await readFile(file, 'utf-8')
    assert.match(text, /disabled: !!js process\.platform === 'win32'/)
  })
})

test('given row outside preset catalog, when syncing, then rejected without touching file', async () => {
  await withPresetFile(SAMPLE, async (file) => {
    await assert.rejects(() => syncPresetRows(file, new Set(['persona'])), /不在功能目录/)
    await assert.rejects(() => syncPresetRows(file, new Set(['tool-bash'])), /不在功能目录/)
    const text = await readFile(file, 'utf-8')
    assert.match(text, /- id: persona/)
  })
})

test('given missing rows in source preset, when disabling, then absent rows ignored', async () => {
  const noWeb = SAMPLE.replace(/- id: tool-web\n(?:.|\n)*?\n\n/, '')
  await withPresetFile(noWeb, async (file) => {
    const written = await syncPresetRows(file, new Set(['tool-web', 'delegation']))
    assert.ok(written) // delegation 变化仍需写盘
    const text = await readFile(file, 'utf-8')
    assert.ok(!text.includes('- id: tool-web'))
    assert.match(text, /- id: delegation[\s\S]*?disabled: true/)
  })
})

test('given multiple features, when disabling together, then all group/leaf rows marked', async () => {
  await withPresetFile(SAMPLE, async (file) => {
    await syncPresetRows(file, new Set(['delegation', 'planning', 'tool-web', 'tool-todo']))
    const text = await readFile(file, 'utf-8')
    // 按节断言（键序无关）：每个目标行节内出现 disabled: true。
    const delegationSection = text.split('- id: delegation')[1]?.split('\n- id: ')[0] ?? ''
    assert.match(delegationSection, /disabled: true/)
    const planningSection = text.split('- id: planning')[1]?.split('\n- id: ')[0] ?? ''
    assert.match(planningSection, /disabled: true/)
    const webSection = text.split('- id: tool-web')[1]?.split('\n- id: ')[0] ?? ''
    assert.match(webSection, /disabled: true/)
    // tool-todo 行在样例中缺席 → 忽略（missing-rows 测试已覆盖）
  })
})
