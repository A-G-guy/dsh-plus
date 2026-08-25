/**
 * 分屏布局纯函数：标签 = window，标签内是二叉分割树（tmux 语义映射）。
 * 全部操作返回新树（不可变），供 React 状态与单测消费。
 *
 * 节点：内部 { dir: 'row'|'col', children, sizes }（sizes 为百分比且和为 1）
 * 或叶 { type: 'pane', sessionId }。任何操作后调用 normalize 修正：
 * 空内部节点塌缩、单子内部节点提升、sizes 重新平摊。
 * @module web-terminal/panel/layout
 */

export interface PaneNode {
  type: 'pane'
  sessionId: string
}

export interface SplitNode {
  type: 'split'
  dir: 'row' | 'col'
  children: LayoutNode[]
  /** 与 children 对齐的尺寸占比（0..1，和为 1）。 */
  sizes: number[]
}

export type LayoutNode = PaneNode | SplitNode

export interface TabState {
  id: string
  name: string
  tree: LayoutNode
  /** 当前焦点叶的 sessionId。 */
  focus: string
}

/** 分割方向。 */
export type SplitDir = 'row' | 'col'

let seq = 0

export function mintTabId(): string {
  seq += 1
  return `tab-${seq}`
}

export function newTab(name: string, sessionId: string): TabState {
  return { id: mintTabId(), name, tree: { type: 'pane', sessionId }, focus: sessionId }
}

/** 收集树中全部叶的 sessionId（先序）。 */
export function paneIds(tree: LayoutNode): string[] {
  if (tree.type === 'pane') return [tree.sessionId]
  return tree.children.flatMap(paneIds)
}

/** 是否为叶节点。 */
function isPane(node: LayoutNode): node is PaneNode {
  return node.type === 'pane'
}

/** 规范化：空 children 塌缩（由上层移除）、单子提升、sizes 平摊修正。 */
function normalize(node: LayoutNode): LayoutNode | null {
  if (isPane(node)) return node
  const children = node.children
    .map((child) => normalize(child))
    .filter((child): child is LayoutNode => child !== null)
  if (children.length === 0) return null
  if (children.length === 1) return children[0] ?? node
  const sizes = evenSizes(children.length)
  return { type: 'split', dir: node.dir, children, sizes }
}

function evenSizes(count: number): number[] {
  return Array.from({ length: count }, () => 1 / count)
}

/** 在指定叶的位置按 dir 分割，新叶占据 prefer 比例（0..1）。 */
export function splitPane(
  tree: LayoutNode,
  targetSessionId: string,
  dir: SplitDir,
  newSessionId: string,
  prefer = 0.5,
): LayoutNode {
  const replaced = walk(tree, targetSessionId, (pane) => ({
    type: 'split',
    dir,
    children: [pane, { type: 'pane', sessionId: newSessionId }],
    sizes: [1 - prefer, prefer],
  }))
  return replaced ?? tree
}

/** 用新会话替换指定叶（不改变树形状）。 */
export function replacePane(
  tree: LayoutNode,
  targetSessionId: string,
  newSessionId: string,
): LayoutNode {
  const replaced = walk(tree, targetSessionId, (pane) => ({ ...pane, sessionId: newSessionId }))
  return replaced ?? tree
}

/** 移除含指定会话的叶；返回新树或 null（整树塌缩）。 */
export function removePane(tree: LayoutNode, sessionId: string): LayoutNode | null {
  if (isPane(tree)) return tree.sessionId === sessionId ? null : tree
  const kept: LayoutNode[] = []
  for (const child of tree.children) {
    const normalized = removePane(child, sessionId)
    if (normalized !== null) kept.push(normalized)
  }
  if (kept.length === 0) return null
  if (kept.length === 1) return kept[0] ?? tree
  return { type: 'split', dir: tree.dir, children: kept, sizes: evenSizes(kept.length) }
}

/** 从指定叶出发按方向移动焦点（row: 左右；col: 上下），循环环绕。 */
export function moveFocus(tree: LayoutNode, fromSessionId: string, delta: 1 | -1): string | null {
  const leaves = paneIds(tree)
  const index = leaves.indexOf(fromSessionId)
  if (index < 0) return null
  return leaves[(index + delta + leaves.length) % leaves.length] ?? null
}

/** 调整同层相邻叶的尺寸比例：ratio 为 sibling 占「index+sibling 合计」的比例（0.1..0.9 钳制），其余层比例不动。 */
export function resizeSibling(
  tree: LayoutNode,
  sessionId: string,
  siblingIndex: number,
  ratio: number,
): LayoutNode {
  if (isPane(tree)) return tree
  const index = tree.children.findIndex((child) => paneIds(child).includes(sessionId))
  if (
    index >= 0 &&
    siblingIndex >= 0 &&
    siblingIndex < tree.children.length &&
    siblingIndex !== index
  ) {
    const sizes = [...tree.sizes]
    const mine = sizes[index] ?? 0
    const theirs = sizes[siblingIndex] ?? 0
    const total = mine + theirs
    const clamped = Math.min(0.9, Math.max(0.1, ratio))
    sizes[siblingIndex] = total * clamped
    sizes[index] = total * (1 - clamped)
    return { ...tree, sizes }
  }
  const children = tree.children.map((child) =>
    resizeSibling(child, sessionId, siblingIndex, ratio),
  )
  return { ...tree, children }
}

/** 内部遍历：把命中 sessionId 的叶替换为 mapper 结果。 */
function walk(
  tree: LayoutNode,
  sessionId: string,
  mapper: (pane: PaneNode) => LayoutNode,
): LayoutNode | null {
  if (isPane(tree)) return tree.sessionId === sessionId ? mapper(tree) : tree
  let changed = false
  const children = tree.children.map((child) => {
    const result = walk(child, sessionId, mapper)
    if (result !== child) changed = true
    return result === null ? child : result
  })
  if (!changed) return tree
  const normalized = normalize({ ...tree, children })
  return normalized
}

/** 找到包含 sessionId 的分割层中该叶的下标（无分割层返回 null）。 */
export function paneIndexInParent(tree: LayoutNode, sessionId: string): number | null {
  if (isPane(tree)) return null
  const index = tree.children.findIndex((child) => paneIds(child).includes(sessionId))
  if (index >= 0) return index
  for (const child of tree.children) {
    const found = paneIndexInParent(child, sessionId)
    if (found !== null) return found
  }
  return null
}
