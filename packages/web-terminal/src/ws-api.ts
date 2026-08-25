/**
 * WebSocket 层：单条连接多路复用全部会话。
 *
 * 协议（protocol.ts 的 ClientMessage/ServerMessage，JSON 文本帧）：
 * C→S attach/detach/input/resize；S→C attached(含 replay)/detached/
 * output/exit/sessions/error。会话列表变更（创建/退出/挂载数变化）广播
 * 给全部活跃连接。
 *
 * 背压：socket 缓冲超过 BACKPRESSURE_LIMIT_BYTES 时丢弃该连接的 output
 * 帧并告警（数据仍在服务端 scrollback，重连重放自愈）。
 * @module web-terminal/ws-api
 */
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'

import type { Context } from '@deepseek-ai/cordis'
import { WebSocket, WebSocketServer } from 'ws'
import {
  BACKPRESSURE_LIMIT_BYTES,
  type ClientMessage,
  clampCols,
  clampRows,
  INPUT_MAX_BYTES,
  type ServerMessage,
} from './protocol.ts'
import type { WebTerminalService } from './registry.ts'
import { TerminalRegistryError } from './registry.ts'
import { isTrustedRequest } from './trust.ts'

/** 每连接的挂载表：sessionId → detach。 */
type Attachments = Map<string, { detach: () => void }>

export function handleUpgrade(
  ctx: Context,
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): void {
  const service = ctx.webTerminal
  const logger = ctx.logger('web-terminal')
  const wss = new WebSocketServer({ noServer: true })

  const reject = (status: number, reason: string): void => {
    const body = reason === 'forbidden' ? 'forbidden' : 'disabled'
    socket.end(
      `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${body.length}\r\n\r\n${body}`,
    )
    wss.close()
  }

  if (!isTrustedRequest(req)) {
    reject(403, 'Forbidden')
    return
  }
  ctx
    .serial('web-terminal/access', { method: 'UPGRADE', endpoint: '/ws' })
    .then(
      () => {
        if (!service.config().enabled) {
          reject(503, 'Service Unavailable')
          return
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
          serveConnection(ctx, ws)
        })
      },
      () => reject(403, 'Forbidden'),
    )
    .catch((error) => {
      logger.warn(`ws upgrade failed: ${error instanceof Error ? error.message : String(error)}`)
      reject(500, 'Internal Server Error')
    })
}

function serveConnection(ctx: Context, ws: WebSocket): void {
  const service = ctx.webTerminal
  const logger = ctx.logger('web-terminal')
  const attachments: Attachments = new Map()
  let droppedOutput = false

  const send = (message: ServerMessage): void => {
    if (ws.readyState !== WebSocket.OPEN) return
    // 背压：缓冲超限时丢 output 帧（scrollback 仍在，重连重放自愈）。
    if (message.kind === 'output' && ws.bufferedAmount > BACKPRESSURE_LIMIT_BYTES) {
      if (!droppedOutput) {
        droppedOutput = true
        logger.warn('ws backpressure: dropping output frames until drained')
      }
      return
    }
    if (message.kind !== 'output') droppedOutput = false
    ws.send(JSON.stringify(message))
  }

  const broadcastSessions = (): void => {
    send({ kind: 'sessions', sessions: service.list(), maxSessions: service.config().maxSessions })
  }

  ws.on('message', (raw) => {
    let message: ClientMessage
    try {
      message = JSON.parse(String(raw)) as ClientMessage
    } catch {
      send({ kind: 'error', message: 'invalid JSON frame', code: 'internal' })
      return
    }
    try {
      dispatch(service, attachments, send, broadcastSessions, message)
    } catch (error) {
      if (error instanceof TerminalRegistryError) {
        send({ kind: 'error', message: error.message, code: error.code })
        return
      }
      const text = error instanceof Error ? error.message : String(error)
      logger.warn(`ws ${message.kind} failed: ${text}`)
      send({ kind: 'error', message: text, code: 'internal' })
    }
  })

  ws.on('close', () => {
    for (const { detach } of attachments.values()) detach()
    attachments.clear()
  })
  ws.on('error', () => ws.terminate())

  broadcastSessions()
}

function dispatch(
  service: WebTerminalService,
  attachments: Attachments,
  send: (message: ServerMessage) => void,
  broadcastSessions: () => void,
  message: ClientMessage,
): void {
  switch (message.kind) {
    case 'attach': {
      if (attachments.has(message.sessionId)) return
      const { session, detach, replay } = service.attach(message.sessionId, {
        output: (data) => send({ kind: 'output', sessionId: message.sessionId, data }),
        exit: (exitCode, signal) => {
          attachments.delete(message.sessionId)
          send({ kind: 'exit', sessionId: message.sessionId, exitCode, signal })
          broadcastSessions()
        },
      })
      attachments.set(message.sessionId, { detach })
      send({ kind: 'attached', session: session.dto(), replay })
      broadcastSessions()
      return
    }
    case 'detach': {
      const attachment = attachments.get(message.sessionId)
      if (attachment === undefined) return
      attachments.delete(message.sessionId)
      attachment.detach()
      send({ kind: 'detached', sessionId: message.sessionId })
      broadcastSessions()
      return
    }
    case 'input': {
      const data = message.data ?? ''
      if (Buffer.byteLength(data, 'utf8') > INPUT_MAX_BYTES) {
        throw new TerminalRegistryError('input exceeds per-message limit', 'input-too-large')
      }
      service.get(message.sessionId).input(data)
      return
    }
    case 'resize': {
      const cols = Number(message.cols)
      const rows = Number(message.rows)
      if (!Number.isFinite(cols) || !Number.isFinite(rows)) {
        throw new TerminalRegistryError('resize requires numeric cols/rows', 'invalid-size')
      }
      service.get(message.sessionId).resize(clampCols(cols), clampRows(rows))
      return
    }
    default:
      send({ kind: 'error', message: 'unknown message kind', code: 'internal' })
  }
}
