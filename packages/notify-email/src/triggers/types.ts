/**
 * 触发器契约：第三方插件经 ctx.notifyEmail.registerTrigger() 注册，
 * 返回 undefined 表示「不关心该观察」；首个非空产物被投递。
 * 内置官方适配器（decision/turn-end）也经同一接口注册，无特权路径。
 * @module notify-email/triggers/types
 */

/** 一封待投递通知：触发器的产出。 */
export interface EmailNotice {
  subject: string
  text: string
  html?: string
}

/** 决策类观察：工具调用即将阻塞等待用户（tools/pre-execute 观察点，参数已校验）。 */
export interface DecisionCall {
  callId: string
  sessionId: string
  name: string
  args: Record<string, unknown>
}

/** 任务停止类观察：runtime root agent 的 turn 结束且空闲防抖后。 */
export interface TurnEndInfo {
  sessionId: string
  turn: number
  /** turn/end reason.kind：completed | error | aborted（其余 kind 不下发）。 */
  kind: string
  errorMessage?: string
  /** 该会话最后一条 assistant 消息的文本内容。 */
  lastDelivery?: string
}

export interface NotifyTrigger {
  readonly id: string
  /** 决策类通知：返回 undefined 跳过。 */
  onDecision?(call: DecisionCall): EmailNotice | undefined
  /** 任务停止类通知：返回 undefined 跳过。 */
  onTurnEnd?(info: TurnEndInfo): EmailNotice | undefined
}
