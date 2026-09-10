/**
 * 本地文件上传的浏览器半：列表/上传/错误态封装为 hook，控件供生图表单与
 * 图片选择器复用。上传为串行（逐个文件），首个失败即中断并展示原因；
 * 成功后条目即时并入本地列表（选择器无需刷新即可见）。
 * @module image-studio/client/panel/uploads
 */
import {
  type ChangeEvent,
  type ReactElement,
  type ReactNode,
  useCallback,
  useRef,
  useState,
} from 'react'
import type { UploadEntry } from '../../dto.ts'
import { fetchUploads, uploadImage } from '../api.ts'
import type { Translate } from '../i18n.ts'

/** 可接受的上传类型（宿主端另有魔数嗅探兜底）。 */
const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif'

export interface UploadsApi {
  /** 暂存区条目（索引序，最新在后）。 */
  items: UploadEntry[]
  /** 列表加载/上传进行中。 */
  busy: boolean
  /** 最近一次失败原因（成功即清空）。 */
  error: string | null
  /** 上传一批文件，返回成功条目（失败中断并置 error）。 */
  add(files: FileList | File[]): Promise<UploadEntry[]>
  /** 重新拉取列表。 */
  reload(): void
}

/** 上传暂存区读写 hook（每个消费组件一份，互不共享状态）。 */
export function useUploads(): UploadsApi {
  const [items, setItems] = useState<UploadEntry[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback((): void => {
    setBusy(true)
    fetchUploads()
      .then((res) => setItems(res.items))
      .catch(() => setItems([]))
      .finally(() => setBusy(false))
  }, [])

  const add = useCallback(async (files: FileList | File[]): Promise<UploadEntry[]> => {
    const list = Array.from(files)
    if (list.length === 0) return []
    setBusy(true)
    setError(null)
    const saved: UploadEntry[] = []
    try {
      for (const file of list) {
        const entry = await uploadImage(file)
        saved.push(entry)
      }
      setItems((current) => [...current, ...saved])
      return saved
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
      return saved
    } finally {
      setBusy(false)
    }
  }, [])

  return { items, busy, error, add, reload }
}

interface UploadButtonProps {
  t: Translate
  uploads: UploadsApi
  /** 上传成功回调（新条目已入列表；调用方按需自动选中）。 */
  onUploaded(entries: UploadEntry[]): void
  /** 允许多选（源图）或单选（遮罩）。 */
  multiple: boolean
  /**
   * 允许的文件类型（缺省四类位图；遮罩场景传 image/png）。
   * 并上 undefined：调用方按 `multiple ? undefined : 'image/png'` 直接透传。
   */
  accept?: string | undefined
  disabled?: boolean | undefined
  className?: string | undefined
  children: ReactNode
}

/** 隐藏 file input + 触发按钮（移动端显式 accept 图像类型，避免退化为相册单选）。 */
export function UploadButton(props: UploadButtonProps): ReactElement {
  const { t, uploads, onUploaded, multiple, disabled, className, children } = props
  const inputRef = useRef<HTMLInputElement>(null)

  const onChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const files = event.target.files
    if (files !== null && files.length > 0) {
      void uploads.add(files).then((entries) => {
        if (entries.length > 0) onUploaded(entries)
      })
    }
    // 复位以便连续选择同一文件。
    event.target.value = ''
  }

  return (
    <>
      <button
        type="button"
        className={className ?? 'ims-btn ims-btnGhost'}
        disabled={disabled === true || uploads.busy}
        onClick={() => inputRef.current?.click()}
      >
        {children}
      </button>
      <input
        ref={inputRef}
        type="file"
        hidden
        multiple={multiple}
        accept={props.accept ?? ACCEPT}
        aria-label={t('upload.pick')}
        onChange={onChange}
      />
    </>
  )
}
