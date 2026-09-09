/**
 * 画廊视图：条目网格（首图缩略）+ 详情模态（全部图片、提示词/改写、
 * 请求参数回放、衍生链源图、下载/删除/二次编辑）。
 * @module image-studio/client/panel/gallery
 */
import { IconDownload, IconRefreshOutline16, IconTrashOutline16 } from '@dsh-plus/shared/client'
import { type ReactElement, useState } from 'react'
import type { GalleryItem } from '../../gallery/store.ts'
import { deleteGalleryItem, imageUrl } from '../api.ts'
import type { Translate } from '../i18n.ts'

interface GalleryViewProps {
  t: Translate
  items: GalleryItem[]
  loading: boolean
  failed: boolean
  onRefresh(): void
  onEdit(item: GalleryItem): void
  /** 外部请求打开的条目（任务条「查看」）；打开后由 onDetailOpened 消费。 */
  detailId: string | null
  onDetailChange(id: string | null): void
  hidden: boolean
}

function fmtTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

/** 详情模态。 */
function GalleryDetail(props: {
  t: Translate
  item: GalleryItem
  onClose(): void
  onEdit(item: GalleryItem): void
  onDeleted(id: string): void
}): ReactElement {
  const { t, item, onClose, onEdit, onDeleted } = props
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const doDelete = (): void => {
    setDeleting(true)
    deleteGalleryItem(item.id)
      .then(() => onDeleted(item.id))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err))
        setDeleting(false)
        setConfirming(false)
      })
  }

  const paramRows = Object.entries(item.params)
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 背板点击关闭是指针便利交互，键盘用户走关闭/取消按钮（同 web-terminal 既有约定）
    <div className="ims-detailBackdrop" role="presentation" onClick={onClose}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: 阻断冒泡仅防误触背板关闭，无实际点击行为 */}
      <div
        className="ims-detail"
        role="dialog"
        aria-modal="true"
        aria-label={item.prompt.slice(0, 40)}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="ims-detailHead">
          <span className="ims-detailMeta">
            {t('gallery.detail.model')}：{item.model} · {t('gallery.detail.endpoint')}：
            {item.endpoint} · {t('gallery.detail.time')}：{fmtTime(item.createdAt)}
          </span>
          <button type="button" className="ims-btn ims-btnGhost" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
        <div className="ims-detailBody">
          <div className="ims-detailImages">
            {item.imageIds.map((imageId, index) => (
              <figure key={imageId} className="ims-detailFigure">
                <img src={imageUrl(imageId)} alt={item.prompt} />
                <figcaption>
                  {item.revisedPrompts[index] !== null &&
                  item.revisedPrompts[index] !== undefined ? (
                    <span className="ims-revised" title={item.revisedPrompts[index] ?? ''}>
                      {t('gallery.detail.revised')}：{item.revisedPrompts[index]}
                    </span>
                  ) : null}
                  <a
                    className="ims-btn ims-btnGhost ims-btnSmall"
                    href={imageUrl(imageId)}
                    download
                  >
                    <IconDownload size={14} /> {t('common.download')}
                  </a>
                </figcaption>
              </figure>
            ))}
          </div>
          <div className="ims-detailInfo">
            <h4 className="ims-detailLabel">{t('gallery.detail.prompt')}</h4>
            <p className="ims-detailPrompt">{item.prompt}</p>
            {item.sourceIds.length > 0 ? (
              <>
                <h4 className="ims-detailLabel">{t('gallery.detail.sources')}</h4>
                <div className="ims-sources">
                  {item.sourceIds.map((imageId) => (
                    <span key={imageId} className="ims-thumb">
                      <img src={imageUrl(imageId)} alt="" />
                    </span>
                  ))}
                </div>
              </>
            ) : null}
            <h4 className="ims-detailLabel">{t('gallery.detail.params')}</h4>
            {paramRows.length === 0 ? (
              <p className="ims-hint">—</p>
            ) : (
              <table className="ims-paramTable">
                <tbody>
                  {paramRows.map(([key, value]) => (
                    <tr key={key}>
                      <td className="ims-paramTableKey">{key}</td>
                      <td>{JSON.stringify(value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
        <div className="ims-detailFoot">
          {error !== null ? (
            <p className="ims-status ims-statusError" role="alert">
              {error}
            </p>
          ) : null}
          <button type="button" className="ims-btn ims-btnPrimary" onClick={() => onEdit(item)}>
            {t('gallery.edit')}
          </button>
          {confirming ? (
            <button
              type="button"
              className="ims-btn ims-btnDanger"
              disabled={deleting}
              onClick={doDelete}
            >
              {t('common.confirmDelete')}
            </button>
          ) : (
            <button
              type="button"
              className="ims-btn ims-btnGhost"
              onClick={() => setConfirming(true)}
            >
              <IconTrashOutline16 size={14} /> {t('common.delete')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export function GalleryView(props: GalleryViewProps): ReactElement {
  const { t, items, loading, failed, onRefresh, onEdit, detailId, onDetailChange } = props
  const detail = items.find((item) => item.id === detailId) ?? null
  return (
    <div className="ims-gallery" hidden={props.hidden}>
      <div className="ims-galleryBar">
        <span className="ims-hint">{t('gallery.total').replace('{n}', String(items.length))}</span>
        <button type="button" className="ims-btn ims-btnGhost ims-btnSmall" onClick={onRefresh}>
          <IconRefreshOutline16 size={14} /> {t('common.refresh')}
        </button>
      </div>
      {failed ? (
        <p className="ims-empty">
          {t('common.loadFailed')}
          <button type="button" className="ims-btn ims-btnGhost ims-btnSmall" onClick={onRefresh}>
            {t('common.retry')}
          </button>
        </p>
      ) : loading ? (
        <p className="ims-empty">{t('common.loading')}</p>
      ) : items.length === 0 ? (
        <p className="ims-empty">{t('gallery.empty')}</p>
      ) : (
        <div className="ims-grid">
          {[...items].reverse().map((item) => (
            <button
              key={item.id}
              type="button"
              className="ims-cell"
              onClick={() => onDetailChange(item.id)}
            >
              <img src={imageUrl(item.imageIds[0] ?? '')} alt={item.prompt} loading="lazy" />
              <span className="ims-cellPrompt">{item.prompt}</span>
            </button>
          ))}
        </div>
      )}
      {detail !== null ? (
        <GalleryDetail
          t={t}
          item={detail}
          onClose={() => onDetailChange(null)}
          onEdit={(item) => {
            onDetailChange(null)
            onEdit(item)
          }}
          onDeleted={() => {
            onDetailChange(null)
            onRefresh()
          }}
        />
      ) : null}
    </div>
  )
}
