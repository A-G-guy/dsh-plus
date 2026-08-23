/**
 * 目录浏览半区：面包屑、工具栏与条目列表（含行内操作菜单）。
 * 纯展示组件，数据与动作经 props 注入。
 * @module @dsh-plus/web-files/panel/browser
 */
import { type ReactNode, useRef, useState } from 'react'
import type { FsEntryDto, ListResponse } from '../protocol.ts'
import {
  Button,
  IconChevronRightOutline14,
  IconCodeOutline16,
  IconDownloadOutline16,
  IconEditOutline16,
  IconEllipsisOutline16,
  IconFolderClose16,
  IconPlusOutline16,
  IconRefreshOutline16,
  IconRightUpOutline16,
  IconTrashOutline16,
  Input,
  Menu,
  Tooltip,
} from './primitives.ts'
import type { Translate } from './types.ts'

export interface BrowserActions {
  onNavigate: (path: string) => void
  onRefresh: () => void
  onToggleHidden: () => void
  onNewFolder: () => void
  onUpload: (files: FileList) => void
  onOpenEntry: (entry: FsEntryDto) => void
  onRename: (entry: FsEntryDto) => void
  onDelete: (entry: FsEntryDto) => void
  onDownload: (entry: FsEntryDto) => void
}

export interface BrowserProps extends BrowserActions {
  listing: ListResponse | null
  loading: boolean
  error: string | null
  showHidden: boolean
  selectedPath: string | null
  t: Translate
}

/** 人类可读字节数。 */
export function formatSize(size: number): string {
  if (size < 1024) return `${String(size)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = size
  let unit = 'B'
  for (const next of units) {
    if (value < 1024) break
    value /= 1024
    unit = next
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${unit}`
}

/** 人类可读修改时间（同年省略年份）。 */
export function formatTime(mtimeMs: number): string {
  const date = new Date(mtimeMs)
  const now = new Date()
  const options: Intl.DateTimeFormatOptions =
    date.getFullYear() === now.getFullYear()
      ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
      : { year: 'numeric', month: 'short', day: 'numeric' }
  return date.toLocaleString(undefined, options)
}

function Crumbs({
  listing,
  onNavigate,
}: {
  listing: ListResponse
  onNavigate: (path: string) => void
}) {
  return (
    <nav className="wf-crumbs" aria-label="path">
      {listing.crumbs.map((crumb, index) => (
        <span className="wf-crumb" key={crumb.path}>
          {index > 0 && <IconChevronRightOutline14 />}
          <button type="button" className="wf-crumb-button" onClick={() => onNavigate(crumb.path)}>
            {crumb.name}
          </button>
        </span>
      ))}
    </nav>
  )
}

interface RowMenuProps {
  entry: FsEntryDto
  t: Translate
  onRename: (entry: FsEntryDto) => void
  onDelete: (entry: FsEntryDto) => void
  onDownload: (entry: FsEntryDto) => void
}

/** 行尾省略号操作菜单（重命名/下载/删除）。 */
function RowMenu({ entry, t, onRename, onDelete, onDownload }: RowMenuProps) {
  const [open, setOpen] = useState(false)
  const items = [
    { id: 'rename', label: t('view.rename'), icon: <IconEditOutline16 /> },
    ...(entry.kind === 'file'
      ? [{ id: 'download', label: t('view.download'), icon: <IconDownloadOutline16 /> }]
      : []),
    { id: 'delete', label: t('view.delete'), icon: <IconTrashOutline16 />, danger: true },
  ]
  return (
    <Menu
      open={open}
      portal
      align="end"
      anchor={
        <button
          type="button"
          className="wf-row-menu-trigger"
          aria-label="actions"
          onClick={(event) => {
            event.stopPropagation()
            setOpen((value) => !value)
          }}
        >
          <IconEllipsisOutline16 />
        </button>
      }
      items={items}
      onSelect={(id) => {
        setOpen(false)
        if (id === 'rename') onRename(entry)
        else if (id === 'download') onDownload(entry)
        else if (id === 'delete') onDelete(entry)
      }}
      onClose={() => setOpen(false)}
    />
  )
}

