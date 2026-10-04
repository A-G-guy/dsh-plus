/**
 * 浏览器半的凭据面：官方 settings-controller 的 `remote.credentials` 命名空间
 * （describe/set/unset），复用官方 credentials seam，不另开 HTTP 端点。
 * **值只写不读**——describe 只回「已配置 / 来源 / 可写」，没有任何方法回传值。
 *
 * 凭据与 settings 草稿相互独立：它不进命名空间、不参与脏判定，保存即落
 * `$DSH_HOME/.credentials.yaml` 并热生效（宿主每次工具调用重新 resolve），
 * 因此改口令不需要保存卡片、也不需要 /reload 或重启。
 * @module @dsh-plus/actual/client/secrets
 */
import type { RemoteResult } from '@dsh-plus/shared/client'
import { useCallback, useEffect, useState } from 'react'

import { CREDENTIAL_REFS } from '../refs.ts'

/** 单个引用的安全视图：没有能承载值的字段。 */
export interface CredentialView {
  configured: boolean
  source?: string
  writable: boolean
}

/** 卡片用到的 `remote.credentials` 方法面。 */
export interface CredentialsRemoteFace {
  describe(refs: readonly string[]): Promise<RemoteResult<Record<string, CredentialView>>>
  set(ref: string, value: string): Promise<RemoteResult<unknown>>
  unset(ref: string): Promise<RemoteResult<unknown>>
  /** 订阅引用变更（宿主提交写入或观察到凭据文件被外部编辑时触发）。 */
  onChange(listener: (ref: string) => void): () => void
}

/** 未答（或应答缺项）时的视图：按「未配置、可写」呈现。 */
export const ABSENT_VIEW: CredentialView = { configured: false, writable: true }

/** 取某引用的视图；应答缺项回落为 {@link ABSENT_VIEW}。 */
export function viewOf(views: Record<string, CredentialView>, ref: string): CredentialView {
  return views[ref] ?? ABSENT_VIEW
}

/** 应答信封的错误文案（成功为空串）。 */
export function failureOf(result: RemoteResult<unknown>): string {
  return result.ok ? '' : (result.error.message ?? '')
}

/** 提取异常文本。 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 凭据读写的卡片状态。 */
export interface CredentialsState {
  views: Record<string, CredentialView>
  /** 有写入在途（按钮禁用用）。 */
  busy: boolean
  /** 最近一次失败文案（空串 = 无）。 */
  error: string
  /** 写入成功返回 true（调用方据此决定是否清空输入框）。 */
  save(ref: string, value: string): Promise<boolean>
  clear(ref: string): Promise<boolean>
}

/**
 * 订阅宿主凭据变更：只认本插件关心的引用，其余（别的插件写自己的密钥）
 * 不触发重读。
 */
function useCredentialChanges(face: CredentialsRemoteFace, read: () => void): void {
  useEffect(
    () =>
      face.onChange((ref) => {
        if ((CREDENTIAL_REFS as readonly string[]).includes(ref)) read()
      }),
    [face, read],
  )
}

/**
 * 凭据行状态：挂载即 describe 一次，写入后重新 describe；
 * 外部改动经 `credentials/reference-updated` 触发同一路径刷新。
 */
export function useCredentials(face: CredentialsRemoteFace): CredentialsState {
  const [views, setViews] = useState<Record<string, CredentialView>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const read = useCallback(async (): Promise<void> => {
    const result = await face.describe([...CREDENTIAL_REFS])
    if (!result.ok) {
      setError(failureOf(result))
      return
    }
    setError('')
    setViews(result.value)
  }, [face])

  useEffect(() => {
    void read()
  }, [read])
  useCredentialChanges(face, read)

  const write = useCallback(
    async (run: () => Promise<RemoteResult<unknown>>): Promise<boolean> => {
      setBusy(true)
      try {
        const result = await run()
        if (!result.ok) {
          setError(failureOf(result))
          return false
        }
        setError('')
        await read()
        return true
      } catch (thrown: unknown) {
        setError(messageOf(thrown))
        return false
      } finally {
        setBusy(false)
      }
    },
    [read],
  )

  const save = useCallback(
    (ref: string, value: string): Promise<boolean> => write(() => face.set(ref, value)),
    [face, write],
  )
  const clear = useCallback(
    (ref: string): Promise<boolean> => write(() => face.unset(ref)),
    [face, write],
  )

  return { views, busy, error, save, clear }
}
