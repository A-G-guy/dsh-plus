/**
 * xterm 视图：单叶渲染器。挂载 Terminal + FitAddon + WebLinksAddon，
 * ResizeObserver 驱动尺寸同步（容器变化 → fit → WS resize），
 * 主题从 --dsw-* 令牌读取并随深浅色切换重建（MutationObserver 监听
 * html 元素属性变化），断线时遮罩显示重连状态。
 * @module web-terminal/panel/xterm-view
 */

import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal } from '@xterm/xterm'
import { useEffect, useRef } from 'react'

import type { TerminalConnection } from './connection.ts'
import type { Translate } from './types.ts'

export interface XtermViewProps {
  sessionId: string
  running: boolean
  connection: TerminalConnection
  focused: boolean
  t: Translate
}

/** 从 CSS 令牌读 xterm 主题；深浅色切换由重建实例承接。 */
function readTheme(): {
  theme: Record<string, string>
  fontFamily: string
  fontSize: number
} {
  const styles = getComputedStyle(document.documentElement)
  const read = (name: string, fallback: string): string =>
    styles.getPropertyValue(name).trim() || fallback
  return {
    theme: {
      background: read('--dsw-alias-bg-canvas', '#ffffff'),
      foreground: read('--dsw-alias-label-primary', '#1f2328'),
      cursor: read('--dsw-alias-label-primary', '#1f2328'),
      cursorAccent: read('--dsw-alias-bg-canvas', '#ffffff'),
      selectionBackground: read('--dsw-alias-interactive-bg-active', 'rgba(77,107,254,0.25)'),
      black: read('--dsw-alias-label-primary', '#1f2328'),
      red: '#d1242f',
      green: '#1a7f37',
      yellow: '#9a6700',
      blue: '#4d6bfe',
      magenta: '#8250df',
      cyan: '#1b7c83',
      white: read('--dsw-alias-label-secondary', '#57606a'),
      brightBlack: read('--dsw-alias-label-tertiary', '#8b949e'),
      brightRed: '#cf222e',
      brightGreen: '#2da44e',
      brightYellow: '#bf8700',
      brightBlue: '#5a7ffc',
      brightMagenta: '#a371f7',
      brightCyan: '#39c5cf',
      brightWhite: read('--dsw-alias-label-primary', '#1f2328'),
    },
    fontFamily: read(
      '--dsw-alias-font-mono',
      'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    ),
    fontSize: 13,
  }
}

export function XtermView(props: XtermViewProps): React.ReactElement {
  const { sessionId, running, connection, focused, t } = props
  const hostRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const connectionRef = useRef(connection)
  connectionRef.current = connection

  // 终端实例生命周期：创建 → attach → 清理。
  // biome-ignore lint/correctness/useExhaustiveDependencies: 实例仅按 sessionId 建立一次；connection 经 ref 消费避免重建（重建会丢终端状态）
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
    term.onData((data) => connectionRef.current.input(sessionId, data))

    const applySize = (): void => {
      fit.fit()
      connectionRef.current.resize(sessionId, term.cols, term.rows)
    }
    applySize()
    const observer = new ResizeObserver(() => applySize())
    observer.observe(host)

    // 深浅色切换：官方主题经 html 元素 data 属性/类切换实现，监听属性变化重建主题。
    const themeObserver = new MutationObserver(() => {
      const fresh = readTheme()
      term.options.theme = fresh.theme as never
      term.options.fontFamily = fresh.fontFamily
    })
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme'],
    })

    return () => {
      observer.disconnect()
      themeObserver.disconnect()
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
