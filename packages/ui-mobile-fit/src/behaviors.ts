/**
 * 移动端行为层：极少量 JS 胶水（非组件重实现），补足纯 CSS 无法表达的交互：
 * 1. IME 适配——meta viewport 追加 interactive-widget=resizes-content（Android），
 *    visualViewport 监听计算 --dsh-ime-inset 供 CSS 上浮 composer（iOS 兜底）；
 * 2. 屏蔽程序化自动聚焦——切换会话时不再弹出输入法，真实点按/键盘不受影响；
 * 3. 侧栏展开时点按中列（空白处）自动收起，首次点按被吞掉不穿透到下层内容；
 * 4. 触屏 Tooltip 复位——点按 2.2s 后补发合成 mouseout/blur，使提示气泡
 *    真正移除且下次点按可重新短暂提示（配合 overlays.ts 的淡出动画）。
 * 全部仅在窄屏（max-width: 767px）生效，自动聚焦/IME/Tooltip 复位额外要求
 * pointer: coarse（Tooltip 复位不限窄屏，宽屏触屏同样有驻留问题）。
 * @module @dsh-plus/ui-mobile-fit/behaviors
 */

const NARROW_QUERY = '(max-width: 767px)'
const COARSE_QUERY = '(pointer: coarse)'

const isNarrow = (): boolean => window.matchMedia(NARROW_QUERY).matches
const isCoarse = (): boolean => window.matchMedia(COARSE_QUERY).matches

/** 可编辑宿主：经典 input/textarea，或 contenteditable 宿主（上游 composer
 *  自 0.1.2-rc.1 起为 Lexical 编辑器，根元素是 div[contenteditable]——
 *  只认 input/textarea 会让守卫整体失效，切会话即弹输入法）。 */
const isEditableTarget = (el: EventTarget | null): boolean => {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return true
  return el instanceof HTMLElement && el.isContentEditable === true
}

type Dispose = () => void

/** meta viewport 追加 interactive-widget=resizes-content，使 Android Chrome 在
 *  输入法弹出时收缩布局视口，底部 composer 随布局上浮。 */
function installViewportMeta(): void {
  const meta = document.querySelector('meta[name="viewport"]')
  if (meta === null) return
  const content = meta.getAttribute('content') ?? ''
  if (!content.includes('interactive-widget')) {
    meta.setAttribute('content', `${content}, interactive-widget=resizes-content`)
  }
}

/** 键盘弹出期间挂在 <html> 上的标记：CSS 仅在此期间为 composer 挂 transform。
 *  常驻 transform（哪怕 translateY(0)）会让 composerSeat 成为 position:fixed
 *  后代的包含块，使其内的 tooltip 等浮层锚定错位并撑高滚动区。 */
export const IME_ACTIVE_ATTR = 'data-dsh-ime'

/** iOS 兜底：文本框聚焦且视觉视口被压缩时，把键盘高度写入 --dsh-ime-inset 并
 *  置 IME_ACTIVE_ATTR，CSS 据此 translate composer；键盘收起（或 Android 上
 *  布局已收缩、计算结果为 0）时两者一并移除，composer 恢复无 transform 状态。 */
function installImeInset(): Dispose {
  const vv = window.visualViewport
  if (vv === undefined || vv === null) return () => {}
  const root = document.documentElement
  const update = (): void => {
    const focused = isNarrow() && isCoarse() && isEditableTarget(document.activeElement)
    const inset = focused ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0
    if (inset > 0) {
      root.style.setProperty('--dsh-ime-inset', `${Math.round(inset)}px`)
      root.setAttribute(IME_ACTIVE_ATTR, '')
    } else {
      root.style.removeProperty('--dsh-ime-inset')
      root.removeAttribute(IME_ACTIVE_ATTR)
    }
  }
  vv.addEventListener('resize', update)
  vv.addEventListener('scroll', update)
  return () => {
    vv.removeEventListener('resize', update)
    vv.removeEventListener('scroll', update)
    root.style.removeProperty('--dsh-ime-inset')
    root.removeAttribute(IME_ACTIVE_ATTR)
  }
}

/** 上游 composer 在会话切换/解锁的 useEffect 里 editor.getRootElement()?.focus()
 *  （conversation 包 `locked || editor === null` 分支），触屏上每切一次会话就弹
 *  一次输入法。composer 根元素是 Lexical 的 contenteditable div（data-composer-input，
 *  0.1.2-rc.1 基线，此前为 input/textarea——isEditableTarget 两种都认）。
 *  这里只拦截 composer 容器内可编辑宿主的"无手势聚焦"：手势落点在 composer 之外
 *  （如侧栏会话标题）时，随后的程序化 focus 一律 blur；直点输入框不受影响。
 *  composer 之外的输入框（重命名、设置项等）本来就是用户主动触达，不拦截。 */
const COMPOSER_SELECTOR =
  '[class*="_composerSeat"], [class*="_composerHero"], [class*="_composerStack"]'
const GESTURE_WINDOW_MS = 800

function installAutofocusGuard(): Dispose {
  let allowUntil = 0
  const onPointerDown = (e: PointerEvent): void => {
    const target = e.target
    if (!(target instanceof Element)) return
    if (isEditableTarget(target) || target.closest(COMPOSER_SELECTOR) !== null) {
      allowUntil = Date.now() + GESTURE_WINDOW_MS
    }
  }
  const onKeyDown = (): void => {
    allowUntil = Date.now() + GESTURE_WINDOW_MS
  }
  const onFocusIn = (e: FocusEvent): void => {
    if (!isNarrow() || !isCoarse() || !isEditableTarget(e.target)) return
    if (e.target.closest(COMPOSER_SELECTOR) === null) return
    if (Date.now() < allowUntil) return
    e.target.blur()
  }
  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('keydown', onKeyDown, true)
  document.addEventListener('focusin', onFocusIn, true)
  return () => {
    document.removeEventListener('pointerdown', onPointerDown, true)
    document.removeEventListener('keydown', onKeyDown, true)
    document.removeEventListener('focusin', onFocusIn, true)
  }
}

