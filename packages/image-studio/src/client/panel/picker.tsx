/**
 * 源图选择器（模态）：源图多选（≤MAX_SOURCE_IMAGES）与遮罩单选共用。
 * 两个来源分区——画廊（已生成图片）与本地上传（暂存区），可混合选择；
 * 选中态以 SourceRef 记录（kind 区分 id 空间），底部确认条显示已选数量。
 * @module image-studio/client/panel/picker
 */
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconPlusOutline16 } from '@dsh-plus/shared/client'
import { type ReactElement, useState } from 'react'
import type { SourceRef, UploadEntry } from '../../dto.ts'
import type { GalleryItem } from '../../gallery/store.ts'
import { MAX_SOURCE_IMAGES } from '../../limits.ts'
import { imageUrl, uploadImageUrl } from '../api.ts'
import type { Translate } from '../i18n.ts'
import { UploadButton, type UploadsApi } from './uploads.tsx'

/** 扁平化的可选画廊图片（imageId + 归属条目提示词）。 */
interface PickableImage {
  imageId: string
  prompt: string
  createdAt: string
}

interface ImagePickerProps {
  t: Translate
  title: string
  items: GalleryItem[]
  /** 上传暂存区（列表 + 上传入口）。 */
  uploads: UploadsApi
  /** 多选（源图）或单选（遮罩）。 */
  multiple: boolean
  /** 初始已选（源图/遮罩回填）。 */
  initial: SourceRef[]
  onConfirm(refs: SourceRef[]): void
  onClose(): void
}

export function flattenImages(items: GalleryItem[]): PickableImage[] {
  const out: PickableImage[] = []
  for (const item of [...items].reverse()) {
    for (const imageId of item.imageIds) {
      out.push({ imageId, prompt: item.prompt, createdAt: item.createdAt })
    }
  }
  return out
}

/** 引用键（选中判定与去重；两个 id 空间不重叠但不互相假设）。 */
export function refKey(ref: SourceRef): string {
  return `${ref.kind}:${ref.id}`
}

/** 缩略图地址（画廊 / 上传两套端点）。 */
export function refUrl(ref: SourceRef): string {
  return ref.kind === 'gallery' ? imageUrl(ref.id) : uploadImageUrl(ref.id)
}

export function ImagePicker(props: ImagePickerProps): ReactElement {
  const { t, title, items, uploads, multiple, initial, onConfirm, onClose } = props
  const [selected, setSelected] = useState<SourceRef[]>(initial)
  const [section, setSection] = useState<'gallery' | 'uploads'>(
    uploads.items.length > 0 && items.length === 0 ? 'uploads' : 'gallery',
  )
  const images = flattenImages(items)
  const uploadItems = [...uploads.items].reverse()
  const selectedKeys = selected.map(refKey)

  const toggle = (ref: SourceRef): void => {
    const key = refKey(ref)
    if (multiple) {
      setSelected((current) =>
        current.some((item) => refKey(item) === key)
          ? current.filter((item) => refKey(item) !== key)
          : current.length >= MAX_SOURCE_IMAGES
            ? current
            : [...current, ref],
      )
      return
    }
    setSelected((current) => (current.some((item) => refKey(item) === key) ? [] : [ref]))
  }

  /** 新上传条目直接选中（少一次点击；超限按剩余额度截断）。 */
  const selectUploaded = (entries: UploadEntry[]): void => {
    const refs = entries.map((entry) => ({ kind: 'upload' as const, id: entry.id }))
    setSelected((current) => (multiple ? [...current, ...refs].slice(0, MAX_SOURCE_IMAGES) : refs))
    setSection('uploads')
  }

  const grid = (cells: Array<{ ref: SourceRef; title: string }>, empty: string): ReactElement =>
    cells.length === 0 ? (
      <p className="ims-empty">{empty}</p>
    ) : (
      <div className="ims-pickerGrid" role="listbox" aria-multiselectable={multiple}>
        {cells.map((cell) => {
          const index = selectedKeys.indexOf(refKey(cell.ref))
          const on = index >= 0
          return (
            <button
              key={refKey(cell.ref)}
              type="button"
              role="option"
              aria-selected={on}
              className={`ims-pickerCell${on ? ' ims-pickerCellOn' : ''}`}
              title={cell.title}
              onClick={() => toggle(cell.ref)}
            >
              <img src={refUrl(cell.ref)} alt={cell.title} loading="lazy" />
              {on ? <span className="ims-pickerMark">{index + 1}</span> : null}
            </button>
          )
        })}
      </div>
    )

  // 官方 Modal 承载（嵌套 portal：层级高于工作台，遮罩/Escape 由 Modal 处理）。
  return (
    <Modal open onClose={onClose} title={title} headless className="ims-pickerModal">
      <div className="ims-sub">
        <div className="ims-subHead">
          <h3 className="ims-subTitle">{title}</h3>
          <UploadButton
            t={t}
            uploads={uploads}
            multiple={multiple}
            // 遮罩只接受 PNG（官方要求带透明通道）；源图不限格式。
            accept={multiple ? undefined : 'image/png'}
            onUploaded={selectUploaded}
            className="ims-btn ims-btnPrimary ims-btnSmall"
          >
            <IconPlusOutline16 size={14} /> {t('upload.pick')}
          </UploadButton>
          <button type="button" className="ims-btn ims-btnGhost" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
        <div className="ims-seg">
          <button
            type="button"
            className={`ims-segItem${section === 'gallery' ? ' ims-segItemOn' : ''}`}
            aria-pressed={section === 'gallery'}
            onClick={() => setSection('gallery')}
          >
            {t('picker.section.gallery')}
          </button>
          <button
            type="button"
            className={`ims-segItem${section === 'uploads' ? ' ims-segItemOn' : ''}`}
            aria-pressed={section === 'uploads'}
            onClick={() => {
              uploads.reload()
              setSection('uploads')
            }}
          >
            {t('picker.section.uploads')}
          </button>
        </div>
        {section === 'gallery'
          ? grid(
              images.map((image) => ({
                ref: { kind: 'gallery', id: image.imageId },
                title: image.prompt,
              })),
              t('picker.empty'),
            )
          : grid(
              uploadItems.map((entry) => ({
                ref: { kind: 'upload', id: entry.id },
                title: entry.name,
              })),
              t('upload.empty'),
            )}
        {uploads.error !== null ? (
          <p className="ims-status ims-statusError" role="alert">
            {t('upload.failed')}
            {uploads.error}
          </p>
        ) : null}
        <div className="ims-subFoot">
          <button
            type="button"
            className="ims-btn ims-btnPrimary"
            disabled={selected.length === 0}
            onClick={() => onConfirm(selected)}
          >
            {t('picker.confirm').replace('{n}', String(selected.length))}
          </button>
          <button type="button" className="ims-btn ims-btnGhost" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
