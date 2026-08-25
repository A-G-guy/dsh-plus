/**
 * 终端工作台面板根组件：标签条（多会话/多窗口）+ 分屏树渲染 + 分割条拖拽。
 * 桌面多标签多分屏；移动端（≤767px）单叶显示 + 叶切换（CSS 驱动），
 * 不支持分屏，底部浮动辅助键盘（Esc/Tab/Ctrl/Alt/Shift/方向键）。
 * @module web-terminal/panel/terminal-panel
 */
import {
  Fragment,
  type ReactElement,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'

import type { SessionDto } from '../protocol.ts'
import { TerminalConnection } from './connection.ts'
import {
  IconFocusOutline16,
  IconSplitHOutline16,
  IconSplitVOutline16,
  IconTerminalOutline16,
} from './icons.tsx'
import { MobileKeybar } from './keybar.tsx'
import {
  type LayoutNode,
  newTab,
  paneIds,
  removePane,
  replacePane,
  resizeSibling,
  splitPane,
  type TabState,
} from './layout.ts'
import { ModifierStore } from './modifiers.ts'
import {
  Button,
  IconCloseOutline16,
  IconEditOutline16,
  IconPlusOutline16,
  Menu,
  Modal,
} from './primitives.ts'
import type { PanelController, Translate } from './types.ts'
import { XtermView } from './xterm-view.tsx'

export interface TerminalPanelProps {
  terminal: PanelController
  t: Translate
}

/** 拖拽中的分割条状态。 */
interface DragState {
  sessionId: string
  siblingIndex: number
  axis: 'x' | 'y'
  origin: number
  total: number
  baseline: number
}

export function TerminalPanel(props: TerminalPanelProps): ReactElement {
  const { terminal, t } = props
  const { open } = useSyncExternalStore(terminal.subscribe, terminal.getSnapshot)
  const connection = useMemo(() => new TerminalConnection(), [])
  const snapshot = useSyncExternalStore(connection.subscribe, connection.getSnapshot)
  const [tabs, setTabs] = useState<TabState[]>([])
  const [activeTab, setActiveTab] = useState<string | null>(null)
  const [closeTarget, setCloseTarget] = useState<{ tab: TabState; session: string } | null>(null)
  const [renaming, setRenaming] = useState<{ tabId: string; value: string } | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  /** 移动端修饰键（keybar 与 xterm 输入共享，sticky-once）。 */
  const modifiers = useMemo(() => new ModifierStore(), [])
  /** 面板由闭转开只引导一次：关闭全部标签后不再自动复活会话。 */
  const bootstrappedRef = useRef(false)
  /** 已请求 kill、等待服务端 exit 确认的会话（引导接管须跳过）。 */
  const pendingKillRef = useRef(new Set<string>())

  useEffect(() => {
    if (open) connection.start()
    return () => connection.dispose()
  }, [open, connection])

  // 服务端会话退出 → 从所有标签树移除该叶。
  // biome-ignore lint/correctness/useExhaustiveDependencies: 仅在 revision 变化时重算；sessions 随 revision 同步发布，额外依赖会引起多余重放
  useEffect(() => {
    const exited = snapshot.sessions
      .filter((session) => !session.running)
      .map((session) => session.id)
    if (exited.length === 0) return
    for (const id of exited) pendingKillRef.current.delete(id)
    setTabs((current) => {
      let next = current
      for (const id of exited) {
        next = next
          .map((tab) => ({ ...tab, tree: removePane(tab.tree, id) ?? tab.tree }))
          .filter((tab) => paneIds(tab.tree).length > 0 || paneIds(tab.tree).includes(id))
      }
      return next.filter((tab) => paneIds(tab.tree).some((pane) => !exited.includes(pane)))
    })
  }, [snapshot.revision, snapshot.sessions])

  const sessionById = useMemo(() => {
    const map = new Map<string, SessionDto>()
    for (const session of snapshot.sessions) map.set(session.id, session)
    return map
  }, [snapshot.sessions])

  const currentTab = tabs.find((tab) => tab.id === activeTab) ?? null

  const createSessionInTab = useCallback(
    async (tabId: string | null, dir?: 'row' | 'col', targetSession?: string) => {
      // 移动端不支持分屏（按钮已隐藏，此为逻辑兜底）。
      if (dir !== undefined && isMobileViewport()) return
      if (snapshot.sessions.filter((s) => s.running).length >= snapshot.maxSessions) return
      try {
        const session = await connection.createSession()
        if (tabId === null) {
          const tab = newTab(session.name, session.id)
          setTabs((current) => [...current, tab])
          setActiveTab(tab.id)
          return
        }
        setTabs((current) =>
          current.map((tab) => {
            if (tab.id !== tabId) return tab
            if (dir === undefined || targetSession === undefined) {
              // 未指定分割 → 替换空叶或聚焦叶。
              const focusLeaf = findLeaf(tab.tree, tab.focus)
              return {
                ...tab,
                tree: replacePane(tab.tree, focusLeaf ?? tab.focus, session.id),
                focus: session.id,
              }
            }
            return {
              ...tab,
              tree: splitPane(tab.tree, targetSession, dir, session.id),
              focus: session.id,
            }
          }),
        )
      } catch {
        /* 错误展示走 snapshot.error */
      }
    },
    [connection, snapshot.maxSessions, snapshot.sessions],
  )

  // 引导：仅在面板由闭转开后执行一次——优先接管最近活动的存活会话
  // （面板重开/页面刷新后恢复既有终端，类 tmux attach）；无可用会话才新建。
  // 关闭全部标签后不再自动复活（曾导致「全部关闭又冒出一个/多个」）。
  useEffect(() => {
    if (!open) {
      bootstrappedRef.current = false
      return
    }
    if (snapshot.state !== 'open' || bootstrappedRef.current) return
    bootstrappedRef.current = true
    if (tabs.length > 0) return
    const running = snapshot.sessions.filter((s) => s.running && !pendingKillRef.current.has(s.id))
    const reuse = [...running].sort((a, b) => b.lastActivityMs - a.lastActivityMs)[0]
    if (reuse !== undefined) {
      const tab = newTab(reuse.name, reuse.id)
      setTabs([tab])
      setActiveTab(tab.id)
      return
    }
    if (running.length < snapshot.maxSessions) void createSessionInTab(null)
  }, [
    open,
    snapshot.state,
    snapshot.maxSessions,
    snapshot.sessions,
    tabs.length,
    createSessionInTab,
  ])

  const closeTab = useCallback(
    (tab: TabState) => {
      const panes = paneIds(tab.tree)
      for (const id of panes) {
        pendingKillRef.current.add(id)
        void connection.killSession(id)
      }
      setTabs((current) => current.filter((item) => item.id !== tab.id))
      setActiveTab((current) => (current === tab.id ? null : current))
    },
    [connection],
  )

  // 分割条拖拽（pointer 事件，body 级监听）。
  const startDrag = useCallback(
    (
      event: ReactPointerEvent,
      sessionId: string,
      siblingIndex: number,
      axis: 'x' | 'y',
      container: HTMLElement,
    ) => {
      const rect = container.getBoundingClientRect()
      dragRef.current = {
        sessionId,
        siblingIndex,
        axis,
        origin: axis === 'x' ? event.clientX : event.clientY,
        total: axis === 'x' ? rect.width : rect.height,
        baseline: 0.5,
      }
      const onMove = (move: PointerEvent): void => {
        const drag = dragRef.current
        if (drag === null) return
        const delta = (drag.axis === 'x' ? move.clientX : move.clientY) - drag.origin
        const ratio = drag.baseline + delta / drag.total
        setTabs((current) =>
          current.map((tab) =>
            tab.id === activeTab
              ? { ...tab, tree: applyDrag(tab.tree, drag.sessionId, drag.siblingIndex, ratio) }
              : tab,
          ),
        )
      }
      const onUp = (): void => {
        dragRef.current = null
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [activeTab],
  )

  if (!open) return null
  if (snapshot.state === 'disabled') {
    return (
      <Modal open title={t('panel.title')} onClose={() => terminal.setOpen(false)}>
        {t('state.disabled')}
      </Modal>
    )
  }

  // 未挂进任何标签树的存活会话（可放入当前焦点叶）。
  const hiddenSessions = snapshot.sessions.filter(
    (session) => session.running && !tabs.some((tab) => paneIds(tab.tree).includes(session.id)),
  )

  return (
    <Modal
      open
      title={t('panel.title')}
      onClose={() => terminal.setOpen(false)}
      headless
      className="wt-modal"
    >
      <div className="wt-panel" ref={rootRef}>
        <div className="wt-tabbar">
          <div className="wt-tabs">
            {tabs.map((tab) => (
              <div key={tab.id} className={`wt-tab${tab.id === activeTab ? ' wt-tab-active' : ''}`}>
                <button type="button" className="wt-tab-main" onClick={() => setActiveTab(tab.id)}>
                  <IconTerminalOutline16 size={14} />
                  <span className="wt-tab-name">{tab.name}</span>
                </button>
                <button
                  type="button"
                  className="wt-tab-icon"
                  aria-label={t('tab.rename')}
                  onClick={() => setRenaming({ tabId: tab.id, value: tab.name })}
                >
                  <IconEditOutline16 size={12} />
                </button>
                <button
                  type="button"
                  className="wt-tab-icon"
                  aria-label={t('tab.close')}
                  onClick={() => setCloseTarget({ tab, session: paneIds(tab.tree)[0] ?? '' })}
                >
                  <IconCloseOutline16 size={12} />
                </button>
              </div>
            ))}
          </div>
          <Button
            variant="ghost"
            onClick={() => createSessionInTab(activeTab)}
            aria-label={t('tab.new')}
            title={t('tab.new')}
          >
            <IconPlusOutline16 />
          </Button>
          {/* 退出按钮：headless Modal 无头部关闭钮，移动端全屏时这是唯一出口 */}
          <Button
            variant="ghost"
            onClick={() => terminal.setOpen(false)}
            aria-label={t('panel.exit')}
            title={t('panel.exit')}
          >
            <IconCloseOutline16 />
          </Button>
        </div>

        {currentTab === null ? (
          <div className="wt-empty">{t('pane.empty')}</div>
        ) : (
          <div className="wt-body">
            <div className="wt-toolbar">
              <Button
                variant="ghost"
                className="wt-desktop-only"
                title={t('toolbar.splitH')}
                aria-label={t('toolbar.splitH')}
                onClick={() => createSessionInTab(currentTab.id, 'row', currentTab.focus)}
              >
                <IconSplitHOutline16 />
              </Button>
              <Button
                variant="ghost"
                className="wt-desktop-only"
                title={t('toolbar.splitV')}
                aria-label={t('toolbar.splitV')}
                onClick={() => createSessionInTab(currentTab.id, 'col', currentTab.focus)}
              >
                <IconSplitVOutline16 />
              </Button>
              <Button
                variant="ghost"
                className="wt-desktop-only"
                title={t('toolbar.focusOnly')}
                aria-label={t('toolbar.focusOnly')}
                onClick={() =>
                  setTabs((current) =>
                    current.map((tab) =>
                      tab.id === currentTab.id
                        ? { ...tab, tree: { type: 'pane', sessionId: currentTab.focus } }
                        : tab,
                    ),
                  )
                }
              >
                <IconFocusOutline16 />
              </Button>
              {hiddenSessions.length > 0 && (
                <PlaceMenu
                  sessions={hiddenSessions}
                  onPlace={(sessionId) =>
                    setTabs((current) =>
                      current.map((tab) =>
                        tab.id === currentTab.id
                          ? {
                              ...tab,
                              tree: replacePane(tab.tree, currentTab.focus, sessionId),
                              focus: sessionId,
                            }
                          : tab,
                      ),
                    )
                  }
                  t={t}
                />
              )}
              <div className="wt-toolbar-status">
                {snapshot.state === 'closed' && (
                  <span className="wt-status-warn">{t('pane.reconnect')}</span>
                )}
                {snapshot.error !== null && (
                  <span className="wt-status-warn">
                    {t('state.error').replace('{message}', snapshot.error)}
                  </span>
                )}
              </div>
            </div>
            <div className="wt-tree">
              {renderTree(currentTab.tree, currentTab.focus, (id) =>
                setTabs((current) =>
                  current.map((tab) => (tab.id === currentTab.id ? { ...tab, focus: id } : tab)),
                ),
              )}
            </div>
          </div>
        )}
        {currentTab !== null && (
          <MobileKeybar
            modifiers={modifiers}
            onSend={(data) => connection.input(currentTab.focus, modifiers.consume(data))}
            t={t}
          />
        )}
      </div>

      {closeTarget !== null && (
        <Modal
          open
          title={t('tab.closeConfirm.title')}
          description={t('tab.closeConfirm.description')}
          onClose={() => setCloseTarget(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setCloseTarget(null)}>
                {t('tab.closeConfirm.cancel')}
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  closeTab(closeTarget.tab)
                  setCloseTarget(null)
                }}
              >
                {t('tab.close')}
              </Button>
            </>
          }
        />
      )}
      {renaming !== null && (
        <Modal open title={t('tab.rename')} onClose={() => setRenaming(null)}>
          <input
            className="wt-rename-input"
            value={renaming.value}
            onChange={(event) => setRenaming({ ...renaming, value: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                const trimmed = renaming.value.trim()
                if (trimmed.length > 0) {
                  const firstPane = tabs.find((tab) => tab.id === renaming.tabId)
                  const paneSession =
                    firstPane !== undefined ? paneIds(firstPane.tree)[0] : undefined
                  if (paneSession !== undefined) void connection.renameSession(paneSession, trimmed)
                  setTabs((current) =>
                    current.map((tab) =>
                      tab.id === renaming.tabId ? { ...tab, name: trimmed } : tab,
                    ),
                  )
                }
                setRenaming(null)
              }
            }}
            // biome-ignore lint/a11y/noAutofocus: 重命名对话框是瞬时输入场景，自动聚焦是核心交互
            autoFocus
          />
        </Modal>
      )}
    </Modal>
  )

  /** 递归渲染分割树。 */
  function renderTree(
    node: LayoutNode,
    focus: string,
    onPaneClick: (sessionId: string) => void,
  ): ReactElement {
    if (node.type === 'pane') {
      const session = sessionById.get(node.sessionId)
      return (
        // biome-ignore lint/a11y/noStaticElementInteractions: 终端叶容器需承接点击聚焦；键盘输入由 xterm 内部 textarea 承载
        <div
          key={node.sessionId}
          className={`wt-leaf${focus === node.sessionId ? ' wt-leaf-focus' : ''}`}
          onMouseDown={() => onPaneClick(node.sessionId)}
        >
          <XtermView
            sessionId={node.sessionId}
            running={session?.running ?? true}
            connection={connection}
            focused={focus === node.sessionId}
            modifiers={modifiers}
            t={t}
          />
        </div>
      )
    }
    return (
      <div
        key={node.dir}
        className={`wt-split wt-split-${node.dir}`}
        style={node.dir === 'row' ? { flexDirection: 'row' } : { flexDirection: 'column' }}
      >
        {node.children.map((child, index) => (
          <Fragment key={paneIds(child).join(',') || index}>
            {index > 0 && (
              <div
                className={`wt-gutter wt-gutter-${node.dir}`}
                onPointerDown={(event) => {
                  // 阻断浏览器原生拖拽/文本选择接管后续 pointer 事件。
                  event.preventDefault()
                  const container = rootRef.current?.querySelector('.wt-tree')
                  if (container instanceof HTMLElement) {
                    startDrag(
                      event,
                      paneIds(node.children[index - 1] ?? child)[0] ?? '',
                      index,
                      node.dir === 'row' ? 'x' : 'y',
                      container,
                    )
                  }
                }}
              />
            )}
            <div
              className="wt-cell"
              style={{ flexBasis: `${(node.sizes[index] ?? 1 / node.children.length) * 100}%` }}
            >
              {renderTree(child, focus, onPaneClick)}
            </div>
          </Fragment>
        ))}
      </div>
    )
  }
}

/** 窄屏判定（与样式断点 767px 对齐）：移动端禁用分屏。 */
function isMobileViewport(): boolean {
  return window.matchMedia('(max-width: 767px)').matches
}

/** 找到含 sessionId 的叶（该叶存在即返回 sessionId 本身）。 */
function findLeaf(tree: LayoutNode, sessionId: string): string | null {
  return paneIds(tree).includes(sessionId) ? sessionId : (paneIds(tree)[0] ?? null)
}

/** 拖拽应用：委托 layout.resizeSibling。 */
function applyDrag(
  tree: LayoutNode,
  sessionId: string,
  siblingIndex: number,
  ratio: number,
): LayoutNode {
  const clamped = Math.min(0.9, Math.max(0.1, ratio))
  return resizeSibling(tree, sessionId, siblingIndex, clamped)
}

/** 「放入会话」下拉：把未挂树的存活会话放进当前焦点叶。 */
function PlaceMenu({
  sessions,
  onPlace,
  t,
}: {
  sessions: SessionDto[]
  onPlace: (sessionId: string) => void
  t: Translate
}) {
  const [open, setOpen] = useState(false)
  return (
    <Menu
      open={open}
      portal
      align="start"
      anchor={
        <button
          type="button"
          className="wt-place-button"
          aria-label={t('toolbar.place')}
          onClick={() => setOpen((value) => !value)}
        >
          {t('toolbar.place')}
        </button>
      }
      items={sessions.map((session) => ({ id: session.id, label: session.name }))}
      onSelect={(id) => {
        setOpen(false)
        onPlace(id)
      }}
      onClose={() => setOpen(false)}
    />
  )
}
