/**
 * 移动端行为层：极少量 JS 胶水（非组件重实现），补足纯 CSS 无法表达的交互：
 * 1. IME 适配——meta viewport 追加 interactive-widget=resizes-content（Android），
 *    visualViewport 监听计算 --dsh-ime-inset 供 CSS 上浮 composer（iOS 兜底）；
 * 2. 屏蔽程序化自动聚焦——切换会话时不再弹出输入法，真实点按/键盘不受影响；
 * 3. 侧栏展开时点按中列（空白处）自动收起，首次点按被吞掉不穿透到下层内容。
 * 全部仅在窄屏（max-width: 767px）生效，自动聚焦/IME 额外要求 pointer: coarse。
 * @module @dsh-plus/ui-mobile-fit/behaviors
 */

const NARROW_QUERY = '(max-width: 767px)'
const COARSE_QUERY = '(pointer: coarse)'

const isNarrow = (): boolean => window.matchMedia(NARROW_QUERY).matches
const isCoarse = (): boolean => window.matchMedia(COARSE_QUERY).matches
const isTextField = (el: EventTarget | null): el is HTMLInputElement | HTMLTextAreaElement =>
  el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement

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
    const focused = isNarrow() && isCoarse() && isTextField(document.activeElement)
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

/** 上游 composer 在会话切换/解锁的 useEffect 里 el.focus()（conversation 包
 *  `locked || el === null` 分支），触屏上每切一次会话就弹一次输入法。
 *  这里只拦截 composer 容器内文本框的"无手势聚焦"：手势落点在 composer 之外
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
    if (isTextField(target) || target.closest(COMPOSER_SELECTOR) !== null) {
      allowUntil = Date.now() + GESTURE_WINDOW_MS
    }
  }
  const onKeyDown = (): void => {
    allowUntil = Date.now() + GESTURE_WINDOW_MS
  }
  const onFocusIn = (e: FocusEvent): void => {
    if (!isNarrow() || !isCoarse() || !isTextField(e.target)) return
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

/** 安装全部行为，返回统一清理函数。 */
export function installBehaviors(): Dispose {
  installViewportMeta()
  const disposes = [installImeInset(), installAutofocusGuard(), installTapOutsideClose()]
  return () => disposes.forEach((dispose) => dispose())
}
