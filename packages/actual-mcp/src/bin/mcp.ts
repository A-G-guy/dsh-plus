#!/usr/bin/env node
/**
 * 可移植 MCP 服务入口（格式一）：任意 MCP 宿主（Claude Desktop、DSH 的
 * `dsh-mcp-client` 等）都能用 `npx @dsh-plus/actual-mcp` 起一个 stdio 服务。
 *
 * 配置全部走环境变量（MCP 宿主配置服务即配环境变量，无需配置文件）：
 * `ACTUAL_SERVER_URL` / `ACTUAL_PASSWORD`（或 `ACTUAL_SESSION_TOKEN`）/
 * `ACTUAL_SYNC_ID` / `ACTUAL_DATA_DIR` / `ACTUAL_ENCRYPTION_PASSWORD` /
 * `ACTUAL_CACHE_TTL` / `ACTUAL_LOCK_TIMEOUT` / `ACTUAL_CLI` / `ACTUAL_TOOL_TIMEOUT_MS`。
 *
 * 启动即完成一次能力发现；失败时只写 stderr 并以 1 退出——stdio 服务的 stdout
 * 是协议通道，任何非协议输出都会破坏会话。
 * @module @dsh-plus/actual-mcp/bin
 */
import { serveStdio } from '@modelcontextprotocol/server/stdio'

import { ActualCli, type CliConfig } from '../cli-run.ts'
import { discover } from '../discover.ts'
import { createEntryInvoker } from '../invoke.ts'
import { createNodeDeps } from '../node-io.ts'
import { createActualMcpServer } from '../server.ts'

/** 默认服务端地址（与官方自托管默认端口一致）。 */
const DEFAULT_SERVER_URL = 'http://127.0.0.1:5006'

/** 默认单次工具调用超时（毫秒）。 */
const DEFAULT_TOOL_TIMEOUT_MS = 60_000

/** 解析一个非负整数环境变量；缺省用默认值，给了非法值即报错（不静默兜底）。 */
function intEnv(env: Record<string, string | undefined>, key: string, fallback: number): number {
  const raw = env[key]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`环境变量 ${key} 必须是非负整数，实际为 ${JSON.stringify(raw)}`)
  }
  return value
}

/** 由环境变量拼出 CLI 与连接配置。 */
export function configFromEnv(env: Record<string, string | undefined>): CliConfig {
  return {
    cliCommand: [],
    serverUrl: env.ACTUAL_SERVER_URL ?? DEFAULT_SERVER_URL,
    password: env.ACTUAL_PASSWORD ?? '',
    sessionToken: env.ACTUAL_SESSION_TOKEN ?? '',
    syncId: env.ACTUAL_SYNC_ID ?? '',
    dataDir: env.ACTUAL_DATA_DIR ?? '',
    encryptionPassword: env.ACTUAL_ENCRYPTION_PASSWORD ?? '',
    cacheTtl: intEnv(env, 'ACTUAL_CACHE_TTL', 60),
    lockTimeout: intEnv(env, 'ACTUAL_LOCK_TIMEOUT', 10),
  }
}

/** 启动 stdio MCP 服务。 */
async function main(): Promise<void> {
  const deps = createNodeDeps()
  const config = configFromEnv(deps.env)
  const discovery = await discover(config, deps, { namePrefix: '' })
  for (const warning of discovery.warnings) {
    process.stderr.write(`[actual-mcp] ${warning}\n`)
  }
  process.stderr.write(
    `[actual-mcp] CLI ${discovery.binding.version || 'unknown'}（${discovery.binding.origin}）` +
      ` → ${discovery.entries.length} tools，server ${discovery.serverVersion || 'unknown'}\n`,
  )
  const cli = new ActualCli(discovery.binding, config, deps)
  const invoke = createEntryInvoker(cli, deps, discovery.tree)
  const timeoutMs = intEnv(deps.env, 'ACTUAL_TOOL_TIMEOUT_MS', DEFAULT_TOOL_TIMEOUT_MS)
  serveStdio(() => createActualMcpServer({ entries: discovery.entries, invoke, timeoutMs }))
}

await main().catch((error: unknown) => {
  const detail = error instanceof Error ? error.message : String(error)
  process.stderr.write(`[actual-mcp] 启动失败：${detail}\n`)
  process.exitCode = 1
})