/** 目录浏览区。 */
export function Browser(props: BrowserProps) {
  const { listing, loading, error, showHidden, selectedPath, t } = props
  const uploadRef = useRef<HTMLInputElement>(null)
  const [pathDraft, setPathDraft] = useState('')
  const [pathEditing, setPathEditing] = useState(false)

  const jumpToDraft = () => {
    const path = pathDraft.trim()
    setPathEditing(false)
    if (path.startsWith('/')) props.onNavigate(path)
  }

  return (
    <div className="wf-browser">
      <div className="wf-toolbar">
        <Tooltip label={t('toolbar.refresh')} side="bottom">
          <button
            type="button"
            className="wf-icon-button"
            onClick={props.onRefresh}
            aria-label={t('toolbar.refresh')}
          >
            <IconRefreshOutline16 />
          </button>
        </Tooltip>
        <Tooltip label={t('toolbar.newFolder')} side="bottom">
          <button
            type="button"
            className="wf-icon-button"
            onClick={props.onNewFolder}
            aria-label={t('toolbar.newFolder')}
          >
            <IconPlusOutline16 />
          </button>
        </Tooltip>
        <Tooltip label={t('toolbar.upload')} side="bottom">
          <button
            type="button"
            className="wf-icon-button"
            onClick={() => uploadRef.current?.click()}
            aria-label={t('toolbar.upload')}
          >
            <IconRightUpOutline16 />
          </button>
        </Tooltip>
        <Button variant="toolbar" size="sm" onClick={props.onToggleHidden}>
          {showHidden ? t('toolbar.hideHidden') : t('toolbar.showHidden')}
        </Button>
        <input
          ref={uploadRef}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            const files = event.target.files
            if (files !== null && files.length > 0) props.onUpload(files)
            event.target.value = ''
          }}
        />
      </div>
      {pathEditing ? (
        <Input
          className="wf-path-input"
          value={pathDraft}
          placeholder={t('toolbar.pathPlaceholder')}
          autoFocus
          onChange={(event) => setPathDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') jumpToDraft()
            if (event.key === 'Escape') setPathEditing(false)
          }}
          onBlur={() => setPathEditing(false)}
        />
      ) : (
        listing !== null && (
          <button
            type="button"
            className="wf-crumbs-button"
            onClick={() => {
              setPathDraft(listing.path)
              setPathEditing(true)
            }}
          >
            <Crumbs listing={listing} onNavigate={props.onNavigate} />
          </button>
        )
      )}
      <div className="wf-list">
        {error !== null && <div className="wf-list-note">{error}</div>}
        {loading && <div className="wf-list-note">{t('view.loading')}</div>}
        {!loading && error === null && listing !== null && listing.entries.length === 0 && (
          <div className="wf-list-note">{t('list.empty')}</div>
        )}
        {!loading &&
          listing?.entries.map((entry) => (
            <EntryRow
              key={entry.path}
              entry={entry}
              selected={entry.path === selectedPath}
              t={t}
              onOpen={() => props.onOpenEntry(entry)}
              onRename={props.onRename}
              onDelete={props.onDelete}
              onDownload={props.onDownload}
            />
          ))}
        {listing?.truncated === true && <div className="wf-list-note">{t('list.truncated')}</div>}
      </div>
    </div>
  )
}

interface EntryRowProps {
  entry: FsEntryDto
  selected: boolean
  t: Translate
  onOpen: () => void
  onRename: (entry: FsEntryDto) => void
  onDelete: (entry: FsEntryDto) => void
  onDownload: (entry: FsEntryDto) => void
}

function EntryRow({ entry, selected, t, onOpen, onRename, onDelete, onDownload }: EntryRowProps) {
  const icon: ReactNode = entry.kind === 'dir' ? <IconFolderClose16 /> : <IconCodeOutline16 />
  return (
    <div className={`wf-row${selected ? ' wf-row-selected' : ''}`}>
      <button type="button" className="wf-row-main" onClick={onOpen}>
        <span className="wf-row-icon">{icon}</span>
        <span className="wf-row-name">{entry.name}</span>
        <span className="wf-row-meta">{entry.kind === 'file' ? formatSize(entry.size) : ''}</span>
        <span className="wf-row-meta wf-row-time">{formatTime(entry.mtimeMs)}</span>
      </button>
      <RowMenu
        entry={entry}
        t={t}
        onRename={onRename}
        onDelete={onDelete}
        onDownload={onDownload}
      />
    </div>
  )
}
