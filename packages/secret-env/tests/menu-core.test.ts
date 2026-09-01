/**
 * `$` 触发补全的纯核心单测：边界词法、过滤排序、芯片偏移修正。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyChipCorrection,
  detectSecretTrigger,
  filterCandidates,
  type SecretCandidate,
  sameHit,
} from '../src/client/menu-core.ts'

test('detect: 起草开头 $ 开闸', () => {
  assert.deepEqual(detectSecretTrigger('$GI', 3), { query: 'GI', start: 0, end: 3 })
})

test('detect: 空白后开闸', () => {
  assert.deepEqual(detectSecretTrigger('curl -H $DSH', 12), { query: 'DSH', start: 8, end: 12 })
})

test('detect: 标点后开闸（括号/引号）', () => {
  assert.deepEqual(detectSecretTrigger('echo ($TOK', 10), { query: 'TOK', start: 6, end: 10 })
  assert.deepEqual(detectSecretTrigger('"$X"', 3), { query: 'X', start: 1, end: 3 })
})

test('detect: 词中 $ 不触发（已有变量引用续写）', () => {
  assert.equal(detectSecretTrigger('foo$BAR', 7), null)
  assert.equal(detectSecretTrigger('foo$BAR', 4), null) // 光标在 $ 后但词中
})

test('detect: 空白与非 token 字符终止', () => {
  assert.equal(detectSecretTrigger('echo $ TOK', 10), null)
  assert.equal(detectSecretTrigger('echo ${VAR', 10), null) // ${ 形式不接管
  assert.equal(detectSecretTrigger('echo $X-1', 8), null)
})

test('detect: 空 query 也开闸（刚输入 $）', () => {
  assert.deepEqual(detectSecretTrigger('$', 1), { query: '', start: 0, end: 1 })
})

test('detect: 非法光标判负', () => {
  assert.equal(detectSecretTrigger('$A', 0), null)
  assert.equal(detectSecretTrigger('$A', 5), null)
})

test('sameHit: 逐字段等价', () => {
  const a = { query: 'A', start: 0, end: 2 }
  assert.ok(sameHit(a, { query: 'A', start: 0, end: 2 }))
  assert.ok(!sameHit(a, { query: 'AB', start: 0, end: 3 }))
  assert.ok(sameHit(null, null))
  assert.ok(!sameHit(a, null))
})

const ENTRIES: SecretCandidate[] = [
  { envName: 'DSH_VAR_GITHUB_TOKEN', name: 'GITHUB_TOKEN', description: '', scope: 'global' },
  { envName: 'DSH_VAR_API_KEY', name: 'API_KEY', description: '', scope: 'session' },
  { envName: 'DSH_VAR_GITLAB_CI', name: 'GITLAB_CI', description: '', scope: 'global' },
]

test('filter: 空 query 全量返回', () => {
  assert.equal(filterCandidates(ENTRIES, '').length, 3)
})

test('filter: 大小写不敏感，前缀优先于子串', () => {
  const hit = filterCandidates(ENTRIES, 'git')
  assert.deepEqual(
    hit.map((e) => e.name),
    ['GITHUB_TOKEN', 'GITLAB_CI'],
  )
  const mid = filterCandidates(ENTRIES, 'token')
  assert.deepEqual(
    mid.map((e) => e.name),
    ['GITHUB_TOKEN'],
  )
})

test('filter: 无命中返回空', () => {
  assert.equal(filterCandidates(ENTRIES, 'zzz').length, 0)
})

test('chip 修正：渲染偏移按芯片长度差回退', () => {
  // 芯片渲染文本 '@file-long-label'（17）投影为 '/f'（2）：差 15
  assert.equal(applyChipCorrection(20, [{ rendered: 17, draft: 2 }]), 5)
  assert.equal(applyChipCorrection(3, []), 3)
  assert.equal(applyChipCorrection(2, [{ rendered: 17, draft: 2 }]), 0) // 负值钳 0
})
