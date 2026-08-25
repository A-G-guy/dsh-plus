/**
 * xterm 视图：单叶渲染器。挂载 Terminal + FitAddon + WebLinksAddon，
 * ResizeObserver 驱动尺寸同步（容器变化 → fit → WS resize），
 * 主题从 --dsw-* 令牌读取并随深浅色切换热更新（官方深浅色经
 * body[data-ds-dark-theme] 切换，令牌只挂在 body 上，故必须读
 * body 计算样式并监听 body/html 属性 + 系统配色媒体查询），
 * 断线时遮罩显示重连状态。
 * @module web-terminal/panel/xterm-view
 */

import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal } from '@xterm/xterm'
import { useEffect, useRef } from 'react'

import type { TerminalConnection } from './connection.ts'
import type { ModifierStore } from './modifiers.ts'
import type { Translate } from './types.ts'

export interface XtermViewProps {
  sessionId: string
  running: boolean
  connection: TerminalConnection
  focused: boolean
  /** 移动端修饰键：onData 出口统一经 consume 变换（sticky-once）。 */
  modifiers: ModifierStore
  t: Translate
}

/** 浅色 ANSI 调色板（GitHub light 系）。 */
const LIGHT_ANSI = {
  red: '#d1242f',
  green: '#1a7f37',
  yellow: '#9a6700',
  blue: '#4d6bfe',
  magenta: '#8250df',
  cyan: '#1b7c83',
  brightRed: '#cf222e',
  brightGreen: '#2da44e',
  brightYellow: '#bf8700',
  brightBlue: '#5a7ffc',
  brightMagenta: '#a371f7',
  brightCyan: '#39c5cf',
} as const

/** 深色 ANSI 调色板（GitHub dark 系：深色底上保持可读对比度）。 */
const DARK_ANSI = {
  red: '#f85149',
  green: '#3fb950',
  yellow: '#d29922',
  blue: '#58a6ff',
  magenta: '#bc8cff',
  cyan: '#39c5cf',
  brightRed: '#ffa198',
  brightGreen: '#56d364',
  brightYellow: '#e3b341',
  brightBlue: '#79c0ff',
  brightMagenta: '#d2a8ff',
  brightCyan: '#56d4dd',
} as const

/** 解析计算后的颜色值并判断是否为深色背景（无法解析按浅色处理）。 */
function isDarkColor(value: string): boolean {
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim())
  const rgb = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(value.trim())
  let r: number
  let g: number
  let b: number
  if (hex !== null) {
    const packed = Number.parseInt(hex[1] ?? '0', 16)
    r = (packed >> 16) & 0xff
    g = (packed >> 8) & 0xff
    b = packed & 0xff
  } else if (rgb !== null) {
    r = Number(rgb[1])
    g = Number(rgb[2])
    b = Number(rgb[3])
  } else {
    return false
  }
  return 0.299 * r + 0.587 * g + 0.114 * b < 128
}

/** 从 CSS 令牌读 xterm 主题；深浅色切换由 body/html 属性监听 + 系统媒体查询承接。 */
function readTheme(): {
  theme: Record<string, string>
  fontFamily: string
  fontSize: number
} {
  // 深浅色令牌定义在 body[data-ds-dark-theme] 上，必须读 body 计算样式。
  const styles = getComputedStyle(document.body ?? document.documentElement)
  const read = (name: string, fallback: string): string =>
    styles.getPropertyValue(name).trim() || fallback
  const background = read('--dsw-alias-bg-base', '#ffffff')
  const foreground = read('--dsw-alias-label-primary', '#1f2328')
  const ansi = isDarkColor(background) ? DARK_ANSI : LIGHT_ANSI
  return {
    theme: {
      background,
      foreground,
      cursor: foreground,
      cursorAccent: background,
      selectionBackground: read('--dsw-alias-interactive-bg-active', 'rgba(77,107,254,0.25)'),
      black: foreground,
      ...ansi,
      white: read('--dsw-alias-label-secondary', '#57606a'),
      brightBlack: read('--dsw-alias-label-tertiary', '#8b949e'),
      brightWhite: foreground,
    },
    fontFamily: read(
      '--ds-font-family-code',
      'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    ),
    fontSize: 13,
  }
}

export function XtermView(props: XtermViewProps): React.ReactElement {
  const { sessionId, running, connection, focused, modifiers, t } = props
  const hostRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const connectionRef = useRef(connection)
  connectionRef.current = connection
  const modifiersRef = useRef(modifiers)
  modifiersRef.current = modifiers

  // 终端实例生命周期：创建 → attach → 清理。
  // biome-ignore lint/correctness/useExhaustiveDependencies: 实例仅按 sessionId 建立一次；connection/modifiers 经 ref 消费避免重建（重建会丢终端状态）
  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    const { theme, fontFamily, fontSize } = readTheme()
    const term = new Terminal({
      fontFamily,
      fontSize,
      theme: theme as never,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(host)
    fit.fit()
    termRef.current = term
    fitRef.current = fit

    const detach = connection.attach(sessionId, {
      onOutput: (data) => term.write(data),
      onReplay: (replay) => {
        term.reset()
        term.write(replay)
      },
      onExit: () => {
        term.write('\r\n\x1b[90m— session exited —\x1b[0m\r\n')
      },
    })
    term.onData((data) =>
      connectionRef.current.input(sessionId, modifiersRef.current.consume(data)),
    )

    const applySize = (): void => {
      fit.fit()
      connectionRef.current.resize(sessionId, term.cols, term.rows)
    }
    applySize()
    const observer = new ResizeObserver(() => applySize())
    observer.observe(host)

    // 深浅色切换：官方主题经 body[data-ds-dark-theme] 实现（令牌挂在 body），
    // 同时监听 html 属性与系统配色媒体查询兜底（auto 模式随系统切换）。
    const refresh = (): void => {
      const fresh = readTheme()
      term.options.theme = fresh.theme as never
      term.options.fontFamily = fresh.fontFamily
    }
    const themeObserver = new MutationObserver(refresh)
    // style 也在列：ThemePresenter 会把主题 token 覆写写进 body 内联样式
    themeObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ['data-ds-dark-theme', 'class', 'style'],
    })
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme'],
    })
    const colorScheme = window.matchMedia('(prefers-color-scheme: dark)')
    colorScheme.addEventListener('change', refresh)

    return () => {
      observer.disconnect()
      themeObserver.disconnect()
      colorScheme.removeEventListener('change', refresh)
      detach()
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [sessionId])

  // 焦点：成为焦点叶时聚焦终端（键盘输入进 PTY）。
  // biome-ignore lint/correctness/useExhaustiveDependencies: termRef 是稳定的 ref，聚焦动作不需要响应 ref 变化
  useEffect(() => {
    if (focused) termRef.current?.focus()
  }, [focused, sessionId])

  return (
    <div className="wt-pane-term">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: xterm 挂载点；点击聚焦是终端交互的一部分，键盘输入由内部 textarea 承载 */}
      <div
        ref={hostRef}
        className={`wt-term-host${focused ? ' wt-term-focused' : ''}`}
        onMouseDown={() => termRef.current?.focus()}
      />
      {!running && (
        <div className="wt-term-overlay">
          <span>{t('pane.exited').replace('{code}', '…')}</span>
        </div>
      )}
    </div>
  )
}
