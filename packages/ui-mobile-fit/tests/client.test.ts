import assert from 'node:assert/strict'
import { test } from 'node:test'

import { mobileFitCss } from '../src/styles.ts'
import { apply, name } from '../src/client.ts'
import { IME_ACTIVE_ATTR, installBehaviors } from '../src/behaviors.ts'

test('given the styles module, when aggregating, then all layers and the mobile breakpoint are present', () => {
  assert.match(mobileFitCss, /@media \(max-width: 767px\)/)
  assert.match(mobileFitCss, /@media \(pointer: coarse\)/)
  // 关键修复点在场：侧栏 drawer 化与 rail 全隐、drawer 内容满宽、设置面板堆叠、
  // 代码块防溢出、IME 上浮变量
  assert.match(mobileFitCss, /_sidebarCol/)
  assert.match(mobileFitCss, /data-sidebar-collapsed/)
  assert.match(mobileFitCss, /_navList/)
  assert.match(mobileFitCss, /md-code-block/)
  assert.match(mobileFitCss, /--dsh-ime-inset/)
  // 无未替换占位
  assert.doesNotMatch(mobileFitCss, /TODO|FIXME|\{\{/)
})

test('given the layout layer, when inspecting IME float, then transform is gated behind the keyboard attribute', () => {
  // 常驻 transform 会让 composerSeat 成为 fixed 后代的包含块，浮层错位并撑高
  // 滚动区；transform 必须只在键盘弹出（html[data-dsh-ime]）期间挂载
  assert.match(mobileFitCss, /html\[data-dsh-ime\] \[class\*="_composerSeat"\]/)
  const unguarded = /(^|\})\s*\[class\*="_composerSeat"\][^{]*\{[^}]*transform/
  assert.doesNotMatch(mobileFitCss, unguarded)
})

test('given the conversation layer, when inspecting composer takeover cards, then footers wrap instead of clipping actions', () => {
  // 计划待审/提问卡片 footer 按钮组在窄屏被 overflow:hidden 裁剪的修复在场
  assert.match(mobileFitCss, /\[data-plan-review-key\] \[class\*="_footer"\]/)
  assert.match(mobileFitCss, /\[data-question-key\] \[class\*="_footer"\]/)
  assert.match(mobileFitCss, /\[data-approval-key\] \[class\*="_actionRow"\]/)
  assert.match(mobileFitCss, /\[data-question-key\] \[class\*="_footerActions"\][^{]*\{[^}]*flex-wrap: wrap/)
})

test('given the client module, when inspecting exports, then loader metadata is present', () => {
  assert.equal(name, 'dsh-plus-ui-mobile-fit')
  assert.equal(typeof apply, 'function')
})

function createFakeEnv() {
  const listeners = new Map()
  const tag = {
    dataset: {},
    textContent: '',
    removed: false,
    remove() {
      this.removed = true
    },
  }
  const meta = {
    content: 'width=device-width, initial-scale=1',
    getAttribute: () => meta.content,
    setAttribute: (_k, v) => {
      meta.content = v
    },
  }
  const document = {
    head: { appendChild: () => {} },
    querySelector: (sel) => (sel.includes('meta') ? meta : null),
    createElement: () => tag,
    activeElement: null,
    documentElement: {
      style: { setProperty: () => {}, removeProperty: () => {} },
      attrs: {},
      setAttribute(k, v) {
        this.attrs[k] = v
      },
      removeAttribute(k) {
        delete this.attrs[k]
      },
    },
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
  }
  const window = {
    matchMedia: () => ({ matches: false }),
    visualViewport: undefined,
  }
  return { document, window, tag, meta, listeners }
}

test('given a DOM, when apply runs, then style injected, viewport meta patched, cleanup restores', () => {
  const { document, window, tag, meta, listeners } = createFakeEnv()
  const disposers = []
  const ctx = { effect: (fn) => disposers.push(fn()) }
  const prevDoc = globalThis.document
  const prevWin = globalThis.window
  globalThis.document = document
  globalThis.window = window
  try {
    apply(ctx)
    assert.equal(tag.dataset.plugin, '@dsh-plus/ui-mobile-fit')
    assert.equal(tag.textContent, mobileFitCss)
    // IME 适配：viewport meta 已追加 interactive-widget
    assert.match(meta.content, /interactive-widget=resizes-content/)
    // 行为监听已注册
    assert.ok(listeners.has('focusin'))
    assert.ok(listeners.has('click'))
    disposers[0]()
    assert.equal(tag.removed, true)
    assert.equal(listeners.size, 0)
  } finally {
    globalThis.document = prevDoc
    globalThis.window = prevWin
  }
})

test('given no DOM, when apply runs, then it is a safe no-op', () => {
  const prev = globalThis.document
  delete globalThis.document
  try {
    apply({ effect: () => {} })
  } finally {
    globalThis.document = prev
  }
})

test('given behaviors installed twice, when meta already patched, then it is idempotent', () => {
  const { document, window, meta } = createFakeEnv()
  const prevDoc = globalThis.document
  const prevWin = globalThis.window
  globalThis.document = document
  globalThis.window = window
  try {
    const dispose = installBehaviors()
    installBehaviors()
    assert.equal(meta.content.match(/interactive-widget/g).length, 1)
    dispose()
  } finally {
    globalThis.document = prevDoc
    globalThis.window = prevWin
  }
})

test('given the keyboard opens and closes, when the visual viewport shrinks then restores, then the ime attribute toggles', () => {
  // 键盘弹出置 data-dsh-ime + --dsh-ime-inset，收起即移除——transform 不常驻
  class FakeInput {}
  class FakeTextarea {}
  const vvHandlers = new Map()
  const vv = {
    height: 500,
    offsetTop: 0,
    addEventListener: (t, fn) => vvHandlers.set(t, fn),
    removeEventListener: (t) => vvHandlers.delete(t),
  }
  const { document, window } = createFakeEnv()
  document.activeElement = new FakeInput()
  document.documentElement.style.vars = {}
  document.documentElement.style.setProperty = (k, v) => {
    document.documentElement.style.vars[k] = v
  }
  document.documentElement.style.removeProperty = (k) => {
    delete document.documentElement.style.vars[k]
  }
  window.matchMedia = () => ({ matches: true })
  window.visualViewport = vv
  window.innerHeight = 800
  const prevDoc = globalThis.document
  const prevWin = globalThis.window
  const prevInput = globalThis.HTMLInputElement
  const prevTextarea = globalThis.HTMLTextAreaElement
  globalThis.document = document
  globalThis.window = window
  globalThis.HTMLInputElement = FakeInput
  globalThis.HTMLTextAreaElement = FakeTextarea
  try {
    const dispose = installBehaviors()
    vvHandlers.get('resize')()
    assert.equal(document.documentElement.attrs[IME_ACTIVE_ATTR], '')
    assert.equal(document.documentElement.style.vars['--dsh-ime-inset'], '300px')
    vv.height = 800
    vvHandlers.get('resize')()
    assert.equal(IME_ACTIVE_ATTR in document.documentElement.attrs, false)
    assert.equal('--dsh-ime-inset' in document.documentElement.style.vars, false)
    dispose()
  } finally {
    globalThis.document = prevDoc
    globalThis.window = prevWin
    globalThis.HTMLInputElement = prevInput
    globalThis.HTMLTextAreaElement = prevTextarea
  }
})
