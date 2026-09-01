/**
 * 会话变量面板的 overlay 宿主（conversation.input.overlay 官方插槽，
 * session 作用域）：常驻监听打开总线，/var 命令选中后弹出面板。
 * 弹层定位于 composer 卡片上方（与 $ 菜单同一浮层语言）；
 * 点外部或 Esc 关闭。闭合态不渲染面板（数据在打开时现取）。
 * @module secret-env/client/panel-host
 */
import { type ReactElement, useEffect, useRef, useState } from 'react'

import { SessionSecretsPanel } from './panel.tsx'
import { onOpenSessionPanel } from './panel-bus.ts'

export interface SessionPanelHostProps {
  /** 插槽 inject 工厂注入的当前会话 id。 */
  sessionId: string
  t(key: string): string
}

export function SessionPanelHost(props: SessionPanelHostProps): ReactElement | null {
  const { sessionId, t } = props
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  // 打开总线：只响应本会话的定向信号。
  useEffect(
    () =>
      onOpenSessionPanel((target) => {
        if (target === sessionId) setOpen(true)
      }),
    [sessionId],
  )

  // Esc / 点外部关闭（捕获阶段，先于编辑器吞键）。
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
    }
    const onDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Node)) return
      if (wrapRef.current?.contains(event.target) === true) return
      setOpen(false)
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onDown, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', onDown, true)
    }
  }, [open])

  if (!open) return null
  return (
    <div className="dse-panelWrap" ref={wrapRef}>
      <div className="dse-panelCard" role="dialog" aria-label={t('sessionSecrets')}>
        <SessionSecretsPanel sessionId={sessionId} t={t} onClose={() => setOpen(false)} />
      </div>
    </div>
  )
}
