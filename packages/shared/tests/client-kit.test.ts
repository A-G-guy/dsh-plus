/**
 * cardCss 前缀正确性与 mergeDict 覆盖顺序。
 * （cardCss/mergeDict 来自纯逻辑模块，不经 .tsx 入口导入——node --test
 * 不装 JSX transform。）
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { commonZh, mergeDict } from '../src/client/i18n.ts'
import { cardCss } from '../src/client/styles.ts'

test('cardCss 按前缀生成类名，两个前缀互不串包', () => {
  const a = cardCss('dne')
  const b = cardCss('dag')
  assert.ok(a.includes('.dne-card{'))
  assert.ok(a.includes('.dne-btnPrimary{'))
  assert.ok(!a.includes('.dag-card{'))
  assert.ok(b.includes('.dag-card{'))
  assert.ok(!b.includes('.dne-card{'))
})

test('cardCss 的 extra 规则拼接在尾部（可覆盖基础规则）', () => {
  const css = cardCss('xyz', '.xyz-card{border-radius:20px}')
  const base = css.indexOf('.xyz-card{border:1px solid')
  const override = css.indexOf('.xyz-card{border-radius:20px}')
  assert.ok(base !== -1 && override !== -1 && override > base, '覆盖规则应位于基础规则之后')
})

test('cardCss 含窄屏与粗指针媒体查询（响应式硬要求）', () => {
  const css = cardCss('dne')
  assert.ok(css.includes('@media (max-width:767px)'))
  assert.ok(css.includes('@media (pointer:coarse)'))
  assert.ok(css.includes('font-size:16px'), '窄屏输入 16px 防 iOS 缩放')
  assert.ok(css.includes('min-height:44px'), '可点目标 ≥44px')
})

test('mergeDict：own 覆盖同键、公共键保留、入参不可变', () => {
  const base = { save: '保存', extra: '公共' }
  const own = { save: '自定义保存' }
  const merged = mergeDict(base, own)
  assert.equal(merged.save, '自定义保存')
  assert.equal(merged.extra, '公共')
  assert.equal(base.save, '保存')
  assert.equal(own.save, '自定义保存')
})

test('commonZh 含卡片全部公共操作键', () => {
  for (const key of ['save', 'discard', 'unsaved', 'loading', 'readOnly', 'invalidNumber']) {
    assert.ok(key in commonZh, `缺少公共键 ${key}`)
  }
})