/** 侧栏展开时，点按中列任意位置收起侧栏（吞掉该次点按，模拟 drawer 背板）。 */
function installTapOutsideClose(): Dispose {
  const onClick = (e: MouseEvent): void => {
    if (!isNarrow()) return
    const frame = document.querySelector('[class*="_frame"]')
    if (frame === null || frame.hasAttribute('data-sidebar-collapsed')) return
    const target = e.target
    if (!(target instanceof Element)) return
    if (target.closest('[class*="_centerCol"]') === null) return
    e.preventDefault()
    e.stopPropagation()
    frame.querySelector<HTMLElement>('[class*="_sidebarCol"] [class*="_toggle"]')?.click()
  }
  document.addEventListener('click', onClick, true)
  return () => document.removeEventListener('click', onClick, true)
}

/** 触屏附件按钮修复：官方附件按钮（0.1.3-alpha.2 基线的"添加附件"回形针）
 *  程序化 click 一个【无 accept】的隐藏 file input。Android（含 Photo Picker
 *  的版本）与 iOS 对 accept 为空或仅含 image/video 的文件框只给"拍照/录像/
 *  相册"，不给"选择文件"；补宽泛 accept 后系统选择器恢复文件入口。
 *  双保险：
 *  1. MutationObserver 常驻：composer 内出现/重挂 file input 立即补 accept，
 *     不依赖点击时序、不受事件拦截影响（React 重渲染不会清理未知属性）；
 *  2. document 捕获 click：官方 onClick（React 根委托）之前再补一次。
 *  选择器失配时静默降级，不影响原生行为。 */
const ATTACH_LABELS = ['添加附件', 'Add attachment']
const FILE_ACCEPT = '*/*'

/** 给附件 file input 补宽泛 accept（幂等）。 */
function ensureFileInputAccept(input: HTMLInputElement): void {
  if (input.getAttribute('accept') !== FILE_ACCEPT) {
    input.setAttribute('accept', FILE_ACCEPT)
  }
}

/** 扫描并修复范围内所有 composer 内的 file input（observer 回调与首扫共用）。 */
function applyFileAcceptScan(root: ParentNode): void {
  for (const input of root.querySelectorAll<HTMLInputElement>('input[type="file"]')) {
    if (input.closest(COMPOSER_SELECTOR) !== null) ensureFileInputAccept(input)
  }
}

function installFileInputAcceptFix(): Dispose {
  const onClick = (e: MouseEvent): void => {
    if (!isCoarse()) return
    const target = e.target
    if (!(target instanceof Element)) return
    const button = target.closest<HTMLElement>('button[aria-label]')
    if (button === null) return
    const label = button.getAttribute('aria-label')
    if (label === null || !ATTACH_LABELS.includes(label)) return
    const input = button.parentElement?.querySelector<HTMLInputElement>('input[type="file"]')
    if (input === null || input === undefined) return
    ensureFileInputAccept(input)
  }
  if (document.body !== null && document.body !== undefined) {
    applyFileAcceptScan(document)
    const observer =
      typeof MutationObserver === 'undefined'
        ? null
        : new MutationObserver(() => applyFileAcceptScan(document))
    observer?.observe(document.body, { childList: true, subtree: true })
    document.addEventListener('click', onClick, true)
    return () => {
      document.removeEventListener('click', onClick, true)
      observer?.disconnect()
    }
  }
  document.addEventListener('click', onClick, true)
  return () => document.removeEventListener('click', onClick, true)
}

/** 触屏 Tooltip 复位：点按后 React 侧 hover/focus 标志常驻（触屏无
 *  mouseleave/blur 收尾），overlays.ts 的淡出动画只能让气泡消失一次——
 *  气泡 span 不重挂，再次点按同一按钮时提示不再出现。点按 2.2s 后若气泡
 *  仍存在，补发合成 mouseout + blur 使 Tooltip 状态归零（同时真正移除
 *  气泡 DOM），下次点按可重新短暂提示。仅 coarse 指针生效。 */
const TOOLTIP_RESET_MS = 2200
const TOOLTIP_BUBBLE_SELECTOR = 'span[class*="_bubble"][data-side]'

function installTooltipReset(): Dispose {
  let timer: ReturnType<typeof setTimeout> | null = null
  const onPointerUp = (e: PointerEvent): void => {
    if (!isCoarse() || e.pointerType !== 'touch') return
    const target = e.target
    if (!(target instanceof Element)) return
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      if (document.querySelector(TOOLTIP_BUBBLE_SELECTOR) === null) return
      target.dispatchEvent(
        new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.documentElement }),
      )
      const active = document.activeElement
      if (active instanceof HTMLElement && !isTextField(active)) active.blur()
    }, TOOLTIP_RESET_MS)
  }
  document.addEventListener('pointerup', onPointerUp, true)
  return () => {
    if (timer !== null) clearTimeout(timer)
    document.removeEventListener('pointerup', onPointerUp, true)
  }
}

/** 安装全部行为，返回统一清理函数。 */
export function installBehaviors(): Dispose {
  installViewportMeta()
  const disposes = [
    installImeInset(),
    installAutofocusGuard(),
    installTapOutsideClose(),
    installFileInputAcceptFix(),
    installTooltipReset(),
  ]
  return () => {
    for (const dispose of disposes) dispose()
  }
}
