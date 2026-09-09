/**
 * 图像工作室面板根组件：侧栏 footer 入口打开的 overlay 工作台。
 * 三个标签（文生图/图生图/画廊）+ 底部任务条；两个生图表单常驻挂载
 * （hidden 切换，保留各自表单态）。数据归口：providers 一次性加载，
 * presets/gallery/tasks 面板打开时加载，任务 2s 轮询并侦测成功转移
 * 自动刷画廊。
 * 响应式：桌面居中模态（≤1100px），≤767px 全屏抽屉（见 styles.ts）。
 * @module image-studio/client/panel/panel
 */
import type { NamespaceSettingsApi, Scope } from '@dsh-plus/shared/client'
import { IconBrush, IconCloseOutline16, IconImage, IconSparkles } from '@dsh-plus/shared/client'
import {
  type ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import type { PresetsWire, ProvidersWire, TaskWire } from '../../dto.ts'
import type { GalleryItem } from '../../gallery/store.ts'
import type { ParamEntry } from '../../params/catalog.ts'
import { cancelTask, fetchGallery, fetchPresets, fetchProviders, fetchTasks } from '../api.ts'
import type { Translate } from '../i18n.ts'
import type { PanelController, StudioTab } from './controller.ts'
import { GalleryView } from './gallery.tsx'
import { GeneratorForm } from './generator.tsx'
import { TasksBar } from './tasks.tsx'

interface StudioPanelProps {
  studio: PanelController
  t: Translate
  scope: Scope
  api: NamespaceSettingsApi
}

const EMPTY_PRESETS: PresetsWire = { promptPresets: [], paramPresets: [], providerPresets: [] }

export function StudioPanel(props: StudioPanelProps): ReactElement | null {
  const { studio, t, scope, api } = props
  const { open, tab, editSeed } = useSyncExternalStore(studio.subscribe, studio.getSnapshot)
  const [providers, setProviders] = useState<ProvidersWire | null>(null)
  const [presets, setPresets] = useState<PresetsWire>(EMPTY_PRESETS)
  const [gallery, setGallery] = useState<GalleryItem[]>([])
  const [galleryLoading, setGalleryLoading] = useState(false)
  const [galleryFailed, setGalleryFailed] = useState(false)
  const [tasks, setTasks] = useState<TaskWire[]>([])
  const [detailId, setDetailId] = useState<string | null>(null)
  /** 上一轮任务快照（成功转移侦测）。 */
  const prevTasksRef = useRef<Map<string, TaskWire['state']>>(new Map())

  const reloadGallery = useCallback((): void => {
    setGalleryLoading(true)
    fetchGallery()
      .then((res) => {
        setGallery(res.items)
        setGalleryFailed(false)
      })
      .catch(() => setGalleryFailed(true))
      .finally(() => setGalleryLoading(false))
  }, [])

  const reloadPresets = useCallback((): void => {
    fetchPresets()
      .then(setPresets)
      .catch(() => {})
  }, [])

  const reloadTasks = useCallback((): void => {
    fetchTasks()
      .then((res) => setTasks(res.tasks))
      .catch(() => {})
  }, [])

  // 打开时加载静态目录 + 三类数据；关闭时停止轮询（effect 清理）。
  useEffect(() => {
    if (!open) return
    if (providers === null) {
      fetchProviders()
        .then(setProviders)
        .catch(() => {})
    }
    reloadPresets()
    reloadGallery()
    reloadTasks()
    const timer = setInterval(() => {
      fetchTasks()
        .then((res) => {
          setTasks(res.tasks)
          // 侦测新成功任务 → 刷画廊（含其它客户端/来源产生的成功）。
          const prev = prevTasksRef.current
          const next = new Map<string, TaskWire['state']>()
          let succeeded = false
          for (const task of res.tasks) {
            next.set(task.id, task.state)
            if (task.state === 'succeeded' && prev.get(task.id) !== 'succeeded') succeeded = true
          }
          prevTasksRef.current = next
          if (succeeded) reloadGallery()
        })
        .catch(() => {})
    }, 2000)
    return () => clearInterval(timer)
  }, [open, providers, reloadPresets, reloadGallery, reloadTasks])

  if (!open) return null

  // wire 的 params 与 ParamEntry 结构同源（kind 宽化为 string），边界处一次性窄化。
  const catalog = (providers?.params ?? []) as unknown as readonly ParamEntry[]
  const protocols = providers?.protocols ?? []

  const tabs: Array<{ key: StudioTab; label: string; icon: ReactElement }> = [
    { key: 'generation', label: t('tab.generation'), icon: <IconSparkles size={15} /> },
    { key: 'edit', label: t('tab.edit'), icon: <IconBrush size={15} /> },
    { key: 'gallery', label: t('tab.gallery'), icon: <IconImage size={15} /> },
  ]

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 背板点击关闭是指针便利交互，键盘用户走关闭/取消按钮（同 web-terminal 既有约定）
    <div className="ims-backdrop" role="presentation" onClick={() => studio.setOpen(false)}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: 阻断冒泡仅防误触背板关闭，无实际点击行为 */}
      <div
        className="ims-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t('panel.title')}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="ims-head">
          <div className="ims-tabs" role="tablist" aria-label={t('panel.title')}>
            {tabs.map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={tab === item.key}
                className={`ims-tab${tab === item.key ? ' ims-tabActive' : ''}`}
                onClick={() => studio.setTab(item.key)}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            className="ims-iconBtn"
            aria-label={t('common.close')}
            onClick={() => studio.setOpen(false)}
          >
            <IconCloseOutline16 size={16} />
          </button>
        </header>

        <div className="ims-body">
          <GeneratorForm
            t={t}
            endpoint="generation"
            catalog={catalog}
            protocols={protocols}
            presets={presets}
            gallery={gallery}
            scope={scope}
            api={api}
            editSeed={null}
            onPresetSaved={reloadPresets}
            onSubmitted={reloadTasks}
            hidden={tab !== 'generation'}
          />
          <GeneratorForm
            t={t}
            endpoint="edit"
            catalog={catalog}
            protocols={protocols}
            presets={presets}
            gallery={gallery}
            scope={scope}
            api={api}
            editSeed={editSeed}
            onPresetSaved={reloadPresets}
            onSubmitted={reloadTasks}
            hidden={tab !== 'edit'}
          />
          <GalleryView
            t={t}
            items={gallery}
            loading={galleryLoading}
            failed={galleryFailed}
            onRefresh={reloadGallery}
            onEdit={(item) =>
              studio.seedEdit({
                sourceIds: [...item.imageIds],
                prompt: item.prompt,
                params: item.params,
                providerPresetId: item.providerPresetId,
              })
            }
            detailId={detailId}
            onDetailChange={setDetailId}
            hidden={tab !== 'gallery'}
          />
        </div>

        <TasksBar
          t={t}
          tasks={tasks}
          onCancel={(taskId) => {
            cancelTask(taskId)
              .then(reloadTasks)
              .catch(() => {})
          }}
          onView={(galleryItemId) => {
            studio.setTab('gallery')
            setDetailId(galleryItemId)
          }}
        />
      </div>
    </div>
  )
}
