/**
 * 「重新加载」设置行：渲染面。状态机逻辑在 flow.ts，这里只做映射。
 * @module reload/client/row
 */
import type { ReactElement } from 'react'

import { useReloadFlow, type Flow, type Translate } from './flow.ts'

function Overlay({ children }: { children: ReactElement[] | ReactElement }): ReactElement {
  return (
    <div className="drl-overlay" role="dialog" aria-modal="true">
      <div className="drl-dialog">{children}</div>
    </div>
  )
}

function CountdownDialog({ flow, t }: { flow: Flow; t: Translate }): ReactElement | null {
  const phase = flow.phase
  if (phase.kind !== 'countdown') return null
  const blocked = phase.runningAgents > 0
  return (
    <Overlay>
      <h2 className="drl-dialogTitle">{t('countdownTitle')}</h2>
      <div className="drl-count">{phase.left}</div>
      <p className="drl-text">{phase.left}{t('countdownHint')}</p>
      {blocked && <p className="drl-warning">{t('agentsWarning').replace('{n}', String(phase.runningAgents))}</p>}
      <div className="drl-actions">
        <button type="button" className="drl-btn" onClick={flow.cancel}>{t('cancel')}</button>
        {blocked
          ? <button type="button" className="drl-btn drl-btnDanger" onClick={flow.forceRestart}>{t('agentsForce')}</button>
          : <button type="button" className="drl-btn drl-btnPrimary" onClick={flow.restartNow}>{t('restartNow')}</button>}
      </div>
    </Overlay>
  )
}

function StatusDialog({ flow, t }: { flow: Flow; t: Translate }): ReactElement | null {
  const phase = flow.phase
  if (phase.kind === 'preparing') {
    return <Overlay><p className="drl-text">{t('preparing')}</p></Overlay>
  }
  if (phase.kind === 'restarting') {
    return (
      <Overlay>
        <h2 className="drl-dialogTitle">{t('restartingTitle')}</h2>
        <p className="drl-text">{t('restartingHint')}</p>
      </Overlay>
    )
  }
  if (phase.kind === 'timeout') {
    return (
      <Overlay>
        <h2 className="drl-dialogTitle">{t('timeoutTitle')}</h2>
        <p className="drl-text">{t('timeoutHint')}</p>
        <div className="drl-actions">
          <button type="button" className="drl-btn" onClick={flow.dismiss}>{t('close')}</button>
          <button type="button" className="drl-btn drl-btnPrimary" onClick={flow.retry}>{t('retry')}</button>
        </div>
      </Overlay>
    )
  }
  if (phase.kind === 'failed') {
    return (
      <Overlay>
        {phase.title.length > 0 && <h2 className="drl-dialogTitle">{phase.title}</h2>}
        <ul className="drl-reasons">{phase.lines.map((line) => <li key={line}>{line}</li>)}</ul>
        <div className="drl-actions">
          <button type="button" className="drl-btn" onClick={flow.dismiss}>{t('close')}</button>
        </div>
      </Overlay>
    )
  }
  return null
}

export interface ReloadRowProps {
  t: Translate
}

export function ReloadRow({ t }: ReloadRowProps): ReactElement {
  const flow = useReloadFlow(t)
  const busy = flow.phase.kind !== 'idle'
  return (
    <div className="drl-group">
      <div className="drl-title">{t('title')}</div>
      <div className="drl-row">
        <p className="drl-description">{t('description')}</p>
        <button type="button" className="drl-btn drl-btnPrimary" disabled={busy} onClick={flow.start}>
          {t('action')}
        </button>
      </div>
      <CountdownDialog flow={flow} t={t} />
      <StatusDialog flow={flow} t={t} />
    </div>
  )
}
