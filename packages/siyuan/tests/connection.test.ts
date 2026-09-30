import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  type ConnectionDeps,
  parseApiToken,
  pickContainer,
  resolveConnection,
} from '../src/connection.ts'

const CONF_JSON = JSON.stringify({ api: { token: 'tok-1234567890abcdef' } })

/** 依赖替身：按 argv 路由 docker/文件/HTTP 事实。 */
function fakeDeps(overrides?: {
  ps?: string
  psCode?: number
  catConf?: string
  fileConf?: string
  env?: Record<string, string | undefined>
}): ConnectionDeps {
  return {
    async execFile(file, args) {
      if (file === 'docker' && args[0] === 'ps') {
        return { stdout: overrides?.ps ?? '', stderr: '', code: overrides?.psCode ?? 0 }
      }
      if (args.includes('cat')) return { stdout: overrides?.catConf ?? '', stderr: '', code: 0 }
      return { stdout: '', stderr: '', code: 1 }
    },
    async readFile() {
      return overrides?.fileConf ?? Promise.reject(new Error('ENOENT'))
    },
    async fetchJson() {
      return { ok: true, status: 200, body: { code: 0, data: '3.8.6' } }
    },
    env: overrides?.env ?? {},
  }
}

const BASE = {
  endpoint: 'http://127.0.0.1:6806',
  container: '',
  cliCommand: [] as string[],
  cliWorkspace: '',
  token: '',
}

test('given a running SiYuan container, when auto-detecting, then mode=docker with conf token and CLI prefix', async () => {
  const conn = await resolveConnection(
    { ...BASE, mode: 'auto' },
    fakeDeps({ ps: 'siyuan\tb3log/siyuan:latest\n', catConf: CONF_JSON }),
  )
  assert.equal(conn.mode, 'docker')
  assert.equal(conn.container, 'siyuan')
  assert.deepEqual(conn.cli, ['docker', 'exec', 'siyuan', '/opt/siyuan/kernel'])
  assert.equal(conn.workspace, '/siyuan/workspace')
  assert.equal(conn.token, 'tok-1234567890abcdef')
})

test('given no container and no CLI command, when auto-detecting, then mode=http without CLI', async () => {
  const conn = await resolveConnection(
    { ...BASE, mode: 'auto', token: 'explicit' },
    fakeDeps({ ps: '', psCode: 1 }),
  )
  assert.equal(conn.mode, 'http')
  assert.deepEqual(conn.cli, [])
  assert.equal(conn.token, 'explicit')
})

test('given docker mode without any container, when resolving, then it fails with context', async () => {
  await assert.rejects(
    resolveConnection({ ...BASE, mode: 'docker' }, fakeDeps({ ps: '', psCode: 1 })),
    /未发现运行中的 SiYuan 容器/,
  )
})

test('given explicit config token, when resolving docker, then it wins over conf discovery', async () => {
  const conn = await resolveConnection(
    { ...BASE, mode: 'docker', token: 'from-config' },
    fakeDeps({ ps: 'siyuan\tb3log/siyuan:latest\n', catConf: CONF_JSON }),
  )
  assert.equal(conn.token, 'from-config')
})

test('given native mode with workspace conf, when resolving, then token comes from local conf.json', async () => {
  const conn = await resolveConnection(
    { ...BASE, mode: 'native', cliCommand: ['siyuan', 'kernel'], cliWorkspace: '/data/siyuan' },
    fakeDeps({ ps: '', psCode: 1, fileConf: CONF_JSON }),
  )
  assert.equal(conn.mode, 'native')
  assert.deepEqual(conn.cli, ['siyuan', 'kernel'])
  assert.equal(conn.workspace, '/data/siyuan')
  assert.equal(conn.token, 'tok-1234567890abcdef')
})

test('given SIYUAN_TOKEN in env, when resolving http, then env provides the fallback token', async () => {
  const conn = await resolveConnection(
    { ...BASE, mode: 'http' },
    fakeDeps({ env: { SIYUAN_TOKEN: 'env-token' } }),
  )
  assert.equal(conn.token, 'env-token')
})

test('given container picking rules, when scanning docker ps output, then preferred name wins and mismatch misses', () => {
  const ps = 'notes\tb3log/siyuan:latest\tother\nredis\tredis:latest\n'
  assert.equal(pickContainer(ps, ''), 'notes')
  assert.equal(pickContainer(ps, 'notes'), 'notes')
  assert.equal(pickContainer(ps, 'absent'), undefined)
  assert.equal(pickContainer('redis\tredis:latest\n', ''), undefined)
})

test('given conf.json text, when parsing the API token, then malformed shapes degrade to empty string', () => {
  assert.equal(parseApiToken(CONF_JSON), 'tok-1234567890abcdef')
  assert.equal(parseApiToken('not json'), '')
  assert.equal(parseApiToken('{"api":{}}'), '')
  assert.equal(parseApiToken('{"api":{"token":123}}'), '')
})
