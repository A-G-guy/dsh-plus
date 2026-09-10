import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import { attachAcceptFor, IME_ACTIVE_ATTR, installBehaviors } from '../src/behaviors.ts'
import { apply, name } from '../src/client.ts'
import { mobileFitCss } from '../src/styles.ts'

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
  assert.match(
    mobileFitCss,
    /\[data-question-key\] \[class\*="_footerActions"\][^{]*\{[^}]*flex-wrap: wrap/,
  )
})

test('given the conversation layer, when inspecting the mobile header, then the session log capsule shrinks so jobs and subagent entries stay tappable', () => {
  // 回归：顶栏 Session 日志胶囊（上游 min-width:111px）挤占横向空间，
  // 后台任务/子代理入口被挤出视口无法点按。窄屏必须压缩胶囊（图标化 +
  // 文案视觉隐藏保 a11y）、收紧工具区间距，并允许标题行换行兜底。
  assert.match(mobileFitCss, /\[class\*="_sessionLogButton"\][^{]*\{[^}]*min-width: 0/)
  assert.match(
    mobileFitCss,
    /\[class\*="_sessionLogButton"\] span[^{]*\{[^}]*clip-path: inset\(50%\)/,
  )
  assert.match(mobileFitCss, /\[class\*="_headerUtilities"\][^{]*\{[^}]*margin-left: 8px/)
  assert.match(mobileFitCss, /\[class\*="_titleRow"\][^{]*\{[^}]*flex-wrap: wrap/)
})

test('given the overlays layer, when inspecting tooltip handling, then coarse-pointer bubbles auto-hide', () => {
  // 触屏点按触发 Tooltip 的 mouseenter/focus 后无 mouseleave/blur 收尾，
  // 气泡常驻遮挡；修复 = coarse 媒体内给 _bubble[data-side] 挂自动淡出动画，
  // 终态 opacity:0 由 forwards 保持（勿用 visibility:hidden，Chrome 会在整个
  // 动画期间提前生效导致全程不可见）
  assert.match(
    mobileFitCss,
    /@media \(pointer: coarse\)[^{]*\{[^@]*span\[class\*="_bubble"\]\[data-side\]/,
  )
  assert.match(mobileFitCss, /@keyframes dsh-mobile-tooltip-autohide/)
  assert.match(
    mobileFitCss,
    /span\[class\*="_bubble"\]\[data-side\][^{]*\{[^}]*animation:[^}]*forwards/,
  )
  assert.doesNotMatch(mobileFitCss, /dsh-mobile-tooltip-autohide[\s\S]*visibility/)
})

test('given the client module, when inspecting exports, then loader metadata is present', () => {
  assert.equal(name, 'dsh-plus-ui-mobile-fit')
  assert.equal(typeof apply, 'function')
})

test('given the attach picker, then media keeps the official no-accept behavior and file uses a non-media accept list', () => {
  // 二次选择语义：相册=还原官方无 accept（系统媒体选择器）；文件=显式文件
  // 类型（不含 image/video，避免 Photo Picker 接管后只剩拍照/录像/相册）
  assert.equal(attachAcceptFor('media'), null)
  assert.equal(attachAcceptFor('file'), 'application/*,text/*')
  // 选择层样式在场（coarse 媒体 + 固定类名 + 官方变量）
  assert.match(mobileFitCss, /\.dsh-mobile-attach-picker[^{]*\{[^}]*position: fixed/)
  assert.match(
    mobileFitCss,
    /\.dsh-mobile-attach-picker button[^{]*\{[^}]*var\(--dsw-alias-label-primary\)/,
  )
})

/** 事件监听器替身：被测代码只把事件对象透传给回调，测试不约束载荷结构。 */
type Listener = (payload?: unknown) => void

/** 以下 Fake* 只声明被测代码（behaviors/client）实际访问的成员，作为替身的最小
 *  结构类型；挂到 globalThis 时再经 unknown 断言成平台类型（见 installFakeDom 处注释）。 */
interface FakeStyle {
  vars: Record<string, string>
  setProperty: (name: string, value: string) => void
  removeProperty: (name: string) => void
}

interface FakeDocumentElement {
  style: FakeStyle
  attrs: Record<string, string>
  lang?: string
  setAttribute: (name: string, value: string) => void
  removeAttribute: (name: string) => void
}

interface FakeTag {
  dataset: Record<string, string>
  textContent: string
  removed: boolean
  remove: () => void
}

interface FakeMeta {
  content: string
  getAttribute: () => string
  setAttribute: (name: string, value: string) => void
}

interface FakeVisualViewport {
  height: number
  offsetTop: number
  addEventListener: (type: string, fn: Listener) => void
  removeEventListener: (type: string) => void
}

interface FakeDocument {
  head: { appendChild: (node: unknown) => unknown }
  body: { children: unknown[]; appendChild: (node: unknown) => unknown }
  querySelector: (selector: string) => unknown
  querySelectorAll: (selector: string) => unknown[]
  createElement: (tagName: string) => unknown
  activeElement: unknown
  documentElement: FakeDocumentElement
  addEventListener: (type: string, fn: Listener) => void
  removeEventListener: (type: string) => void
}

interface FakeWindow {
  matchMedia: (query: string) => { matches: boolean }
  visualViewport: FakeVisualViewport | undefined
  innerHeight?: number
}

interface FakeEnv {
  document: FakeDocument
  window: FakeWindow
  tag: FakeTag
  meta: FakeMeta
  listeners: Map<string, Listener>
}

function createFakeEnv(): FakeEnv {
  const listeners = new Map<string, Listener>()
  const tag: FakeTag = {
    dataset: {},
    textContent: '',
    removed: false,
    remove() {
      this.removed = true
    },
  }
  const meta: FakeMeta = {
    content: 'width=device-width, initial-scale=1',
    getAttribute: () => meta.content,
    setAttribute: (_k, v) => {
      meta.content = v
    },
  }
  const document: FakeDocument = {
    head: { appendChild: () => {} },
    body: { children: [], appendChild: () => {} },
    querySelector: (sel) => (sel.includes('meta') ? meta : null),
    querySelectorAll: () => [],
    createElement: () => tag,
    activeElement: null,
    documentElement: {
      style: { vars: {}, setProperty: () => {}, removeProperty: () => {} },
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
  const window: FakeWindow = {
    matchMedia: () => ({ matches: false }),
    visualViewport: undefined,
  }
  return { document, window, tag, meta, listeners }
}

/** 把 DOM 替身挂到 globalThis 并返回还原函数：替身只实现被测代码真正访问的成员，
 *  调用点全部落在这些成员上（不触达平台类型的其余 250+ 成员），故断言安全。 */
function installFakeDom(fakeDocument: FakeDocument, fakeWindow: FakeWindow): () => void {
  const prevDoc = globalThis.document
  const prevWin = globalThis.window
  globalThis.document = fakeDocument as unknown as Document
  globalThis.window = fakeWindow as unknown as Window & typeof globalThis
  return () => {
    globalThis.document = prevDoc
    globalThis.window = prevWin
  }
}

test('given a DOM, when apply runs, then style injected, viewport meta patched, cleanup restores', () => {
  const { document, window, tag, meta, listeners } = createFakeEnv()
  const disposers: Array<() => void> = []
  // apply 只调用 ctx.effect（回调返回清理函数），替身满足该调用契约
  const ctx = { effect: (fn: () => () => void): number => disposers.push(fn()) }
  const restoreDom = installFakeDom(document, window)
  try {
    // 替身只提供 apply 用到的 effect 成员，经 unknown 断言成 Context 安全
    apply(ctx as unknown as Context)
    assert.equal(tag.dataset.plugin, '@dsh-plus/ui-mobile-fit')
    assert.equal(tag.textContent, mobileFitCss)
    // IME 适配：viewport meta 已追加 interactive-widget
    assert.match(meta.content, /interactive-widget=resizes-content/)
    // 行为监听已注册
    assert.ok(listeners.has('focusin'))
    assert.ok(listeners.has('click'))
    assert.ok(listeners.has('pointerup'))
    disposers[0]?.()
    assert.equal(tag.removed, true)
    assert.equal(listeners.size, 0)
  } finally {
    restoreDom()
  }
})

test('given no DOM, when apply runs, then it is a safe no-op', () => {
  const prev = globalThis.document
  // 与 delete 运算符等价，且不会触发"操作数必须可选"的类型错误
  Reflect.deleteProperty(globalThis, 'document')
  try {
    // 无 DOM 分支不会触达 effect，替身只需形状可接受 → 断言安全
    apply({ effect: () => {} } as unknown as Context)
  } finally {
    globalThis.document = prev
  }
})

test('given behaviors installed twice, when meta already patched, then it is idempotent', () => {
  const { document, window, meta } = createFakeEnv()
  const restoreDom = installFakeDom(document, window)
  try {
    const dispose = installBehaviors()
    installBehaviors()
    assert.equal(meta.content.match(/interactive-widget/g)?.length, 1)
    dispose()
  } finally {
    restoreDom()
  }
})

test('given the keyboard opens and closes, when the visual viewport shrinks then restores, then the ime attribute toggles', () => {
  // 键盘弹出置 data-dsh-ime + --dsh-ime-inset，收起即移除——transform 不常驻
  class FakeInput {}
  class FakeTextarea {}
  const vvHandlers = new Map<string, Listener>()
  const vv: FakeVisualViewport = {
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
  const restoreDom = installFakeDom(document, window)
  const prevInput = globalThis.HTMLInputElement
  const prevTextarea = globalThis.HTMLTextAreaElement
  // 构造器替身只供被测代码做 instanceof 判定，实例上不访问任何平台成员 → 断言安全
  globalThis.HTMLInputElement = FakeInput as unknown as typeof HTMLInputElement
  globalThis.HTMLTextAreaElement = FakeTextarea as unknown as typeof HTMLTextAreaElement
  try {
    const dispose = installBehaviors()
    vvHandlers.get('resize')?.()
    assert.equal(document.documentElement.attrs[IME_ACTIVE_ATTR], '')
    assert.equal(document.documentElement.style.vars['--dsh-ime-inset'], '300px')
    vv.height = 800
    vvHandlers.get('resize')?.()
    assert.equal(IME_ACTIVE_ATTR in document.documentElement.attrs, false)
    assert.equal('--dsh-ime-inset' in document.documentElement.style.vars, false)
    dispose()
  } finally {
    restoreDom()
    globalThis.HTMLInputElement = prevInput
    globalThis.HTMLTextAreaElement = prevTextarea
  }
})

test('given the composer is a contenteditable host, when a session switch focuses it without a gesture, then the focus is blurred (keyboard stays closed)', () => {
  // 回归：上游 composer 自 0.1.2-rc.1 为 Lexical contenteditable div（不再
  // 是 input/textarea），守卫只认 input/textarea 时整体失效——切会话即弹
  // 输入法。contenteditable 宿主同样必须被无手势聚焦拦截。
  class FakeElement {}
  class FakeHTMLElement extends FakeElement {}
  class FakeComposer extends FakeHTMLElement {
    isContentEditable = true
    blurred = 0
    closest(selector: string) {
      // 返回值只被被测代码做非 null 判定、不访问任何 DOM 成员 → 断言成 Element 安全
      return selector.includes('_composerSeat') ? ({ marker: 'seat' } as unknown as Element) : null
    }
    blur() {
      this.blurred += 1
    }
  }
  const { document, window, listeners } = createFakeEnv()
  window.matchMedia = () => ({ matches: true })
  const composer = new FakeComposer()
  const restoreDom = installFakeDom(document, window)
  const prevInput = globalThis.HTMLInputElement
  const prevTextarea = globalThis.HTMLTextAreaElement
  const prevHtmlel = globalThis.HTMLElement
  const prevElement = globalThis.Element
  // 构造器替身只供被测代码做 instanceof 判定，实例上不访问任何平台成员 → 断言安全
  globalThis.HTMLInputElement = FakeHTMLElement as unknown as typeof HTMLInputElement
  globalThis.HTMLTextAreaElement = FakeHTMLElement as unknown as typeof HTMLTextAreaElement
  globalThis.HTMLElement = FakeHTMLElement as unknown as typeof HTMLElement
  globalThis.Element = FakeElement as unknown as typeof Element
  try {
    const dispose = installBehaviors()
    // 无近期手势：程序化聚焦 contenteditable composer → 必须 blur
    listeners.get('focusin')?.({ target: composer })
    assert.equal(composer.blurred, 1)
    // 有近期手势（真实点按 composer 内部）：放行
    const pointerTarget = new FakeComposer()
    listeners.get('pointerdown')?.({ target: pointerTarget })
    listeners.get('focusin')?.({ target: pointerTarget })
    assert.equal(pointerTarget.blurred, 0)
    dispose()
  } finally {
    restoreDom()
    globalThis.HTMLInputElement = prevInput
    globalThis.HTMLTextAreaElement = prevTextarea
    globalThis.HTMLElement = prevHtmlel
    globalThis.Element = prevElement
  }
})

test('given a coarse pointer, when tapping the attachment button, then a picker opens and the chosen kind drives the accept on the same official input', () => {
  // 回归：官方附件按钮程序化 click 无 accept 的隐藏 file input，Android Photo
  // Picker 只给拍照/录像/相册。移动端拦截按钮点击 → 二次选择层：
  // - 相册：还原官方无 accept（媒体选择器）
  // - 文件：补文件类型 accept 后触发同一 input（onChange 等其余流程保持官方）
  class FakeElement {}
  class FakeInput extends FakeElement {
    accept: string | null = null
    clicks = 0
    getAttribute(name: string) {
      return name === 'accept' ? this.accept : null
    }
    setAttribute(name: string, value: string) {
      if (name === 'accept') this.accept = value
    }
    removeAttribute(name: string) {
      if (name === 'accept') this.accept = null
    }
    click() {
      this.clicks += 1
    }
  }
  class FakeButton extends FakeElement {
    ariaLabel: string
    parent: FakeRow | null = null
    constructor(label: string) {
      super()
      this.ariaLabel = label
    }
    get parentElement() {
      return this.parent
    }
    getAttribute(name: string) {
      return name === 'aria-label' ? this.ariaLabel : null
    }
    closest(selector: string) {
      return selector.includes('button') ? this : null
    }
  }
  class FakeRow extends FakeElement {
    input = new FakeInput()
    querySelector(selector: string) {
      return selector.includes('input') ? this.input : null
    }
  }
  // 可 append 的选择层节点（behaviors 动态创建）
  const created: Array<Record<string, unknown>> = []
  const { document, window, listeners } = createFakeEnv()
  window.matchMedia = () => ({ matches: true }) // coarse
  document.documentElement.lang = 'zh-CN'
  document.createElement = (tagName: string) => {
    if (tagName === 'style') return { dataset: {}, textContent: '', remove() {} }
    const node = {
      tagName,
      children: [] as unknown[],
      attrs: {} as Record<string, string>,
      textContent: '',
      listeners: {} as Record<string, Array<(payload?: unknown) => void>>,
      removed: false,
      type: '',
      className: '',
      setAttribute(k: string, v: string) {
        this.attrs[k] = v
      },
      getAttribute(k: string) {
        return this.attrs[k] ?? null
      },
      addEventListener(t: string, fn: (payload?: unknown) => void) {
        const bucket = this.listeners[t] ?? []
        this.listeners[t] = bucket
        bucket.push(fn)
      },
      append(...kids: unknown[]) {
        this.children.push(...kids)
      },
      remove() {
        this.removed = true
      },
      contains(node: unknown) {
        return node === this || this.children.includes(node)
      },
    }
    created.push(node)
    return node
  }
  document.body.appendChild = (node: unknown) => {
    document.body.children.push(node)
    return node
  }
  document.body.children = [] as unknown[]
  const row = new FakeRow()
  const button = new FakeButton('添加附件')
  button.parent = row
  const restoreDom = installFakeDom(document, window)
  const prevInput = globalThis.HTMLInputElement
  const prevHtmlel = globalThis.HTMLElement
  const prevElement = globalThis.Element
  // 构造器替身只供被测代码做 instanceof 判定，实例上不访问任何平台成员 → 断言安全
  globalThis.HTMLInputElement = FakeInput as unknown as typeof HTMLInputElement
  globalThis.HTMLElement = FakeElement as unknown as typeof HTMLElement
  globalThis.Element = FakeElement as unknown as typeof Element
  try {
    const dispose = installBehaviors()
    // 注意：createFakeEnv 的 listeners 按 type 单槽，click 注册顺序靠后的是
    // installAttachPicker；tapOutsideClose 在非窄屏直接返回。
    const capture = listeners.get('click')
    // 第一次点按：打开选择层（不设置 accept、不触发官方 input）
    capture?.({ target: button, preventDefault: () => {}, stopPropagation: () => {} })
    assert.equal(row.input.accept, null)
    assert.equal(row.input.clicks, 0)
    const layer = created.find((n) => n.className === 'dsh-mobile-attach-picker')
    assert.ok(layer !== undefined, 'picker layer should be created')
    const items = (layer as { children: unknown[] }).children as Array<{
      textContent: string
      listeners: Record<string, Array<(payload?: unknown) => void>>
    }>
    assert.equal(items.length, 2)
    assert.equal(items[0]?.textContent, '相册 / 拍照')
    assert.equal(items[1]?.textContent, '选择文件')
    // 选"文件"：accept 补文件类型并触发官方 input
    items[1]?.listeners['click']?.[0]?.()
    assert.equal(row.input.accept, 'application/*,text/*')
    assert.equal(row.input.clicks, 1)
    // 层已关闭
    assert.equal((layer as { removed: boolean }).removed, true)
    dispose()
  } finally {
    restoreDom()
    globalThis.HTMLInputElement = prevInput
    globalThis.HTMLElement = prevHtmlel
    globalThis.Element = prevElement
  }
})

test('given the picker is open, when tapping outside, then it closes without swallowing the event', () => {
  class FakeElement {}
  class FakeInput extends FakeElement {
    accept: string | null = null
    clicks = 0
    getAttribute(name: string) {
      return name === 'accept' ? this.accept : null
    }
    setAttribute(name: string, value: string) {
      if (name === 'accept') this.accept = value
    }
    removeAttribute(name: string) {
      if (name === 'accept') this.accept = null
    }
    click() {
      this.clicks += 1
    }
  }
  class FakeButton extends FakeElement {
    ariaLabel: string
    parent: FakeRow | null = null
    constructor(label: string) {
      super()
      this.ariaLabel = label
    }
    get parentElement() {
      return this.parent
    }
    getAttribute(name: string) {
      return name === 'aria-label' ? this.ariaLabel : null
    }
    closest(selector: string) {
      return selector.includes('button') ? this : null
    }
  }
  class FakeRow extends FakeElement {
    input = new FakeInput()
    querySelector(selector: string) {
      return selector.includes('input') ? this.input : null
    }
  }
  const created: Array<Record<string, unknown>> = []
  const { document, window, listeners } = createFakeEnv()
  window.matchMedia = () => ({ matches: true })
  document.documentElement.lang = 'en'
  document.createElement = (tagName: string) => {
    if (tagName === 'style') return { dataset: {}, textContent: '', remove() {} }
    const node = {
      tagName,
      children: [] as unknown[],
      attrs: {} as Record<string, string>,
      textContent: '',
      listeners: {} as Record<string, Array<(payload?: unknown) => void>>,
      removed: false,
      type: '',
      className: '',
      setAttribute(k: string, v: string) {
        this.attrs[k] = v
      },
      getAttribute(k: string) {
        return this.attrs[k] ?? null
      },
      addEventListener(t: string, fn: (payload?: unknown) => void) {
        const bucket = this.listeners[t] ?? []
        this.listeners[t] = bucket
        bucket.push(fn)
      },
      append(...kids: unknown[]) {
        this.children.push(...kids)
      },
      remove() {
        this.removed = true
      },
      contains(node: unknown) {
        return node === this || this.children.includes(node)
      },
    }
    created.push(node)
    return node
  }
  document.body.appendChild = (node: unknown) => {
    document.body.children.push(node)
    return node
  }
  document.body.children = [] as unknown[]
  const row = new FakeRow()
  const button = new FakeButton('Add attachment')
  button.parent = row
  const restoreDom = installFakeDom(document, window)
  const prevInput = globalThis.HTMLInputElement
  const prevHtmlel = globalThis.HTMLElement
  const prevElement = globalThis.Element
  // 构造器替身只供被测代码做 instanceof 判定，实例上不访问任何平台成员 → 断言安全
  globalThis.HTMLInputElement = FakeInput as unknown as typeof HTMLInputElement
  globalThis.HTMLElement = FakeElement as unknown as typeof HTMLElement
  globalThis.Element = FakeElement as unknown as typeof Element
  try {
    const dispose = installBehaviors()
    const capture = listeners.get('click')
    const noop = () => {}
    // 打开选择层
    capture?.({ target: button, preventDefault: noop, stopPropagation: noop })
    const layer = created.find((n) => n.className === 'dsh-mobile-attach-picker')
    assert.ok(layer !== undefined)
    // 层外点按：关闭层、不吞事件（未 preventDefault/stopPropagation）
    let stopped = false
    const outside = new FakeElement()
    capture?.({
      target: outside,
      preventDefault: noop,
      stopPropagation: () => {
        stopped = true
      },
    })
    assert.equal((layer as { removed: boolean }).removed, true)
    assert.equal(stopped, false)
    // 英文文案
    const items = (layer as { children: unknown[] }).children as Array<{ textContent: string }>
    assert.equal(items[0]?.textContent, 'Photos / Camera')
    assert.equal(items[1]?.textContent, 'Choose file')
    dispose()
  } finally {
    restoreDom()
    globalThis.HTMLInputElement = prevInput
    globalThis.HTMLElement = prevHtmlel
    globalThis.Element = prevElement
  }
})
