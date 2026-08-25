/**
 * 客户端共享小类型：翻译函数与面板开合控制器（照抄 web-files 模式）。
 * @module web-terminal/panel/types
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

/** slot locale 座位注入的翻译函数（键域 = 本插件字典）。 */
export type Translate = TranslateNS<typeof NS>

/** 面板开合状态（footer 入口与 overlay 面板共享）。 */
export interface PanelState {
  open: boolean
}

/** footer 按钮与 shell.overlay 面板之间共享的开合控制器。 */
export interface PanelController {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => PanelState
  setOpen: (open: boolean) => void
  toggle: () => void
}

/** 创建一个模块级控制器（apply 内调用一次，inject 给两个 slot 入口）。 */
export function createPanelController(): PanelController {
  let state: PanelState = { open: false }
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
      state = { open }
      publish()
    },
    toggle: () => {
      state = { open: !state.open }
      publish()
    },
  }
}
