import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'

/**
 * 门控表自动继承的守门测试。
 *
 * 历史：本插件的 compat 门控表曾是官方 catalog.ts 的**手抄镜像**，而官方表在
 * npm 发布形态下不导出、`src/` 不随发布，只能"升级时人工核对"。0.1.5-rc.1 官方
 * 扩容 offer 字段而旧表漏收，后果是官方可配字段被本插件**误判非法并拒写**
 * ——静默功能缺失、无任何报错。
 *
 * 现改为从官方安装副本现场推导（official-surface.ts）：bundle 文本给分型、
 * Config schema 给取值约束。本测试锁住三件事：
 * 1. 推导确实来自官方（source='official'，不是回退快照）；
 * 2. 推导结果与官方 bundle 逐字段一致（读原始文本独立复算，防推导器自身退化）；
 * 3. 官方新增字段自动可用、withhold 字段仍被拒（行为级断言）。
 */

const require = createRequire(import.meta.url)
const officialEntry = require.resolve('@deepseek-ai/dsh-llm-pi-ai')
const bundle = readFileSync(officialEntry, 'utf8')

/** 切出 `const NAME = { ... }` 的块体（括号配对，兼容嵌套对象）。 */
function constBlock(name: string): string | undefined {
  const m = new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*`).exec(bundle)
  if (m === null) return undefined
  const start = bundle.indexOf('{', m.index + m[0].length)
  if (start < 0) return undefined
  let depth = 0
  for (let i = start; i < bundle.length; i += 1) {
    if (bundle[i] === '{') depth += 1
    else if (bundle[i] === '}') {
      depth -= 1
      if (depth === 0) return bundle.slice(start + 1, i)
    }
  }
  return undefined
}

function parseGate(body: string): Record<string, 'offer' | 'withhold'> {
  const out: Record<string, 'offer' | 'withhold'> = {}
  for (const m of body.matchAll(/(\w+):\s*"(offer|withhold)"/g)) {
    out[m[1] as string] = m[2] as 'offer' | 'withhold'
  }
  return out
}

/**
 * 独立复算官方门控表（不复用插件推导器，避免"同错同过"）。
 * 官方形态混合：completions/responses 走命名常量，anthropic 在 COMPAT_GATES 内联。
 */
function officialGates(): Record<string, Record<string, 'offer' | 'withhold'>> {
  const out: Record<string, Record<string, 'offer' | 'withhold'>> = {}
  const named: [string, string][] = [
    ['COMPLETIONS_COMPAT_GATE', 'openai-completions'],
    ['RESPONSES_COMPAT_GATE', 'openai-responses'],
  ]
  for (const [name, api] of named) {
    const block = constBlock(name)
    assert.ok(block, `官方 bundle 未找到 ${name}`)
    out[api] = parseGate(block as string)
  }
  // anthropic 内联在 COMPAT_GATES 中：从 `"anthropic-messages": {` 起按缩进块边界切
  const start = bundle.indexOf('"anthropic-messages": {')
  assert.ok(start >= 0, '官方 bundle 未找到 anthropic-messages 门控块')
  const end = bundle.indexOf('\t},', start)
  assert.ok(end > start, '官方 anthropic 门控块边界解析失败')
  out['anthropic-messages'] = parseGate(bundle.slice(start, end))
  return out
}

/** 安装推导表（走 vendored 套件加载路径，与运行期同一推导链）。 */
async function installDerived() {
  const kit = await import('../src/resolve-dsh.ts')
  const compat = await import('../src/compat.ts')
  kit.loadVendoredKit()
  return compat
}

test('compat 门控表由官方副本现场推导（非手抄/非回退快照）', async () => {
  const compat = await installDerived()
  const info = compat.compatTableInfo()
  assert.equal(
    info.source,
    'official',
    `门控表应现场推导自官方副本，实际回退到内置快照${info.problem === undefined ? '' : `：${info.problem}`}`,
  )
})

test('推导结果与官方 bundle 逐字段一致（独立复算）', async () => {
  const compat = await installDerived()
  for (const [api, gate] of Object.entries(officialGates())) {
    for (const [field, disposition] of Object.entries(gate)) {
      assert.equal(
        compat.compatDispositionOf(api, field),
        disposition,
        `${api}.${field} 分型与官方不一致（官方 ${disposition}）`,
      )
    }
  }
})

test('offer 字段集与官方一致（双向）', async () => {
  const compat = await installDerived()
  for (const [api, gate] of Object.entries(officialGates())) {
    const expected = Object.entries(gate)
      .filter(([, v]) => v === 'offer')
      .map(([k]) => k)
      .sort()
    assert.deepEqual(
      [...compat.compatFieldsOf(api)].sort(),
      expected,
      `${api} 的 offer 字段集不一致`,
    )
  }
})

test('官方新增字段自动可用、withhold 仍被拒（行为级）', async () => {
  const compat = await installDerived()
  // 曾因手抄漏收而被误拒的字段，现在应自动放行
  compat.validateCompat(
    'openai-completions',
    { thinkingTokenBudgetField: 'thinking_budget_tokens', vllmPriority: 2 },
    'test',
  )
  compat.validateCompat('openai-responses', { supportsMaxOutputTokens: true }, 'test')
  // withhold 字段（官方为对应厂商内置）仍写时拒绝
  assert.throws(
    () => compat.validateCompat('anthropic-messages', { supportsMidConvoEffort: true }, 'test'),
    /withhold/,
  )
  assert.throws(
    () => compat.validateCompat('openai-completions', { openRouterRouting: {} }, 'test'),
    /withhold/,
  )
})

test('取值约束由官方 schema 推导（整数/枚举/对象）', async () => {
  const compat = await installDerived()
  // vllmPriority：官方 z.number().step(1) → 整数
  assert.equal(compat.compatFieldSpec('openai-completions', 'vllmPriority'), 'integer')
  assert.throws(
    () => compat.validateCompat('openai-completions', { vllmPriority: 1.5 }, 'test'),
    /必须是整数/,
  )
  // thinkingTokenBudgetField：官方枚举
  assert.deepEqual(compat.compatFieldSpec('openai-completions', 'thinkingTokenBudgetField'), [
    'thinking_token_budget',
    'thinking_budget',
    'thinking_budget_tokens',
  ])
  assert.throws(
    () => compat.validateCompat('openai-completions', { thinkingTokenBudgetField: 'nope' }, 'test'),
    /thinking_token_budget/,
  )
  // chatTemplateKwargs：官方 dict → 对象
  assert.equal(compat.compatFieldSpec('openai-completions', 'chatTemplateKwargs'), 'object')
  assert.throws(
    () => compat.validateCompat('openai-completions', { chatTemplateKwargs: [1] }, 'test'),
    /必须是对象/,
  )
})

test('协议集合由官方 supportedProtocols() 现场推导（非内置三元组）', async () => {
  const { deriveProtocols } = await import('../src/official-surface.ts')
  const { loadVendoredKit } = await import('../src/resolve-dsh.ts')
  const official = await import('@deepseek-ai/dsh-llm-pi-ai')
  const derived = deriveProtocols(official as unknown as Record<string, unknown>)
  assert.deepEqual(derived, [...official.supportedProtocols()])
  const kit = loadVendoredKit()
  assert.deepEqual(kit.protocols, [...official.supportedProtocols()])
  assert.equal(kit.protocolSource, 'official')
  // 每个协议都必须有工厂（自检通过即证明加载成功）
  for (const api of kit.protocols) assert.equal(typeof kit.protocolFactories[api], 'function')
})

test('协议推导在缺少/异形 supportedProtocols 时回退内置三元组', async () => {
  const { deriveProtocols, fallbackProtocols } = await import('../src/official-surface.ts')
  assert.equal(deriveProtocols({}), undefined)
  assert.equal(deriveProtocols({ supportedProtocols: 42 }), undefined)
  assert.equal(deriveProtocols({ supportedProtocols: () => [] }), undefined)
  assert.equal(deriveProtocols({ supportedProtocols: () => ['a', 1] }), undefined)
  assert.deepEqual(fallbackProtocols(), [
    'openai-completions',
    'openai-responses',
    'anthropic-messages',
  ])
})

test('模型条目字段集由官方 Config schema 现场推导（与独立复算一致）', async () => {
  const { deriveModelEntryFields } = await import('../src/official-surface.ts')
  const { loadVendoredKit } = await import('../src/resolve-dsh.ts')
  const official = (await import('@deepseek-ai/dsh-llm-pi-ai')) as unknown as Record<
    string,
    unknown
  >
  const derived = deriveModelEntryFields(official)
  // 独立复算：直接读官方 Config schema 的 providers.*.models 元素键
  const config = official['Config'] as {
    dict: Record<
      string,
      { inner?: { dict: Record<string, unknown> }; dict: Record<string, unknown> }
    >
  }
  const providers = config.dict['providers'] as unknown as {
    inner?: { dict: Record<string, unknown> }
    dict: Record<string, unknown>
  }
  const providerNode = providers.inner ?? providers
  const models = providerNode.dict['models'] as unknown as {
    inner?: { dict: Record<string, unknown> }
    dict: Record<string, unknown>
  }
  const expected = Object.keys((models.inner ?? models).dict)
  assert.deepEqual(derived, expected)
  assert.deepEqual(loadVendoredKit().officialModelFields, expected)
  // 官方 0.2.x 线的已知键集（推导结果不该是内置快照的假象）
  assert.deepEqual(expected, [
    'id',
    'name',
    'contextWindow',
    'maxTokens',
    'input',
    'reasoningEfforts',
    'compat',
  ])
})

test('模型字段集推导失败时回退已知七键并给出诊断', async () => {
  const { deriveModelEntryFields, FALLBACK_MODEL_ENTRY_FIELDS } = await import(
    '../src/official-surface.ts'
  )
  assert.equal(deriveModelEntryFields({}), undefined)
  assert.deepEqual(
    [...FALLBACK_MODEL_ENTRY_FIELDS],
    ['id', 'name', 'contextWindow', 'maxTokens', 'input', 'reasoningEfforts', 'compat'],
  )
  // 形状漂移（providers 不是 object 节点）同样判失败
  assert.equal(
    deriveModelEntryFields({ Config: { dict: { providers: { type: 'string' } } } }),
    undefined,
  )
})

test('compat 回退快照模式放宽未知键，但仍拒 withhold（避免误拒官方新字段）', async () => {
  const compat = await import('../src/compat.ts')
  const { FALLBACK_TABLE } = await import('../src/official-surface.ts')
  const { loadVendoredKit } = await import('../src/resolve-dsh.ts')
  try {
    // 强制进入回退模式，模拟"官方打包形态变了、推导失败"
    compat.installCompatTable(FALLBACK_TABLE)
    compat.validateCompat('openai-completions', { someBrandNewOfficialField: true }, 'test')
    assert.throws(
      () => compat.validateCompat('openai-completions', { openRouterRouting: {} }, 'test'),
      /withhold/,
    )
  } finally {
    // 复原现场推导表（其它测试共用模块级生效表）
    loadVendoredKit()
  }
  assert.equal(compat.compatTableInfo().source, 'official')
})
