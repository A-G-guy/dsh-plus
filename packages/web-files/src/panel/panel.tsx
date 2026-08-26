/**
 * 文件管理面板根组件：目录浏览 + 预览/编辑 + 全部操作对话框。
 * 桌面双栏（浏览 | 编辑器），移动端全屏抽屉单栏切换（CSS 断点驱动，
 * 本组件仅暴露 view 状态类名）。
 * @module @dsh-plus/web-files/panel/panel
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'

import type { DirSortPreference, FsEntryDto, ListResponse, ReadResponse } from '../protocol.ts'
import * as api from './api.ts'
import { FilesApiError } from './api.ts'
import { Browser } from './browser.tsx'
import { CodeEditor } from './editor.tsx'
import {
  Button,
  IconCheckOutline16,
  IconCloseOutline16,
  IconCopyOutline16,
  IconDownloadOutline16,
  IconEditOutline16,
  IconWarningOutline16,
  Input,
  Modal,
  RiskConfirmation,
  Toast,
  Tooltip,
  writeClipboard,
} from './primitives.ts'
import type { SortDir, SortKey } from './sort.ts'
import type { PanelController, Translate } from './types.ts'

/** 偏好读写失败仅降级为会话内行为，但必须留下上下文日志。 */
function warnPrefs(action: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  console.warn(`[web-files] prefs ${action} failed: ${message}`)
}

/** POSIX 父目录路径（外部打开文件前先定位其所在目录）。 */
function parentPath(path: string): string {
  const index = path.lastIndexOf('/')
  return index <= 0 ? '/' : path.slice(0, index)
}

export interface FilePanelProps {
  files: PanelController
  t: Translate
}

/** 当前打开的文件状态。 */
interface OpenFile {
  entry: FsEntryDto
  read: ReadResponse
  /** 是否处于编辑态。 */
  editing: boolean
  /** 编辑后有未保存改动。 */
  dirty: boolean
}

/** 名称输入对话框（新建文件/新建文件夹/重命名共用）。 */
interface NameDialog {
  mode: 'mkdir' | 'mkfile' | 'rename'
  entry?: FsEntryDto
}

/** 顶部 Toast 条目。 */
interface ToastItem {
  id: number
  text: string
  error: boolean
}

