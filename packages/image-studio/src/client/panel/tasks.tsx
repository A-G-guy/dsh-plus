/**
 * 任务条：面板底部的横向任务流（最新在左）。
 * 活跃任务（排队/生成中）带旋转标与取消按钮；已完成可一键跳画廊详情。
 * 轮询由面板根组件负责，本组件纯渲染。
 * @module image-studio/client/panel/tasks
 */
import { IconLoadingOutline16 } from '@dsh-plus/shared/client'
import type { ReactElement } from 'react'
import type { TaskWire } from '../../dto.ts'
import type { Translate } from '../i18n.ts'

interface TasksBarProps {
  t: Translate
  tasks: TaskWire[]
  onCancel(taskId: string): void
  onView(galleryItemId: string): void
}

const STATE_KEYS = {
  queued: 'tasks.state.queued',
  running: 'tasks.state.running',
  succeeded: 'tasks.state.succeeded',
  failed: 'tasks.state.failed',
  cancelled: 'tasks.state.cancelled',
} as const

export function TasksBar(props: TasksBarProps): ReactElement | null {
  const { t, tasks, onCancel, onView } = props
  if (tasks.length === 0) return null
  return (
    <section className="ims-tasks" aria-label={t('tasks.title')}>
      {tasks.slice(0, 20).map((task) => {
        const active = task.state === 'queued' || task.state === 'running'
        return (
          <div key={task.id} className={`ims-task ims-task-${task.state}`}>
            {active ? <IconLoadingOutline16 className="ims-spin" size={14} /> : null}
            <span className={`ims-taskState ims-taskState-${task.state}`}>
              {t(STATE_KEYS[task.state])}
            </span>
            <span className="ims-taskPrompt" title={task.promptPreview}>
              {task.promptPreview}
            </span>
            <span className="ims-taskModel">{task.model}</span>
            {active ? (
              <button
                type="button"
                className="ims-btn ims-btnGhost ims-btnSmall"
                onClick={() => onCancel(task.id)}
              >
                {t('common.cancel')}
              </button>
            ) : null}
            {task.state === 'succeeded' && task.galleryItemId !== null ? (
              <button
                type="button"
                className="ims-btn ims-btnGhost ims-btnSmall"
                onClick={() => onView(task.galleryItemId as string)}
              >
                {t('tasks.view')}
              </button>
            ) : null}
            {task.state === 'failed' && task.error !== null ? (
              <span className="ims-taskError" title={task.error}>
                {task.error}
              </span>
            ) : null}
          </div>
        )
      })}
    </section>
  )
}
