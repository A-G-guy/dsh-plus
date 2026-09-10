/**
 * `/var` 斜杠命令（dsh-client-ui-commands 的 commandUi 服务）：
 * contribution 仅支持官方 popupSelect 壳（kind 唯一），故命令提供单个
 * 「打开面板」动作，选中后经打开总线唤起本会话的变量面板——
 * 完全自定义的 React 面板只能在自己占有的 overlay 槽渲染。
 * 子代理会话不提供本命令（对齐官方 /model 的可用性过滤）。
 * @module secret-env/client/command
 */
import type { CommandContribution } from '@deepseek-ai/dsh-client-ui-commands/client'
import type { Translate } from './i18n.ts'
import { requestOpenSessionPanel } from './panel-bus.ts'

/**
 * commandUi 服务的结构子集。contribution 形状直接取自官方契约——
 * 平台在 alpha 线把 `description` 从字符串改成惰性求值函数，本地结构类型
 * 若不跟官方契约同源，传字符串会在候选合成期抛 TypeError，被 input-trigger
 * 静默摘除整个 `command` 源（斜杠菜单只剩 skill 分组）。
 */
interface CommandUiLike {
  register(contribution: CommandContribution): () => void
}

interface CommandScope {
  commandUi: CommandUiLike
  effect(execute: () => () => void, label?: string): unknown
}

interface CommandHostContext {
  inject(keys: readonly string[], callback: (scope: CommandScope) => void): unknown
}

interface SessionsAvailabilityLike {
  subagentAddress?(sessionId: string): unknown
}

/** 注册 /var 命令（commandUi 服务缺席时 inject 回调不触发，自然跳过）。 */
export function registerVarCommand(
  ctx: CommandHostContext,
  sessions: SessionsAvailabilityLike,
  t: Translate,
): void {
  ctx.inject(['commandUi'], (scope) => {
    scope.effect(
      () =>
        scope.commandUi.register({
          name: 'var',
          description: () => t('command.description'),
          available: (session) => sessions.subagentAddress?.(session.sessionId) === undefined,
          ui: {
            kind: 'popupSelect',
            options: () => Promise.resolve([{ id: 'open', label: t('command.openPanel') }]),
            onSelect: (_option, session) => {
              requestOpenSessionPanel(session.sessionId)
            },
          },
        }),
      'secret-env: /var contribution',
    )
  })
}
