/**
 * 移动端修饰键（Termux 风格 sticky 语义）：Ctrl/Alt/Shift 开关状态 +
 * 对外发数据的一次性变换。UI 工具栏（keybar）负责切换与渲染，
 * xterm 输入路径与工具栏按键统一经 consume 出口，任意一次发送后
 * 全部修饰键自动复位（sticky-once）。
 * 纯逻辑独立成模块便于单测（无 DOM 依赖）。
 * @module web-terminal/panel/modifiers
 */

export type ModifierKey = 'ctrl' | 'alt' | 'shift'

export interface ModifierSnapshot {
  ctrl: boolean
  alt: boolean
  shift: boolean
}

const IDLE: ModifierSnapshot = { ctrl: false, alt: false, shift: false }

/** Ctrl 映射：@ [\]^_ → 0x00-0x1f，a-z 视同 A-Z，? → DEL。 */
function ctrlCode(char: string): string | null {
  if (char === '?') return '\x7f'
  const code = char.toUpperCase().charCodeAt(0)
  if (code >= 0x40 && code <= 0x5f) return String.fromCharCode(code - 0x40)
  return null
}

/** CSI 末字节 → 修饰参数编码（xterm 约定：1 + shift1 + alt2 + ctrl4）。 */
const CSI_FINALS = new Set(['A', 'B', 'C', 'D', 'F', 'H', 'Z'])

function modifierParam(mods: ModifierSnapshot): number {
  return 1 + (mods.shift ? 1 : 0) + (mods.alt ? 2 : 0) + (mods.ctrl ? 4 : 0)
}

/**
 * 把修饰键应用到一段待发数据：
 * - 单字符：Ctrl 转控制字节（可映射时优先），Shift 大写，Alt 加 ESC 前缀；
 * - Tab：Shift 按下 → 反向制表（CSI Z）；
 * - 方向/Home/End 等三元 CSI 序列：改写为修饰编码（如 Ctrl+← = CSI 1;5D）；
 * - 其余（含无任何修饰）原样返回。
 */
export function applyModifiers(data: string, mods: ModifierSnapshot): string {
  if (data.length === 1) {
    if (data === '\t') return mods.shift ? '\x1b[Z' : data
    if (mods.ctrl) {
      const code = ctrlCode(data)
      if (code !== null) return mods.alt ? `\x1b${code}` : code
    }
    let out = mods.shift ? data.toUpperCase() : data
    if (mods.alt) out = `\x1b${out}`
    return out
  }
  if (data.length === 3 && data.startsWith('\x1b[') && CSI_FINALS.has(data[2] ?? '')) {
    if (mods.ctrl || mods.alt || mods.shift) {
      return `\x1b[1;${modifierParam(mods)}${data[2]}`
    }
  }
  return data
}

type Listener = () => void

/** 修饰键状态容器：useSyncExternalStore 直读，consume 一次性复位。 */
export class ModifierStore {
  private state: ModifierSnapshot = IDLE
  private listeners = new Set<Listener>()

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): ModifierSnapshot => this.state

  toggle(key: ModifierKey): void {
    this.state = { ...this.state, [key]: !this.state[key] }
    this.publish()
  }

  /** 应用修饰并复位（有任一修饰激活才发布，避免无意义重渲染）。 */
  consume(data: string): string {
    const out = applyModifiers(data, this.state)
    if (this.state.ctrl || this.state.alt || this.state.shift) {
      this.state = IDLE
      this.publish()
    }
    return out
  }

  private publish(): void {
    for (const listener of [...this.listeners]) listener()
  }
}
