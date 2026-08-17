/**
 * 通知投递审计：每次发送尝试追加一行 JSONL 到 $DSH_HOME/logs/notify-email.jsonl。
 * 让 dry-run 可观测（dev 实例 logger 不落盘），也为生产排查「为什么没收到邮件」留痕。
 * 记录正文截断 2000 字符；永远不含 SMTP 凭据。写失败只告警不阻断。
 * @module notify-email/audit
 */
import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface AuditRecord {
  time: string
  subject: string
  to: string[]
  /** sent | dry-run | disabled | incomplete | 错误消息 */
  result: string
  bodyExcerpt: string
}

const BODY_EXCERPT_CHARS = 2000

export function buildAuditRecord(
  subject: string,
  text: string,
  to: string[],
  result: string,
): AuditRecord {
  return {
    time: new Date().toISOString(),
    subject,
    to: [...to],
    result,
    bodyExcerpt: text.length > BODY_EXCERPT_CHARS ? `${text.slice(0, BODY_EXCERPT_CHARS)}…` : text,
  }
}

export type AuditSink = (record: AuditRecord) => void

/** 构造 JSONL 落盘 sink（fire-and-forget；写入串行排队保证行序，失败经 onError 告警）。 */
export function createJsonlAuditSink(path: string, onError: (message: string) => void): AuditSink {
  let queue: Promise<void> = mkdir(dirname(path), { recursive: true }).then(() => undefined)
  return (record) => {
    queue = queue
      .then(() => appendFile(path, `${JSON.stringify(record)}\n`, 'utf8'))
      .catch((error: unknown) => {
        onError(error instanceof Error ? error.message : String(error))
      })
  }
}
