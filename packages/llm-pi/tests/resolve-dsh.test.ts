/**
 * dsh 安装树锚点链单测：installAnchor 优先（桌面端唯一可靠来源），
 * 其次 argv[1] 向上查找，均失败返回 undefined（调用方回退 vendored）。
 * 另守门诊断分档：官方 `src/` 不随 npm 发布是**打包形态恒定事实**，
 * 必须按「形态说明」（info）上报，不得混进降级（否则真降级会被淹没）。
 * @module @dsh-plus/llm-pi/tests/resolve-dsh
 */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  dshTreeAnchor,
  type KitDiagnostic,
  loadVendoredKit,
  missingSourceNote,
} from '../src/resolve-dsh.ts'

/** 构造 findDshTreeRoot 判据命中的假 dsh 树（同层两个包的 lib/dist/index.js）。 */
async function withFakeTree(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-plus-anchortree-'))
  try {
    const piLib = join(root, 'node_modules', '@deepseek-ai', 'dsh-llm-pi-ai', 'lib')
    const piAiDist = join(root, 'node_modules', '@earendil-works', 'pi-ai', 'dist')
    await mkdir(piLib, { recursive: true })
    await mkdir(piAiDist, { recursive: true })
    await writeFile(join(piLib, 'index.js'), 'export {}', 'utf8')
    await writeFile(join(piAiDist, 'index.js'), 'export {}', 'utf8')
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('given installAnchor inside a dsh tree, when resolving the anchor, then the tree root wins', async () => {
  await withFakeTree(async (root) => {
    assert.equal(dshTreeAnchor(join(root, 'package.json'), '/nonexistent/argv1'), root)
  })
})

test('given a missing installAnchor, when resolving the anchor, then the argv[1] walk finds the tree', async () => {
  await withFakeTree(async (root) => {
    await mkdir(join(root, 'lib'), { recursive: true })
    const entry = join(root, 'lib', 'bin.js')
    await writeFile(entry, '', 'utf8')
    assert.equal(dshTreeAnchor(undefined, entry), root)
  })
})

test('given neither anchor nor argv tree, when resolving, then undefined is returned for vendored fallback', () => {
  assert.equal(
    dshTreeAnchor('/definitely/missing/package.json', '/definitely/missing/bin.js'),
    undefined,
  )
})

test('given npm 发布形态, when 加载套件, then src 子路径缺失按「形态说明」上报而非降级', () => {
  const diagnostics: KitDiagnostic[] = []
  const kit = loadVendoredKit(diagnostics)
  assert.equal(kit.source, 'vendored')
  const notes = diagnostics.filter((item) => item.message.includes('不携带 src'))
  assert.equal(notes.length, 1, '应恰好一条 src 子路径缺失说明')
  assert.equal(notes[0]?.level, 'info', 'src 不随发布是打包形态事实，不得记为降级')
  assert.match(notes[0]?.message ?? '', /现场推导/, '说明须点明仍取自官方现场推导的部分')
})

test('given 只有一个 seam 缺失, when 生成形态说明, then 只点名该面', () => {
  const note = missingSourceNote(['认证助手'])
  assert.equal(note.level, 'info')
  assert.match(note.message, /认证助手使用插件等价实现/)
  assert.doesNotMatch(note.message, /profile 解析/, '未缺失的面不得被点名')
})
