/**
 * 画廊图片选择器（模态）：源图多选（≤16）与遮罩单选共用。
 * 扁平化全部画廊条目的图片，倒序排列；底部确认条显示已选数量。
 * @module image-studio/client/panel/picker
 */
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { type ReactElement, useState } from 'react'
import type { GalleryItem } from '../../gallery/store.ts'
import { imageUrl } from '../api.ts'
import type { Translate } from '../i18n.ts'

/** 扁平化的可选图片（imageId + 归属条目提示词）。 */
interface PickableImage {
  imageId: string
  prompt: string
  createdAt: string
}

interface ImagePickerProps {
  t: Translate
  title: string
  items: GalleryItem[]
  /** 多选（源图）或单选（遮罩）。 */
  multiple: boolean
  /** 初始已选（源图回填）。 */
  initial: string[]
  onConfirm(ids: string[]): void
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

export function ImagePicker(props: ImagePickerProps): ReactElement {
  const { t, title, items, multiple, initial, onConfirm, onClose } = props
  const [selected, setSelected] = useState<string[]>(initial)
  const images = flattenImages(items)

  const toggle = (imageId: string): void => {
    if (multiple) {
      setSelected((current) =>
        current.includes(imageId)
          ? current.filter((id) => id !== imageId)
          : current.length >= 16
            ? current
            : [...current, imageId],
      )
      return
    }
    setSelected((current) => (current.includes(imageId) ? [] : [imageId]))
  }

  // 官方 Modal 承载（嵌套 portal：层级高于工作台，遮罩/Escape 由 Modal 处理）。
  return (
    <Modal open onClose={onClose} title={title} headless className="ims-pickerModal">
      <div className="ims-sub">
        <div className="ims-subHead">
          <h3 className="ims-subTitle">{title}</h3>
          <button type="button" className="ims-btn ims-btnGhost" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
        {images.length === 0 ? (
          <p className="ims-empty">{t('picker.empty')}</p>
        ) : (
          <div className="ims-pickerGrid" role="listbox" aria-multiselectable={multiple}>
            {images.map((image) => {
              const on = selected.includes(image.imageId)
              return (
                <button
                  key={image.imageId}
                  type="button"
                  role="option"
                  aria-selected={on}
                  className={`ims-pickerCell${on ? ' ims-pickerCellOn' : ''}`}
                  title={image.prompt}
                  onClick={() => toggle(image.imageId)}
                >
                  <img src={imageUrl(image.imageId)} alt={image.prompt} loading="lazy" />
                  {on ? (
                    <span className="ims-pickerMark">{selected.indexOf(image.imageId) + 1}</span>
                  ) : null}
                </button>
              )
            })}
          </div>
        )}
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
