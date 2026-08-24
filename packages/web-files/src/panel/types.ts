/**
 * 客户端共享小类型：翻译函数与面板开合控制器。
 * @module @dsh-plus/web-files/panel/types
 */
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'

import type { DictKey } from '../locales.ts'
import { NS } from '../locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** 本插件面板文案命名空间。 */
    [NS]: DictKey
  }
}

/** slot locale 座位注入的翻译函数（键域 = 本插件字典 + common 词汇）。 */
export type Translate = TranslateNS<typeof NS>

/** 面板开合状态 + 外部打开请求（会话内文件链接等）。 */
export interface PanelState {
  open: boolean
  /** 外部请求打开的路径；seq 单调递增供面板去重消费。 */
  request: { path: string; seq: number } | null
}

/** footer 按钮与 shell.overlay 面板之间共享的开合控制器。 */
export interface PanelController {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => PanelState
  setOpen: (open: boolean) => void
  toggle: () => void
  /** 外部来源（如会话消息文件链接）请求在面板中打开路径。 */
  requestOpen: (path: string) => void
}

/** 创建一个模块级控制器（apply 内调用一次，inject 给两个 slot 入口）。 */
export function createPanelController(): PanelController {
  let state: PanelState = { open: false, request: null }
  let seq = 0
  const listeners = new Set<() => void>()
  const publish = () => {
    for (const listener of [...listeners]) listener()
  }
  return {
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => state,
    setOpen: (open) => {
      if (state.open === open) return
      state = { ...state, open }
      publish()
    },
    toggle: () => {
      state = { ...state, open: !state.open }
      publish()
    },
    requestOpen: (path) => {
      seq += 1
      state = { open: true, request: { path, seq } }
      publish()
    },
  }
}
