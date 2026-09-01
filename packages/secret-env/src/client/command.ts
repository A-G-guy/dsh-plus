/**
 * `/var` 斜杠命令（dsh-client-ui-commands 的 commandUi 服务）：
 * contribution 仅支持官方 popupSelect 壳（kind 唯一），故命令提供单个
 * 「打开面板」动作，选中后经打开总线唤起本会话的变量面板——
 * 完全自定义的 React 面板只能在自己占有的 overlay 槽渲染。
 * 子代理会话不提供本命令（对齐官方 /model 的可用性过滤）。
 * @module secret-env/client/command
 */
import { requestOpenSessionPanel } from './panel-bus.ts'

/** commandUi 服务的结构子集（dsh-client-ui-commands CommandUiContract）。 */
interface CommandUiLike {
  register(contribution: {
    name: string
    description: string
    available(session: { sessionId: string }): boolean
    ui: {
      kind: 'popupSelect'
      options(session: { sessionId: string }): Promise<readonly { id: string; label: string }[]>
      onSelect(option: { id: string }, session: { sessionId: string }): void | Promise<void>
    }
  }): () => void
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
  t: (key: string) => string,
): void {
  ctx.inject(['commandUi'], (scope) => {
    scope.effect(
      () =>
        scope.commandUi.register({
          name: 'var',
          description: t('command.description'),
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
