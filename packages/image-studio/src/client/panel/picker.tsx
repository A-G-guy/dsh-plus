/**
 * 画廊图片选择器（模态）：源图多选（≤16）与遮罩单选共用。
 * 扁平化全部画廊条目的图片，倒序排列；底部确认条显示已选数量。
 * @module image-studio/client/panel/picker
 */
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

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 背板点击关闭是指针便利交互，键盘用户走关闭/取消按钮（同 web-terminal 既有约定）
    <div className="ims-pickerBackdrop" role="presentation" onClick={onClose}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: 阻断冒泡仅防误触背板关闭，无实际点击行为 */}
      <div
        className="ims-picker"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="ims-pickerHead">
          <h3 className="ims-pickerTitle">{title}</h3>
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
        <div className="ims-pickerFoot">
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
    </div>
  )
}