export function FilePanel({ files, t }: FilePanelProps) {
  const { open, request } = useSyncExternalStore(files.subscribe, files.getSnapshot)
  const [listing, setListing] = useState<ListResponse | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [showHidden, setShowHidden] = useState(false)
  /** 按目录记忆的排序偏好（路径 → 键/方向）；服务端落盘，跨设备共享。 */
  const [sortByDir, setSortByDir] = useState<Record<string, DirSortPreference>>({})
  /** 偏好是否已从服务端加载（首次列目录前必须就绪，保证 showHidden 正确）。 */
  const [prefsReady, setPrefsReady] = useState(false)
  /** 用户在新偏好加载完成前改过 showHidden 时，以本地新值为准。 */
  const hiddenTouchedRef = useRef(false)
  /** 偏好只拉一次（加载期间 showHidden 变化引起的 effect 重跑不重复请求）。 */
  const prefsRequestedRef = useRef(false)
  const [file, setFile] = useState<OpenFile | null>(null)
  const [fileError, setFileError] = useState<{
    path: string
    name: string
    code: string | undefined
  } | null>(null)
  const [nameDialog, setNameDialog] = useState<NameDialog | null>(null)
  const [nameDraft, setNameDraft] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<FsEntryDto | null>(null)
  const [deleteAck, setDeleteAck] = useState(false)
  const [conflict, setConflict] = useState<{ doc: string } | null>(null)
  const [conflictAck, setConflictAck] = useState(false)
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [saving, setSaving] = useState(false)
  /** 目录浏览历史：stack + 当前游标；后退/前进只移动游标不重复入栈。 */
  const [history, setHistory] = useState<{ stack: string[]; index: number }>({
    stack: [],
    index: -1,
  })
  const toastSeq = useRef(0)
  const docGetter = useRef<(() => string) | null>(null)
  /** loadPrefs 完成后判定是否需要按新 showHidden 重列（外部打开竞态）。 */
  const listingRef = useRef<ListResponse | null>(null)
  const showHiddenRef = useRef(showHidden)
  useEffect(() => {
    listingRef.current = listing
    showHiddenRef.current = showHidden
  }, [listing, showHidden])

  const toast = useCallback((text: string, error = false) => {
    const id = ++toastSeq.current
    setToasts((items) => [...items, { id, text, error }])
  }, [])

  const navigate = useCallback(
    async (path?: string, hidden?: boolean, record = true) => {
      setLoading(true)
      setListError(null)
      try {
        const list = await api.list({ path, showHidden: hidden ?? showHidden })
        setListing(list)
        if (record) {
          setHistory((current) => {
            if (current.stack[current.index] === list.path) return current
            const stack = [...current.stack.slice(0, current.index + 1), list.path]
            return { stack, index: stack.length - 1 }
          })
        }
      } catch (error) {
        setListError(error instanceof Error ? error.message : String(error))
      } finally {
        setLoading(false)
      }
    },
    [showHidden],
  )

  /** 加载跨设备偏好：服务端旧值打底、本地新值覆盖（加载间隙的改动优先）。 */
  const loadPrefs = useCallback(async () => {
    try {
      const { prefs } = await api.getPrefs()
      setSortByDir((local) => ({ ...prefs.sortByDir, ...local }))
      if (hiddenTouchedRef.current) return
      setShowHidden(prefs.showHidden)
      // 外部打开（文件链接）可能抢先按默认 showHidden 列过目录：偏好不同时重列
      const current = listingRef.current
      if (current !== null && showHiddenRef.current !== prefs.showHidden) {
        await navigate(current.path, prefs.showHidden)
      }
    } catch (error) {
      warnPrefs('load', error)
    } finally {
      setPrefsReady(true)
    }
  }, [navigate])

  // 面板每次打开时先确保偏好就绪，尚无目录则列 home；关闭时保留现场
  useEffect(() => {
    if (!open) return
    if (!prefsReady) {
      if (!prefsRequestedRef.current) {
        prefsRequestedRef.current = true
        void loadPrefs()
      }
      return
    }
    if (listing === null) void navigate()
  }, [open, prefsReady, listing, navigate, loadPrefs])

  const closePanel = useCallback(() => files.setOpen(false), [files])

  const openEntry = useCallback(
    async (entry: FsEntryDto) => {
      if (entry.kind === 'dir') {
        setFile(null)
        setFileError(null)
        await navigate(entry.path)
        return
      }
      if (entry.kind !== 'file') return
      setFile(null)
      setFileError(null)
      try {
        const read = await api.read({ path: entry.path })
        setFile({ entry, read, editing: false, dirty: false })
      } catch (error) {
        setFileError({
          path: entry.path,
          name: entry.name,
          code: error instanceof FilesApiError ? error.code : undefined,
        })
      }
    },
    [navigate],
  )

  const refresh = useCallback(async () => {
    await navigate(listing?.path)
  }, [navigate, listing?.path])

  const goBack = useCallback(() => {
    if (history.index <= 0) return
    const index = history.index - 1
    setHistory({ ...history, index })
    void navigate(history.stack[index], undefined, false)
  }, [history, navigate])

  const goForward = useCallback(() => {
    if (history.index >= history.stack.length - 1) return
    const index = history.index + 1
    setHistory({ ...history, index })
    void navigate(history.stack[index], undefined, false)
  }, [history, navigate])

  const goHome = useCallback(async () => {
    setFile(null)
    setFileError(null)
    await navigate()
  }, [navigate])

  /** 外部打开（会话内文件链接）：目录直接导航；文件先定位父目录再打开。 */
  const openExternal = useCallback(
    async (path: string) => {
      try {
        const { entry } = await api.stat({ path })
        if (entry.kind === 'dir') {
          setFile(null)
          setFileError(null)
          await navigate(entry.path)
          return
        }
        await navigate(parentPath(entry.path))
        if (entry.kind === 'file') {
          await openEntry(entry)
          return
        }
        setFile(null)
        setFileError({ path: entry.path, name: entry.name, code: undefined })
      } catch (error) {
        toast(
          `${t('error.generic')}: ${error instanceof Error ? error.message : String(error)}`,
          true,
        )
      }
    },
    [navigate, openEntry, t, toast],
  )

  // 消费外部打开请求（seq 去重；面板常驻挂载，重复消费只发生在严格模式双调用）
  const handledRequestSeq = useRef(0)
  useEffect(() => {
    if (request === null || request.seq === handledRequestSeq.current) return
    handledRequestSeq.current = request.seq
    void openExternal(request.path)
  }, [request, openExternal])

  const save = useCallback(
    async (doc: string, force: boolean) => {
      if (file === null || saving) return
      setSaving(true)
      try {
        const result = await api.write({
          path: file.entry.path,
          content: doc,
          baseMtimeMs: force ? undefined : file.read.mtimeMs,
        })
        setFile({
          ...file,
          read: { ...file.read, mtimeMs: result.mtimeMs, size: result.size },
          dirty: false,
        })
        setConflict(null)
        toast(t('toast.saved'))
      } catch (error) {
        if (error instanceof FilesApiError && error.code === 'mtime-conflict' && !force) {
          setConflictAck(false)
          setConflict({ doc })
        } else {
          toast(
            `${t('error.generic')}: ${error instanceof Error ? error.message : String(error)}`,
            true,
          )
        }
      } finally {
        setSaving(false)
      }
    },
    [file, saving, t, toast],
  )

  const submitName = useCallback(async () => {
    if (nameDialog === null || listing === null || nameDraft.trim().length === 0) return
    const name = nameDraft.trim()
    try {
      if (nameDialog.mode === 'mkdir') {
        await api.mkdir(listing.path, name)
        toast(t('toast.created'))
      } else if (nameDialog.mode === 'mkfile') {
        const { entry } = await api.mkfile(listing.path, name)
        toast(t('toast.created'))
        setNameDialog(null)
        await refresh()
        await openEntry(entry)
        return
      } else if (nameDialog.entry !== undefined) {
        const renamed = await api.rename(nameDialog.entry.path, name)
        toast(t('toast.renamed'))
        if (file?.entry.path === nameDialog.entry.path) {
          setFile(null)
          await openEntry({ ...nameDialog.entry, path: renamed.path, name })
        }
      }
      setNameDialog(null)
      await refresh()
    } catch (error) {
      toast(
        `${t('error.generic')}: ${error instanceof Error ? error.message : String(error)}`,
        true,
      )
    }
  }, [file, listing, nameDialog, nameDraft, openEntry, refresh, t, toast])

  const confirmDelete = useCallback(async () => {
    if (deleteTarget === null) return
    try {
      await api.remove(deleteTarget.path)
      toast(t('toast.deleted'))
      if (file?.entry.path === deleteTarget.path) setFile(null)
      setDeleteTarget(null)
      await refresh()
    } catch (error) {
      toast(
        `${t('error.generic')}: ${error instanceof Error ? error.message : String(error)}`,
        true,
      )
    }
  }, [deleteTarget, file, refresh, t, toast])

  const uploadFiles = useCallback(
    async (filesToUpload: FileList) => {
      if (listing === null) return
      for (const item of Array.from(filesToUpload)) {
        try {
          await api.upload(listing.path, item)
          toast(`${t('toast.uploaded')}: ${item.name}`)
        } catch (error) {
          toast(
            `${t('error.generic')}: ${item.name} — ${error instanceof Error ? error.message : String(error)}`,
            true,
          )
        }
      }
      await refresh()
    },
    [listing, refresh, t, toast],
  )

  const registerDocGetter = useCallback((getter: (() => string) | null) => {
    docGetter.current = getter
  }, [])

  const backToList = useCallback(() => {
    setFile(null)
    setFileError(null)
  }, [])

  /** 当前目录的排序偏好；未记忆的目录回退默认（名称升序）。 */
  const currentSort: DirSortPreference = (listing !== null
    ? sortByDir[listing.path]
    : undefined) ?? { key: 'name', dir: 'asc' }

  const changeSort = useCallback(
    (key: SortKey, dir: SortDir) => {
      const path = listing?.path
      if (path === undefined) return
      const value: DirSortPreference = { key, dir }
      setSortByDir((current) => ({ ...current, [path]: value }))
      api.patchPrefs({ sortFor: { path, value } }).catch((error: unknown) => {
        warnPrefs('save sort', error)
      })
    },
    [listing?.path],
  )

  const toggleHidden = useCallback(() => {
    const next = !showHidden
    hiddenTouchedRef.current = true
    setShowHidden(next)
    void navigate(listing?.path, next)
    api.patchPrefs({ showHidden: next }).catch((error: unknown) => {
      warnPrefs('save showHidden', error)
    })
  }, [showHidden, listing?.path, navigate])

  return (
    <>
      <Modal
        open={open}
        onClose={closePanel}
        title={t('panel.title')}
        closeLabel={t('panel.close')}
        headless
        className="wf-modal"
      >
        <div
          className={`wf-panel${file !== null || fileError !== null ? ' wf-panel-viewing' : ''}`}
        >
          <header className="wf-head">
            <span className="wf-title">{t('panel.title')}</span>
            <Tooltip label={t('panel.close')} side="bottom">
              <button
                type="button"
                className="wf-icon-button"
                onClick={closePanel}
                aria-label={t('panel.close')}
              >
                <IconCloseOutline16 />
              </button>
            </Tooltip>
          </header>
          <div className="wf-body">
            <section className="wf-pane-list">
              <Browser
                listing={listing}
                loading={loading}
                error={listError}
                showHidden={showHidden}
                selectedPath={file?.entry.path ?? null}
                canBack={history.index > 0}
                canForward={history.index < history.stack.length - 1}
                sortKey={currentSort.key}
                sortDir={currentSort.dir}
                onSortChange={changeSort}
                t={t}
                onNavigate={(path) => void navigate(path)}
                onBack={goBack}
                onForward={goForward}
                onHome={() => void goHome()}
                onRefresh={() => void refresh()}
                onToggleHidden={toggleHidden}
                onNewFolder={() => {
                  setNameDraft('')
                  setNameDialog({ mode: 'mkdir' })
                }}
                onNewFile={() => {
                  setNameDraft('')
                  setNameDialog({ mode: 'mkfile' })
                }}
                onUpload={(fileList) => void uploadFiles(fileList)}
                onOpenEntry={(entry) => void openEntry(entry)}
                onRename={(entry) => {
                  setNameDraft(entry.name)
                  setNameDialog({ mode: 'rename', entry })
                }}
                onDelete={(entry) => {
                  setDeleteAck(false)
                  setDeleteTarget(entry)
                }}
                onDownload={(entry) => {
                  window.open(api.downloadUrl(entry.path), '_blank')
                }}
              />
            </section>
            <section className="wf-pane-view">
              {file === null && fileError === null && (
                <div className="wf-placeholder">{t('view.placeholder')}</div>
              )}
              {fileError !== null && (
                <FileErrorView
                  name={fileError.name}
                  path={fileError.path}
                  code={fileError.code}
                  t={t}
                  onBack={backToList}
                />
              )}
              {file !== null && (
                <FileView
                  key={file.entry.path}
                  file={file}
                  t={t}
                  saving={saving}
                  onBack={backToList}
                  onEditToggle={() => setFile({ ...file, editing: !file.editing, dirty: false })}
                  onDirty={() =>
                    setFile((current) =>
                      current === null || current.dirty ? current : { ...current, dirty: true },
                    )
                  }
                  onSave={(doc) => void save(doc, false)}
                  onSaveButton={() => {
                    const doc = docGetter.current?.()
                    if (doc !== undefined && doc !== null) void save(doc, false)
                  }}
                  onCopyPath={() => {
                    void writeClipboard(file.entry.path).then(() => toast(t('toast.copied')))
                  }}
                  onDownload={() => window.open(api.downloadUrl(file.entry.path), '_blank')}
                  registerDocGetter={registerDocGetter}
                />
              )}
            </section>
          </div>
        </div>
      </Modal>

      <Modal
        open={nameDialog !== null}
        onClose={() => setNameDialog(null)}
        title={
          nameDialog?.mode === 'mkdir'
            ? t('dialog.mkdir.title')
            : nameDialog?.mode === 'mkfile'
              ? t('dialog.mkfile.title')
              : t('dialog.rename.title')
        }
        closeLabel={t('dialog.cancel')}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setNameDialog(null)}>
              {t('dialog.cancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void submitName()}
              disabled={nameDraft.trim().length === 0}
            >
              {t('dialog.confirm')}
            </Button>
          </>
        }
      >
        <Input
          value={nameDraft}
          placeholder={t('dialog.namePlaceholder')}
          autoFocus
          onChange={(event) => setNameDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submitName()
          }}
        />
      </Modal>

      <RiskConfirmation
        open={deleteTarget !== null}
        title={t('dialog.delete.title')}
        description={`${deleteTarget?.path ?? ''} — ${t('dialog.delete.description')}`}
        acknowledgeLabel={t('dialog.delete.acknowledge')}
        cancelLabel={t('dialog.cancel')}
        confirmLabel={t('view.delete')}
        acknowledged={deleteAck}
        onAcknowledgedChange={setDeleteAck}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
      />

      {conflict !== null && (
        <RiskConfirmation
          open
          title={t('dialog.overwrite.title')}
          description={`${file?.entry.path ?? ''} — ${t('dialog.overwrite.description')}`}
          acknowledgeLabel={t('dialog.overwrite.acknowledge')}
          cancelLabel={t('dialog.cancel')}
          confirmLabel={t('dialog.overwrite.confirm')}
          acknowledged={conflictAck}
          onAcknowledgedChange={setConflictAck}
          onCancel={() => setConflict(null)}
          onConfirm={() => void save(conflict.doc, true)}
        />
      )}

      {toasts.map((item) => (
        <Toast
          key={item.id}
          text={item.text}
          icon={item.error ? <IconWarningOutline16 /> : <IconCheckOutline16 />}
          onDone={() => setToasts((items) => items.filter((current) => current.id !== item.id))}
        />
      ))}
    </>
  )
}

