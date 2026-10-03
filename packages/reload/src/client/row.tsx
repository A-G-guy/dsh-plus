/**
 * 「重新加载」设置行：渲染面。状态机逻辑在 flow.ts，这里只做映射。
 * 主动作是进程内重载（默认，零中断），「重启服务」是次级动作（供换包等
 * 只能重启的变更）；结果对话框里的 host 原文按 pre-line 原样呈现。
 * @module reload/client/row
 */
import type { ReactElement, ReactNode } from 'react'

import { type Flow, type Translate, useReloadFlow } from './flow.ts'
import { isDesktopRuntime } from './runtime.ts'

/** children 按 React 自身契约声明为 ReactNode：条件渲染会产出 false/null。 */
function Overlay({ children }: { children: ReactNode }): ReactElement {
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
      <p className="drl-text">
        {phase.left}
        {t('countdownHint')}
      </p>
      {blocked && (
        <p className="drl-warning">
          {t('agentsWarning').replace('{n}', String(phase.runningAgents))}
        </p>
      )}
      <div className="drl-actions">
        <button type="button" className="drl-btn" onClick={flow.cancel}>
          {t('cancel')}
        </button>
        {blocked ? (
          <button type="button" className="drl-btn drl-btnDanger" onClick={flow.forceRestart}>
            {t('agentsForce')}
          </button>
        ) : (
          <button type="button" className="drl-btn drl-btnPrimary" onClick={flow.restartNow}>
            {t('restartNow')}
          </button>
        )}
      </div>
    </Overlay>
  )
}

/** 运行中会话防线：询问是否强制进程内重载（避免默认打断正在跑的会话）。 */
function ForceAskDialog({ flow, t }: { flow: Flow; t: Translate }): ReactElement | null {
  const phase = flow.phase
  if (phase.kind !== 'forceAsk') return null
  return (
    <Overlay>
      <h2 className="drl-dialogTitle">{t('forceTitle')}</h2>
      <p className="drl-warning">{t('forceWarning').replace('{n}', String(phase.runningAgents))}</p>
      <div className="drl-actions">
        <button type="button" className="drl-btn" onClick={flow.dismiss}>
          {t('forceWait')}
        </button>
        <button type="button" className="drl-btn drl-btnDanger" onClick={flow.applyForce}>
          {t('forceRun')}
        </button>
      </div>
    </Overlay>
  )
}

/**
 * 结果对话框：进程内重载报告（`result`，可按需直达重启）与重启通道自身失败
 * 报告（`report`）共用同一渲染面。
 */
function ResultDialog({ flow, t }: { flow: Flow; t: Translate }): ReactElement | null {
  const phase = flow.phase
  if (phase.kind !== 'result' && phase.kind !== 'report') return null
  const title =
    phase.kind === 'report'
      ? t('failedTitle')
      : phase.status === 'applied'
        ? t('appliedTitle')
        : phase.status === 'unsupported'
          ? t('unsupportedTitle')
          : t('failedTitle')
  const canRestart = phase.kind === 'result' && phase.pendingRestart.length > 0
  return (
    <Overlay>
      <h2 className="drl-dialogTitle">{title}</h2>
      <p className="drl-text drl-multiline">{phase.text}</p>
      <div className="drl-actions">
        <button type="button" className="drl-btn" onClick={flow.dismiss}>
          {t('close')}
        </button>
        {canRestart && (
          <button
            type="button"
            className="drl-btn drl-btnPrimary"
            onClick={() => {
              flow.dismiss()
              flow.startRestart()
            }}
          >
            {t('restartAction')}
          </button>
        )}
      </div>
    </Overlay>
  )
}

function StatusDialog({ flow, t }: { flow: Flow; t: Translate }): ReactElement | null {
  const phase = flow.phase
  if (phase.kind === 'applying') {
    return (
      <Overlay>
        <p className="drl-text">{t('applying')}</p>
      </Overlay>
    )
  }
  if (phase.kind === 'preparing') {
    return (
      <Overlay>
        <p className="drl-text">{t('preparing')}</p>
      </Overlay>
    )
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
          <button type="button" className="drl-btn" onClick={flow.dismiss}>
            {t('close')}
          </button>
          <button type="button" className="drl-btn drl-btnPrimary" onClick={flow.retry}>
            {t('retry')}
          </button>
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
  const busy = flow.phase.kind === 'applying' || flow.phase.kind === 'preparing'
  // 桌面端由 Electron 应用管理生命周期，无系统级重启通道：只保留进程内重载，
  // 「重启服务」置灰并给平台化说明（服务端预检同样会拒绝，见 preflight）。
  const desktop = isDesktopRuntime()
  return (
    <div className="drl-group">
      <div className="drl-title">{t('title')}</div>
      <div className="drl-row">
        <p className="drl-description">{desktop ? t('desktopHint') : t('description')}</p>
        <button
          type="button"
          className="drl-btn"
          disabled={busy || desktop}
          onClick={flow.startRestart}
        >
          {t('restartAction')}
        </button>
        <button
          type="button"
          className="drl-btn drl-btnPrimary"
          disabled={busy}
          onClick={flow.apply}
        >
          {t('action')}
        </button>
      </div>
      <CountdownDialog flow={flow} t={t} />
      <ForceAskDialog flow={flow} t={t} />
      <ResultDialog flow={flow} t={t} />
      <StatusDialog flow={flow} t={t} />
    </div>
  )
}
