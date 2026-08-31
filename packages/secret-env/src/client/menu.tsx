/**
 * `$` 触发补全菜单（conversation.input.overlay 官方插槽，session 作用域）：
 * 在 composer 中输入 `$` 弹出密钥名候选（对齐官方 / 命令与 @ 引用的交互）。
 *
 * 官方 input-trigger 管线的检测核硬编码 '/' 与 '@'（TriggerChar 联合类型），
 * '$' 进不了官方检测，故检测与菜单由本组件自理，插入复用官方会话作用域
 * bail 通道 'slash/input-insert-text'（span + draftRev CAS，编辑器内应用）。
 * @module secret-env/client/menu
 */
import { type ReactElement, useEffect, useRef, useState } from 'react'

import { fetchSecrets, type SecretList } from './api.ts'
import {
  applyChipCorrection,
  type ChipCorrection,
  detectSecretTrigger,
  filterCandidates,
  type SecretCandidate,
  type SecretHit,
  sameHit,
} from './menu-core.ts'

/** 输入状态投影（结构子集；官方 InputState 的读取面）。 */
interface InputStateLike {
  readonly draft: string
  readonly draftRev: number
  readonly phase: string
  readonly occurrences: readonly { readonly offset: number; readonly length: number }[]
}

/** 令牌区间（草稿投影坐标 + 单调修订号，CAS 用）。 */
export interface TokenSpanLike {
  readonly start: number
  readonly end: number
  readonly draftRev: number
}

export interface SecretMenuProps {
  /** 插槽 inject 工厂注入的当前会话 id。 */
  sessionId: string
  t(key: string): string
  /** 框架标准钩子：输入状态快照订阅（SnapshotSelectorHook）。 */
  useInput?<S>(selector: (state: InputStateLike) => S): S
  /** inject 面注入：经官方 scoped bail 通道替换令牌文本；返回是否被编辑器应用。 */
  insertToken(text: string, span: TokenSpanLike): boolean
}

const FALLBACK_INPUT: InputStateLike = { draft: '', draftRev: 0, phase: 'plain', occurrences: [] }

/** 本组件容器向上找到 composer 卡片与 Lexical contenteditable 根。 */
function editorRootOf(el: HTMLElement | null): HTMLElement | null {
  const card = el?.closest('[data-composer-card]')
  const root = card?.querySelector('[contenteditable="true"]')
  return root instanceof HTMLElement ? root : null
}

/**
 * 光标的草稿投影偏移：Range 求光标前渲染文本长，再按光标前的引用芯片
 * （data-composer-chip，DOM 序与 occurrences 的 offset 序一致）修正长度差。
 */
function caretDraftOffset(
  root: HTMLElement,
  occurrences: InputStateLike['occurrences'],
): number | null {
  const sel = window.getSelection()
  if (sel === null || sel.rangeCount === 0 || !sel.isCollapsed) return null
  const range = sel.getRangeAt(0)
  if (!root.contains(range.startContainer)) return null
  const pre = document.createRange()
  pre.selectNodeContents(root)
  pre.setEnd(range.startContainer, range.startOffset)
  const rendered = pre.toString().length
  const corrections: ChipCorrection[] = []
  const chips = root.querySelectorAll('[data-composer-chip]')
  for (let i = 0; i < chips.length; i++) {
    const el = chips[i]
    // 光标位于芯片结束之后（含边界）才计入修正
    if (range.comparePoint(el, el.childNodes.length) > 0) continue
    const occurrence = occurrences[i]
    if (occurrence === undefined) continue
    corrections.push({ rendered: el.textContent?.length ?? 0, draft: occurrence.length })
  }
  return applyChipCorrection(rendered, corrections)
}

function toCandidates(list: SecretList): SecretCandidate[] {
  return [
    ...list.session.map((entry) => ({
      envName: entry.envName,
      name: entry.name,
      description: entry.description,
      scope: 'session' as const,
      once: entry.once,
    })),
    ...list.global.map((entry) => ({
      envName: entry.envName,
      name: entry.name,
      description: entry.description,
      scope: 'global' as const,
    })),
  ]
}

