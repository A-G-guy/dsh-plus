/**
 * 浏览区工具栏的下拉控件：排序选择与新建（文件/文件夹）。
 * 与 browser.tsx 分离以控制模块规模；行为经 props 注入。
 * @module @dsh-plus/web-files/panel/toolbar-menus
 */
import { useState } from 'react'
import { IconSort16 } from './icons.tsx'
import { IconCodeOutline16, IconFolderClose16, IconPlusOutline16, Menu } from './primitives.ts'
import { SORT_KEYS, type SortDir, type SortKey } from './sort.ts'
import type { Translate } from './types.ts'

/** 排序下拉：键（名称/大小/修改时间）与方向两组单选。 */
export function SortControl({
  sortKey,
  sortDir,
  onChange,
  t,
}: {
  sortKey: SortKey
  sortDir: SortDir
  onChange: (key: SortKey, dir: SortDir) => void
  t: Translate
}) {
  const [open, setOpen] = useState(false)
  const keyLabels: Record<SortKey, string> = {
    name: t('list.name'),
    size: t('list.size'),
    mtime: t('list.modified'),
  }
  const items = [
    ...SORT_KEYS.map((key) => ({ id: key, label: keyLabels[key] })),
    { type: 'separator' as const, id: 'sep' },
    { id: 'asc', label: t('sort.asc') },
    { id: 'desc', label: t('sort.desc') },
  ]
  return (
    <Menu
      open={open}
      portal
      align="start"
      anchor={
        <button
          type="button"
          className="wf-icon-button"
          aria-label={t('toolbar.sort')}
          onClick={() => setOpen((value) => !value)}
        >
          <IconSort16 />
        </button>
      }
      items={items}
      selectedIds={[sortKey, sortDir]}
      onSelect={(id) => {
        setOpen(false)
        if ((SORT_KEYS as readonly string[]).includes(id)) {
          onChange(id as SortKey, sortDir)
          return
        }
        if (id === 'asc' || id === 'desc') onChange(sortKey, id)
      }}
      onClose={() => setOpen(false)}
    />
  )
}

/** 新建下拉：新建文件 / 新建文件夹。 */
export function NewMenu({
  onNewFile,
  onNewFolder,
  t,
}: {
  onNewFile: () => void
  onNewFolder: () => void
  t: Translate
}) {
  const [open, setOpen] = useState(false)
  const items = [
    { id: 'file', label: t('new.file'), icon: <IconCodeOutline16 /> },
    { id: 'folder', label: t('new.folder'), icon: <IconFolderClose16 /> },
  ]
  return (
    <Menu
      open={open}
      portal
      align="start"
      anchor={
        <button
          type="button"
          className="wf-icon-button"
          aria-label={t('toolbar.new')}
          onClick={() => setOpen((value) => !value)}
        >
          <IconPlusOutline16 />
        </button>
      }
      items={items}
      onSelect={(id) => {
        setOpen(false)
        if (id === 'file') onNewFile()
        else if (id === 'folder') onNewFolder()
      }}
      onClose={() => setOpen(false)}
    />
  )
}
