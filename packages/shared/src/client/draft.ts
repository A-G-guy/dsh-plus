/**
 * 单命名空间 staged 草稿（简单配置卡片共用）：读 scope 快照、播种草稿、
 * 脏判定、保存（revision fencing + 重新装载）与状态行。
 *
 * 语义与官方 staged 表单一致：Host 更新不覆盖在途编辑，只有保存才写回；
 * 保存成功后按 Host 解析值重置草稿。`from`/`patch` 参与 effect 与 useMemo
 * 依赖，必须是模块级稳定函数（不要内联箭头函数）。
 * @module @dsh-plus/shared/client/draft
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'

import { type CardStatusState, IDLE_STATUS } from './card.tsx'
import type { NamespaceSettingsApi, Scope } from './scope.ts'

export interface UseNamespaceDraftOptions<V, D> {
  scope: Scope
  api: NamespaceSettingsApi
  /** 命名空间解析值 → 编辑草稿。 */
  from(value: V): D
  /** 编辑草稿 → 提交形状（深合并进该命名空间）。 */
  patch(draft: D): Record<string, unknown>
  /** 保存失败提示前缀。 */
  saveFailedLabel: string
}

export interface NamespaceDraft<V, D> {
  /** 命名空间解析值（首个 Host 应答前为 undefined）。 */
  value: V | undefined
  /** 编辑草稿（播种前为 null）。 */
  draft: D | null
  dirty: boolean
  saving: boolean
  status: CardStatusState
  /** Host 文档不可写（memory 模式或只读部署）。 */
  disabled: boolean
  setDraft(next: D): void
  /** 合并式字段编辑（同时清空状态行）。 */
  edit(patch: Partial<D>): void
  /** 丢弃在途编辑，回到 Host 解析值。 */
  reset(): void
  save(): void
}

export function useNamespaceDraft<V, D>(
  options: UseNamespaceDraftOptions<V, D>,
): NamespaceDraft<V, D> {
  const { scope, api, from, patch, saveFailedLabel } = options
  const snapshot = useSyncExternalStore(
    (listener: () => void) => scope.subscribe(listener),
    () => scope.getSnapshot(),
  )
  const value = snapshot.value as V | undefined
  const [draft, setDraftState] = useState<D | null>(null)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<CardStatusState>(IDLE_STATUS)

  // 首次拿到解析值后播种；后续 Host 更新不覆盖在途编辑。
  useEffect(() => {
    if (value === undefined || draft !== null) return
    setDraftState(from(value))
  }, [value, draft, from])

  const dirty = useMemo(
    () =>
      value !== undefined &&
      draft !== null &&
      JSON.stringify(patch(draft)) !== JSON.stringify(patch(from(value))),
    [value, draft, from, patch],
  )

  const setDraft = (next: D): void => {
    setDraftState(next)
    setStatus(IDLE_STATUS)
  }
  const edit = (part: Partial<D>): void => {
    if (draft === null) return
    setDraft({ ...draft, ...part })
  }
  const reset = (): void => {
    if (value === undefined) return
    setDraft(from(value))
  }
  const save = (): void => {
    if (draft === null) return
    setSaving(true)
    const revision = scope.getSnapshot().revision
    api
      .update(patch(draft), revision)
      .then(async () => {
        await scope.load()
        const next = scope.getSnapshot().value as V | undefined
        if (next !== undefined) setDraftState(from(next))
        setStatus(IDLE_STATUS)
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        setStatus({ kind: 'error', text: `${saveFailedLabel}${message}` })
      })
      .finally(() => setSaving(false))
  }

  return {
    value,
    draft,
    dirty,
    saving,
    status,
    disabled: !snapshot.writable,
    setDraft,
    edit,
    reset,
    save,
  }
}
