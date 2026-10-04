import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { ActualService, ActualStatus } from '@dsh-plus/actual'

import { buildEnvText, formatDate, registerEnvContext } from '../src/env.ts'

/** 基准状态（不含密钥）。 */
function statusWith(overrides: Partial<ActualStatus> = {}): ActualStatus {
  return {
    cli: 'PATH 上的 actual',
    cliVersion: '26.10.0',
    cliAvailable: true,
    serverUrl: 'http://127.0.0.1:5006',
    serverVersion: '26.10.0',
    mcpConnected: true,
    versionStatus: 'ok',
    ...overrides,
  }
}

test('given a date, when formatting, then the local ISO day and weekday are produced', () => {
  assert.equal(formatDate(new Date(2026, 9, 5)), '2026-10-05 Mon')
  assert.equal(formatDate(new Date(2026, 0, 1)), '2026-01-01 Thu')
})

test('given aligned versions, when building the snapshot, then it reports the connection facts', () => {
  const text = buildEnvText(statusWith(), new Date(2026, 9, 5))
  assert.equal(
    text,
    'Actual Budget: CLI 26.10.0 (PATH 上的 actual) → server 26.10.0 at http://127.0.0.1:5006 — ' +
      'MCP connected, versions aligned.\nDate: 2026-10-05 Mon',
  )
})

test('given a version mismatch, when building the snapshot, then the model is told to report it', () => {
  const text = buildEnvText(
    statusWith({ cliVersion: '26.10.0', serverVersion: '27.1.0', versionStatus: 'mismatch' }),
    new Date(2026, 9, 5),
  )
  assert.match(text, /VERSION MISMATCH between CLI 26\.10\.0 and server 27\.1\.0/)
})

test('given an unknown version, when building the snapshot, then it says so instead of guessing', () => {
  const text = buildEnvText(
    statusWith({ serverVersion: '', versionStatus: 'unknown' }),
    new Date(2026, 9, 5),
  )
  assert.match(text, /server unknown/)
  assert.match(text, /version unknown/)
})

test('given a degraded session and a last error, when building the snapshot, then both are surfaced', () => {
  const text = buildEnvText(
    statusWith({ mcpConnected: false, lastError: 'Actual CLI 不可用（PATH 上的 actual）' }),
    new Date(2026, 9, 5),
  )
  assert.match(text, /MCP degraded to CLI/)
  assert.match(text, /Last error: Actual CLI 不可用/)
})

test('given a systemPrompt service, when registering, then the snapshot is contributed under actual:env', () => {
  const contributions: { name: string; order: number; text: () => string }[] = []
  const ctx = {
    get(key: string) {
      if (key !== 'systemPrompt') return undefined
      return {
        context(contribution: { name: string; order: number; text: () => string }) {
          contributions.push(contribution)
          return () => contributions.pop()
        },
      }
    },
  } as unknown as Context
  const service = { status: () => statusWith() } as unknown as ActualService
  const off = registerEnvContext(ctx, service)
  assert.equal(contributions.length, 1)
  assert.equal(contributions[0]?.name, 'actual:env')
  assert.equal(contributions[0]?.order, 130, '须排在官方 sandbox/approval/subagent 之后')
  assert.match(contributions[0]?.text() ?? '', /^Actual Budget: CLI 26\.10\.0/)
  off()
  assert.equal(contributions.length, 0)
})

test('given no systemPrompt service, when registering, then it is a safe no-op', () => {
  const ctx = { get: () => undefined } as unknown as Context
  const off = registerEnvContext(ctx, { status: () => statusWith() } as unknown as ActualService)
  assert.equal(typeof off, 'function')
  off()
})