export function SecretMenu(props: SecretMenuProps): ReactElement | null {
  const { sessionId, t, insertToken } = props
  // useInput 是标准钩子 prop，必须无条件调用；旧壳缺席时回落常量（菜单永不展开）。
  const useInput =
    props.useInput ?? (<S,>(_selector: (state: InputStateLike) => S): S => FALLBACK_INPUT as S)
  const input = useInput((state: InputStateLike) => state)

  const [hit, setHit] = useState<SecretHit | null>(null)
  const [items, setItems] = useState<SecretCandidate[] | null>(null)
  const [highlight, setHighlight] = useState(0)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const composingRef = useRef(false)
  /** Esc 抑制：记录被关闭的令牌，token 变化前不重复弹出。 */
  const suppressedRef = useRef<SecretHit | null>(null)

  /** 候选拉取（ref 稳定；挂载、会话切换与菜单展开沿调用）。 */
  const reloadRef = useRef((_sid: string): void => {})
  reloadRef.current = (sid: string) => {
    fetchSecrets(sid)
      .then((list) => setItems(toCandidates(list)))
      .catch(() => setItems([]))
  }
  /** 上一次检测的展开态（展开沿判定用）。 */
  const wasOpenRef = useRef(false)

  // 挂载与会话切换时拉取候选。
  useEffect(() => {
    reloadRef.current(sessionId)
  }, [sessionId])

  // 检测：草稿变化（每次击键）与光标移动（selectionchange）双通道驱动。
  useEffect(() => {
    const update = (): void => {
      const root = editorRootOf(wrapRef.current)
      if (root === null || composingRef.current || input.phase !== 'plain') {
        setHit((prev) => (prev === null ? prev : null))
        wasOpenRef.current = false
        return
      }
      const caret = caretDraftOffset(root, input.occurrences)
      const next = caret === null ? null : detectSecretTrigger(input.draft, caret)
      const suppressed = suppressedRef.current
      const live =
        next !== null &&
        suppressed !== null &&
        next.start === suppressed.start &&
        next.query === suppressed.query
          ? null
          : next
      // 展开沿：闭合 → 命中时刷新候选（密钥可能刚在别处改动）。
      if (live !== null && !wasOpenRef.current) reloadRef.current(sessionId)
      wasOpenRef.current = live !== null
      setHit((prev) => (sameHit(prev, live) ? prev : live))
    }
    update()
    document.addEventListener('selectionchange', update)
    return () => document.removeEventListener('selectionchange', update)
  }, [input, sessionId])

  const candidates = hit === null || items === null ? [] : filterCandidates(items, hit.query)
  const open = hit !== null && candidates.length > 0

  // IME 组合期间不介入（输入法键不应被菜单截获）。
  useEffect(() => {
    const root = editorRootOf(wrapRef.current)
    if (root === null) return
    const onStart = (): void => {
      composingRef.current = true
    }
    const onEnd = (): void => {
      composingRef.current = false
    }
    root.addEventListener('compositionstart', onStart)
    root.addEventListener('compositionend', onEnd)
    return () => {
      root.removeEventListener('compositionstart', onStart)
      root.removeEventListener('compositionend', onEnd)
    }
  }, [])

  const pick = (entry: SecretCandidate): void => {
    if (hit === null) return
    const span = { start: hit.start, end: hit.end, draftRev: input.draftRev }
    insertToken(`$${entry.envName} `, span)
    suppressedRef.current = null
    setHit(null)
  }

  const pickRef = useRef(pick)
  pickRef.current = pick
  const candidatesRef = useRef(candidates)
  candidatesRef.current = candidates
  const highlightRef = useRef(highlight)
  highlightRef.current = highlight

  // 键盘导航：捕获阶段先於 Lexical/官方管线截获；仅在菜单展开时介入。
  useEffect(() => {
    if (!open) return
    const root = editorRootOf(wrapRef.current)
    if (root === null) return
    const onKey = (event: KeyboardEvent): void => {
      const list = candidatesRef.current
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        event.stopPropagation()
        const delta = event.key === 'ArrowDown' ? 1 : -1
        setHighlight((prev) => (prev + delta + list.length) % list.length)
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const entry = list[highlightRef.current] ?? list[0]
        if (entry !== undefined) {
          event.preventDefault()
          event.stopPropagation()
          pickRef.current(entry)
        }
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        suppressedRef.current = hit
        setHit(null)
      }
    }
    root.addEventListener('keydown', onKey, true)
    return () => root.removeEventListener('keydown', onKey, true)
  }, [open, hit])

  // 点 composer 卡片之外处关闭（对齐官方菜单的外部 dismiss 语义）。
  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Node)) return
      const card = wrapRef.current?.closest('[data-composer-card]')
      if (card?.contains(event.target) === true) return
      setHit(null)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [open])

  // 高亮随候选集变化收敛到合法范围。
  useEffect(() => {
    setHighlight((prev) => (candidates.length === 0 ? 0 : Math.min(prev, candidates.length - 1)))
  }, [candidates.length])

  if (!open) {
    // 锚点常驻：闭合态也要挂载容器，检测效果依赖它定位 composer 编辑器根。
    return <div className="dse-menuWrap" ref={wrapRef} />
  }
  return (
    <div className="dse-menuWrap" ref={wrapRef}>
      <div className="dse-menu" role="listbox" aria-label={t('menu.aria')}>
        <div className="dse-menuTitle">{t('menu.title')}</div>
        {candidates.map((entry, index) => (
          <button
            key={`${entry.scope}:${entry.name}`}
            type="button"
            role="option"
            aria-selected={index === highlight}
            className={`dse-menuItem${index === highlight ? ' dse-menuItemActive' : ''}`}
            onMouseEnter={() => setHighlight(index)}
            onMouseDown={(event) => {
              event.preventDefault()
              pick(entry)
            }}
          >
            <span className="dse-menuName">${entry.envName}</span>
            <span className="dse-menuDesc">{entry.description}</span>
            <span className="dse-menuBadges">
              {entry.once === true ? <span className="dse-badge">{t('scopeOnce')}</span> : null}
              <span className="dse-badge dse-badgeDim">
                {entry.scope === 'session' ? t('scopeSession') : t('scopeGlobal')}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
