/**
 * 配置解析的行为测试：官方同名默认值、`_FILE` 优先级、显式报错。
 * @module @dsh-plus/actual-reports/tests/env
 */

import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'

import { resolveConfig } from '../src/env.ts'

const HOME = '/home/tester'

/** 造一个配置依赖替身。 */
function depsOf(env: Record<string, string | undefined>, files: Record<string, string> = {}) {
  return {
    env,
    readTextFile: async (path: string) => files[path],
    homedir: () => HOME,
  }
}

test('缓存根默认与官方一致，缺省数值回落官方默认', async () => {
  const config = await resolveConfig(
    {},
    depsOf({ ACTUAL_SERVER_URL: 'http://127.0.0.1:5006', ACTUAL_PASSWORD: 'pw' }),
  )
  assert.equal(config.dataDir, join(HOME, '.actual-cli', 'data'))
  assert.equal(config.cacheTtlSec, 60)
  assert.equal(config.lockTimeoutSec, 10)
  assert.equal(config.noLock, false)
  assert.equal(config.syncId, '')
})

test('命令行覆盖项优先于环境变量', async () => {
  const config = await resolveConfig(
    { dataDir: '/tmp/d', syncId: 'sync-9', apiPath: '/tmp/api.js' },
    depsOf({
      ACTUAL_SERVER_URL: 'http://a',
      ACTUAL_PASSWORD: 'pw',
      ACTUAL_DATA_DIR: '/tmp/other',
      ACTUAL_SYNC_ID: 'sync-1',
    }),
  )
  assert.equal(config.dataDir, '/tmp/d')
  assert.equal(config.syncId, 'sync-9')
  assert.equal(config.apiPath, '/tmp/api.js')
})

test('_FILE 变体优先，且文件读不到时显式报错', async () => {
  const config = await resolveConfig(
    {},
    depsOf(
      {
        ACTUAL_SERVER_URL: 'http://a',
        ACTUAL_PASSWORD: 'from-env',
        ACTUAL_PASSWORD_FILE: '/run/secret',
        ACTUAL_SESSION_TOKEN_FILE: '/run/token',
      },
      { '/run/secret': ' from-file\n', '/run/token': 'tok\n' },
    ),
  )
  assert.equal(config.password, 'from-file')
  assert.equal(config.sessionToken, 'tok')

  await assert.rejects(
    async () =>
      await resolveConfig(
        {},
        depsOf({ ACTUAL_SERVER_URL: 'http://a', ACTUAL_PASSWORD_FILE: '/missing' }),
      ),
    /环境变量 ACTUAL_PASSWORD_FILE 指向的文件读不到：\/missing/,
  )
})

test('缺少服务端地址或认证信息时报错并给出设置方法', async () => {
  await assert.rejects(async () => await resolveConfig({}, depsOf({})), /缺少服务端地址/)
  await assert.rejects(
    async () => await resolveConfig({}, depsOf({ ACTUAL_SERVER_URL: 'http://a' })),
    /缺少认证信息/,
  )
})

test('数值与布尔变量非法即报错，不做静默兜底', async () => {
  await assert.rejects(
    async () =>
      await resolveConfig(
        {},
        depsOf({ ACTUAL_SERVER_URL: 'http://a', ACTUAL_PASSWORD: 'p', ACTUAL_CACHE_TTL: 'soon' }),
      ),
    /ACTUAL_CACHE_TTL 必须是非负整数/,
  )
  await assert.rejects(
    async () =>
      await resolveConfig(
        {},
        depsOf({ ACTUAL_SERVER_URL: 'http://a', ACTUAL_PASSWORD: 'p', ACTUAL_NO_LOCK: 'yep' }),
      ),
    /ACTUAL_NO_LOCK 只接受 true\/false\/1\/0/,
  )
})
