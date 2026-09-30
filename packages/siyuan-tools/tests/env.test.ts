import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { SiyuanStatus } from '@dsh-plus/siyuan'

import { buildEnvText, formatDate } from '../src/env.ts'

const STATUS: SiyuanStatus = {
  mode: 'docker',
  endpoint: 'http://127.0.0.1:6806',
  version: '3.8.6',
  mcpConnected: true,
  cliAvailable: true,
}

test('given a connected status, when rendering env text, then connection facts and date are included', () => {
  const text = buildEnvText(STATUS, new Date(2026, 8, 30))
  assert.match(text, /SiYuan: 3\.8\.6 via docker \(http:\/\/127\.0\.0\.1:6806\)/)
  assert.match(text, /MCP connected, CLI available/)
  assert.match(text, /Date: 2026-09-30 Wed/)
  assert.equal(text.includes('token'), false, '快照绝不能携带凭据字段名以外的泄漏面')
})

test('given a degraded status, when rendering env text, then the last error surfaces for diagnosis', () => {
  const text = buildEnvText(
    { ...STATUS, version: '', mcpConnected: false, lastError: 'connect ECONNREFUSED' },
    new Date(2026, 0, 1),
  )
  assert.match(text, /SiYuan: unknown/)
  assert.match(text, /MCP disconnected/)
  assert.match(text, /Last error: connect ECONNREFUSED/)
})

test('given dates, when formatting, then the weekday label matches the local calendar', () => {
  assert.equal(formatDate(new Date(2026, 8, 30)), '2026-09-30 Wed')
  assert.equal(formatDate(new Date(2026, 0, 1)), '2026-01-01 Thu')
})
