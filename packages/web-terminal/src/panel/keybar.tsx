/**
 * 移动端浮动工具栏（类 Termux extra-keys）：固定在面板底部，输入法
 * 弹出时经 visualViewport 计算键盘高度上浮到其上方；提供移动端键盘
 * 缺失的 Esc/Tab/方向键与 Ctrl/Alt/Shift 粘性修饰键（按下后下一次
 * 输入经 ModifierStore.consume 变换，见 ./modifiers.ts）。
 * 仅窄屏（≤767px）渲染；按钮 pointerdown preventDefault 保持 xterm
 * 焦点，避免点按键时收起输入法。
 * @module web-terminal/panel/keybar
 */
import { type ReactElement, useEffect, useState, useSyncExternalStore } from 'react'

import type { DictKey } from '../locales.ts'
import type { ModifierKey, ModifierStore } from './modifiers.ts'
import type { Translate } from './types.ts'

export interface MobileKeybarProps {
  modifiers: ModifierStore
  /** 发送一段（已经 consume 变换的）终端输入到当前焦点会话。 */
  onSend: (data: string) => void
  t: Translate
}

interface KeyDef {
  id: string
  label: string
  /** 修饰键开关；普通键为待发送数据。 */
  modifier?: ModifierKey
  data?: string
  ariaKey: DictKey
}

const KEYS: KeyDef[] = [
  { id: 'esc', label: 'Esc', data: '\x1b', ariaKey: 'keybar.esc' },
  { id: 'tab', label: 'Tab', data: '\t', ariaKey: 'keybar.tab' },
  { id: 'ctrl', label: 'Ctrl', modifier: 'ctrl', ariaKey: 'keybar.ctrl' },
  { id: 'alt', label: 'Alt', modifier: 'alt', ariaKey: 'keybar.alt' },
  { id: 'shift', label: 'Shift', modifier: 'shift', ariaKey: 'keybar.shift' },
  { id: 'left', label: '←', data: '\x1b[D', ariaKey: 'keybar.left' },
  { id: 'up', label: '↑', data: '\x1b[A', ariaKey: 'keybar.up' },
  { id: 'down', label: '↓', data: '\x1b[B', ariaKey: 'keybar.down' },
  { id: 'right', label: '→', data: '\x1b[C', ariaKey: 'keybar.right' },
]

/** 输入法弹出高度（px）：视觉视口相对布局视口的底部缺口；桌面/收起为 0。 */
function useImeInset(): number {
  const [inset, setInset] = useState(0)
  useEffect(() => {
    const viewport = window.visualViewport
    if (viewport === undefined || viewport === null) return
    const update = (): void => {
      setInset(Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop)))
    }
    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
    }
  }, [])
  return inset
}

export function MobileKeybar({ modifiers, onSend, t }: MobileKeybarProps): ReactElement {
  const active = useSyncExternalStore(modifiers.subscribe, modifiers.getSnapshot)
  const imeInset = useImeInset()
  return (
    <div
      className="wt-keybar"
      role="toolbar"
      aria-label={t('keybar.label')}
      style={imeInset > 0 ? { bottom: imeInset } : undefined}
    >
      {KEYS.map((key) => {
        const on = key.modifier !== undefined && active[key.modifier]
        return (
          <button
            key={key.id}
            type="button"
            className={`wt-keybar-key${on ? ' wt-keybar-key-active' : ''}`}
            aria-label={t(key.ariaKey)}
            aria-pressed={key.modifier !== undefined ? on : undefined}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => {
              if (key.modifier !== undefined) modifiers.toggle(key.modifier)
              else if (key.data !== undefined) onSend(key.data)
            }}
          >
            {key.label}
          </button>
        )
      })}
    </div>
  )
}
