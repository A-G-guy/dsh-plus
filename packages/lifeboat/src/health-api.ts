/**
 * lifeboat 健康面板 host 接收面：
 * - GET  /dsh-plus/lifeboat/status  → journal + 翻译状态 + 当前用户 patch 层已禁用的 dsh-plus 插件
 * - POST /dsh-plus/lifeboat/restore {name} → removeDisable + journal + 告警
 * rc8 用户 patch 层热应用：恢复无需重启，watchUserPatches 即时重载。
 * （0.1.2-alpha.1 基线：用户 patch 层热应用机制保留，行为不变。）
 * @module lifeboat/health-api
 */
import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { parseDocument } from 'yaml'
import type { Alerter } from './notify.ts'
import { listDisabled, type PatchEntry, removeDisable } from './patch-file.ts'
import { isGuardedPlugin } from './quarantine.ts'

const ROUTE_STATUS = '/dsh-plus/lifeboat/status'
const ROUTE_RESTORE = '/dsh-plus/lifeboat/restore'

export interface HealthDeps {
  patchFile: string
  journal: (kind: string, detail: string) => void
  alert: Alerter
  /** journal 文档（settings 命名空间内，最新在前的尾插列表）。 */
  readJournal(): Array<{ at: string; kind: string; detail: string }>
  readFallback(): {
    active: boolean
    originalProvider: string
    originalModel: string
    fallbackProvider: string
    at: string
  } | null
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** 解析用户 patch 层中已被禁用且属于 dsh-plus 兄弟域的插件名。 */
export async function readQuarantined(patchFile: string): Promise<string[]> {
  let text: string
  try {
    text = await readFile(patchFile, 'utf-8')
  } catch {
    return []
  }
  const root = parseDocument(text).toJS() as unknown
  if (!Array.isArray(root)) return []
  const ids = listDisabled(root as PatchEntry[])
  return ids.filter((id) => isGuardedPlugin(id) || id.startsWith('dsh-plus-'))
}

/** 注册健康面板路由（webServer 缺席时由调用方保证不调用）。 */
export function registerHealthApi(ctx: Context, deps: HealthDeps): void {
  const logger = ctx.logger('lifeboat')
  ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_STATUS,
    handler: async (_req: IncomingMessage, res: ServerResponse) => {
      try {
        const quarantined = await readQuarantined(deps.patchFile)
        sendJson(res, 200, {
          journal: deps.readJournal(),
          llmFallback: deps.readFallback(),
          quarantined,
        })
      } catch (error) {
        logger.warn(
          `status endpoint failed: ${error instanceof Error ? error.message : String(error)}`,
        )
        sendJson(res, 500, { error: 'internal' })
      }
    },
  })
  ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_RESTORE,
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      try {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'POST only' })
          return
        }
        const body = JSON.parse(await readBody(req)) as { name?: unknown }
        if (typeof body.name !== 'string' || !body.name.startsWith('dsh-plus-')) {
          sendJson(res, 400, { error: 'invalid-name' })
          return
        }
        const written = await removeDisable(deps.patchFile, body.name)
        deps.journal(
          'quarantine-restore',
          written
            ? `${body.name}：已移除用户 patch 层的禁用覆盖（热应用即时恢复）`
            : `${body.name}：无需恢复（patch 层无禁用覆盖）`,
        )
        deps.alert(
          '[DSH] 插件恢复',
          `插件 ${body.name} 的隔离已解除（移除 patch 层禁用覆盖）。${
            written ? 'patch 层热应用即时生效，无需重启。' : 'patch 层本无覆盖，可能已被手动恢复。'
          }`,
        )
        sendJson(res, 200, { ok: true, written })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.warn(`restore endpoint failed: ${message}`)
        sendJson(res, 500, { error: message })
      }
    },
  })
}
