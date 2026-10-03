/**
 * cardCss 前缀正确性与 mergeDict 覆盖顺序。
 * （cardCss/mergeDict 来自纯逻辑模块，不经 .tsx 入口导入——node --test
 * 不装 JSX transform。）
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cardVariantFor } from '../src/client/config-slots.ts'
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

test('cardVariantFor：插件页 page 视图用无边框分节，其余保持卡片', () => {
  assert.equal(cardVariantFor('page'), 'section')
  assert.equal(cardVariantFor('summary'), 'card')
  assert.equal(cardVariantFor(undefined), 'card')
})

test('cardCss 的分节形态规则：横向零内边距 + 官方小节标题度量 + 页脚非 sticky', () => {
  const css = cardCss('dag')
  assert.ok(css.includes('.dag-section{'), '缺分节根规则')
  assert.ok(css.includes('padding:16px 0'), '分节纵向内边距对齐官方设置页')
  assert.ok(css.includes('.dag-sectionTitle{'), '缺小节标题规则')
  assert.ok(css.includes('font-size:13px;font-weight:600'), '小节标题度量对齐官方')
  assert.ok(css.includes('.dag-sectionFooter{'), '缺分节页脚规则')
  assert.ok(
    /\.dag-sectionFooter\{[^}]*position:static/.test(css.replace(/\n/g, '')),
    '分节页脚不得 sticky（宿主页面已提供滚动容器）',
  )
  assert.ok(!/\.dag-section\{[^}]*border:1px/.test(css), '分节形态不得带边框（避免卡片套卡片）')
  assert.ok(!/\.dag-section\{[^}]*background:/.test(css), '分节形态不得带背景（避免卡片套卡片）')
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
