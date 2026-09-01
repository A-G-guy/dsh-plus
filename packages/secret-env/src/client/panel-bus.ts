/**
 * 会话密钥面板的打开总线（bundle 内模块级 pub/sub）：
 * 斜杠命令的 onSelect 与 overlay 槽里的面板宿主在同一 bundle，
 * 经此按 sessionId 定向投递「打开面板」信号，避免跨 cordis 作用域布线。
 * @module secret-env/client/panel-bus
 */

type Listener = (sessionId: string) => void

const listeners = new Set<Listener>()

/** 请求打开指定会话的密钥面板（由 /secret 命令的 onSelect 调用）。 */
export function requestOpenSessionPanel(sessionId: string): void {
  for (const listener of listeners) listener(sessionId)
}

/** 订阅打开信号；返回退订器（随组件卸载清理）。 */
export function onOpenSessionPanel(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