/** 读取失败占位（二进制/权限/非 UTF-8）。 */
function FileErrorView({
  name,
  path,
  code,
  t,
  onBack,
}: {
  name: string
  path: string
  code: string | undefined
  t: Translate
  onBack: () => void
}) {
  const reason =
    code === 'binary-file' || code === 'non-utf8' ? t('view.binary') : (code ?? t('error.generic'))
  return (
    <div className="wf-placeholder">
      <button type="button" className="wf-back" onClick={onBack}>
        {t('list.back')}
      </button>
      <div className="wf-placeholder-title">{name}</div>
      <div className="wf-placeholder-note">{reason}</div>
      <Button
        variant="outline"
        size="sm"
        icon={<IconDownloadOutline16 />}
        onClick={() => window.open(api.downloadUrl(path), '_blank')}
      >
        {t('view.download')}
      </Button>
    </div>
  )
}

interface FileViewProps {
  file: OpenFile
  t: Translate
  saving: boolean
  onBack: () => void
  onEditToggle: () => void
  onDirty: () => void
  onSave: (doc: string) => void
  onSaveButton: () => void
  onCopyPath: () => void
  onDownload: () => void
  registerDocGetter: (getter: (() => string) | null) => void
}

/** 预览/编辑半区：头部动作 + CodeMirror。 */
function FileView({
  file,
  t,
  saving,
  onBack,
  onEditToggle,
  onDirty,
  onSave,
  onSaveButton,
  onCopyPath,
  onDownload,
  registerDocGetter,
}: FileViewProps) {
  const editable = !file.read.truncated
  return (
    <div className="wf-fileview">
      <header className="wf-filehead">
        <button type="button" className="wf-back" onClick={onBack}>
          {t('list.back')}
        </button>
        <span className="wf-filename" title={file.entry.path}>
          {file.entry.name}
          {file.dirty && <span className="wf-dirty">● {t('view.dirty')}</span>}
          {!file.editing && <span className="wf-readonly-tag">{t('view.readonly')}</span>}
        </span>
        <span className="wf-fileactions">
          <Tooltip label={t('toast.copied')} side="bottom">
            <button
              type="button"
              className="wf-icon-button"
              onClick={onCopyPath}
              aria-label="copy path"
            >
              <IconCopyOutline16 />
            </button>
          </Tooltip>
          <Tooltip label={t('view.download')} side="bottom">
            <button
              type="button"
              className="wf-icon-button"
              onClick={onDownload}
              aria-label={t('view.download')}
            >
              <IconDownloadOutline16 />
            </button>
          </Tooltip>
          {editable && !file.editing && (
            <Button variant="toolbar" size="sm" icon={<IconEditOutline16 />} onClick={onEditToggle}>
              {t('view.edit')}
            </Button>
          )}
          {file.editing && (
            <>
              <Button variant="ghost" size="sm" onClick={onEditToggle}>
                {t('view.cancelEdit')}
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={onSaveButton}
                disabled={!file.dirty || saving}
              >
                {t('view.save')}
              </Button>
            </>
          )}
        </span>
      </header>
      {file.read.truncated && <div className="wf-banner">{t('view.tooLarge')}</div>}
      <div className="wf-editor-host">
        <CodeEditor
          value={file.read.content}
          filename={file.entry.name}
          readOnly={!file.editing}
          onDocChanged={onDirty}
          onSaveKey={onSave}
          registerDocGetter={registerDocGetter}
        />
      </div>
    </div>
  )
}

export type { OpenFile }
