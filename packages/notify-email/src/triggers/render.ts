/**
 * 触发器产物的纯函数渲染：各类通知 → 邮件 subject/text。
 * 不依赖 cordis，单测直接覆盖；模板中文、正文超长统一截断。
 * @module notify-email/triggers/render
 */
import type { DecisionCall, EmailNotice, TurnEndInfo } from './types.ts'

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}\n……（内容过长已截断）`
}

function shortSession(sessionId: string): string {
  return sessionId.length > 8 ? sessionId.slice(0, 8) : sessionId
}

function header(reason: string, info: { sessionId: string; turn?: number }): string {
  const turnPart = info.turn === undefined ? '' : ` · turn ${info.turn}`
  return `通知原因：${reason}\n会话：${shortSession(info.sessionId)}${turnPart}\n时间：${new Date().toISOString()}\n`
}

interface QuestionOption {
  label?: unknown
  description?: unknown
}

interface QuestionItem {
  id?: unknown
  header?: unknown
  question?: unknown
  options?: unknown
  multi_select?: unknown
}

function renderOption(option: QuestionOption, index: number): string {
  const label = typeof option?.label === 'string' ? option.label : `选项 ${index + 1}`
  const desc = typeof option?.description === 'string' ? ` — ${option.description}` : ''
  return `  ${index + 1}. ${label}${desc}`
}

function renderQuestion(item: QuestionItem, index: number): string {
  const title = typeof item?.question === 'string' ? item.question : '(未命名问题)'
  const head = typeof item?.header === 'string' ? `【${item.header}】` : ''
  const multi = item?.multi_select === true ? '（可多选）' : ''
  const options = Array.isArray(item?.options) ? item.options : []
  const lines = options.map((o, i) => renderOption(o as QuestionOption, i))
  return [`问题 ${index + 1}：${head}${title}${multi}`, ...lines].join('\n')
}

/** ask_user_question 工具参数 → 通知（问题 + 选项）。 */
export function renderQuestionNotice(call: DecisionCall, maxChars: number): EmailNotice {
  const questions = Array.isArray(call.args['questions']) ? call.args['questions'] : []
  const body = questions.map((q, i) => renderQuestion(q as QuestionItem, i)).join('\n\n')
  return {
    subject: `[DSH] 等待你的回答 · 会话 ${shortSession(call.sessionId)}`,
    text: `${header('agent 提问，等待用户回答', call)}\n${truncate(body, maxChars)}`,
  }
}

/** exit_plan_mode 工具参数 → 通知（plan 全文）。 */
export function renderPlanNotice(call: DecisionCall, maxChars: number): EmailNotice {
  const plan = typeof call.args['plan'] === 'string' ? call.args['plan'] : '(plan 内容缺失)'
  return {
    subject: `[DSH] Plan 待审批 · 会话 ${shortSession(call.sessionId)}`,
    text: `${header('agent 提交了计划，等待审批', call)}\n${truncate(plan, maxChars)}`,
  }
}

/** turn 正常结束 → 通知（最后一条 assistant 交付消息）。 */
export function renderCompletionNotice(info: TurnEndInfo, maxChars: number): EmailNotice {
  const delivery = info.lastDelivery ?? '(本轮无文本交付内容)'
  return {
    subject: `[DSH] 任务执行完毕 · 会话 ${shortSession(info.sessionId)}`,
    text: `${header('任务执行完毕', info)}\n${truncate(delivery, maxChars)}`,
  }
}

/** turn 出错 → 通知（错误信息）。 */
export function renderErrorNotice(info: TurnEndInfo, maxChars: number): EmailNotice {
  const detail = info.errorMessage ?? '(错误详情缺失)'
  return {
    subject: `[DSH] 任务出错停止 · 会话 ${shortSession(info.sessionId)}`,
    text: `${header('任务报错/失败停止', info)}\n${truncate(detail, maxChars)}`,
  }
}

/** turn 被取消 → 通知。 */
export function renderAbortedNotice(info: TurnEndInfo): EmailNotice {
  return {
    subject: `[DSH] 任务被取消 · 会话 ${shortSession(info.sessionId)}`,
    text: header('任务被用户取消', info),
  }
}
