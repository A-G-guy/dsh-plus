/**
 * 面板开合与跨标签联动控制器：footer 入口 ↔ overlay 面板共享开合态；
 * 画廊「二次编辑」经 editSeed 单向投递给图生图表单（nonce 保证同参可重复触发）。
 * 模式照抄 web-files/web-terminal 的 PanelController。
 * @module image-studio/client/panel/controller
 */

/** 面板标签页。 */
export type StudioTab = 'generation' | 'edit' | 'gallery'

/** 二次编辑种子（画廊条目 → 图生图表单回填）。 */
export interface EditSeed {
  /** 源图 imageId 列表（≤16）。 */
  sourceIds: string[]
  /** 历史提示词回填。 */
  prompt: string
  /** 历史请求参数回填（画廊条目 params 快照）。 */
  params: Record<string, unknown>
  /** 历史提供商预设（存在则预选）。 */
  providerPresetId: string | null
  /** 触发序号：同一参数再次「二次编辑」也需重新生效。 */
  nonce: number
}

/** 面板状态（footer 按钮与 overlay 面板共享）。 */
export interface PanelState {
  open: boolean
  tab: StudioTab
  editSeed: EditSeed | null
}

/** footer 按钮与 shell.overlay 面板之间共享的控制器。 */
export interface PanelController {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => PanelState
  setOpen: (open: boolean) => void
  toggle: () => void
  setTab: (tab: StudioTab) => void
  /** 投递二次编辑种子并切到图生图标签。 */
  seedEdit: (seed: Omit<EditSeed, 'nonce'>) => void
}

/** 创建一个模块级控制器（apply 内调用一次，inject 给两个 slot 入口）。 */
export function createPanelController(): PanelController {
  let state: PanelState = { open: false, tab: 'generation', editSeed: null }
  let nonce = 0
  const listeners = new Set<() => void>()
  const publish = () => {
    for (const listener of [...listeners]) listener()
  }
  const set = (next: PanelState) => {
    state = next
    publish()
  }
  return {
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => state,
    setOpen: (open) => {
      if (state.open === open) return
      set({ ...state, open })
    },
    toggle: () => set({ ...state, open: !state.open }),
    setTab: (tab) => {
      if (state.tab === tab) return
      set({ ...state, tab })
    },
    seedEdit: (seed) => {
      nonce += 1
      set({ ...state, tab: 'edit', editSeed: { ...seed, nonce } })
    },
  }
}
