import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'

import { WebError } from '@deepseek-ai/dsh-web'

import { Config, type WebSearchServicesConfig } from '../src/config.ts'
import { keyOverridesEnv, PROVIDER_ID, SearchServicesProvider } from '../src/provider.ts'
import type { SpawnFn } from '../src/runner.ts'

const FIXTURE_DIR = new URL('./fixtures/', import.meta.url).pathname
const FIXTURE_SCRIPT = `${FIXTURE_DIR}script.py`
const FIXTURE_ENV = `${FIXTURE_DIR}keys.env`

const KEY_VARS = ['TAVILY_API_KEY', 'TAVILY_API_KEYS', 'EXA_API_KEY', 'SEARCH_OPENAI_API_KEY']

/** 隔离进程环境，避免宿主 shell 泄漏的 key 干扰 available() 断言。 */
function withoutProcessKeys(t: { after: (fn: () => void) => void }): void {
  const saved: Record<string, string | undefined> = {}
  for (const name of KEY_VARS) {
    saved[name] = process.env[name]
    delete process.env[name]
  }
  t.after(() => {
    for (const name of KEY_VARS) {
      if (saved[name] !== undefined) process.env[name] = saved[name]
    }
  })
}

function cfg(overrides: Partial<WebSearchServicesConfig> = {}): WebSearchServicesConfig {
  return Config({ scriptPath: FIXTURE_SCRIPT, envFile: '', ...overrides })
}

/** 捕获一次 spawn 调用并以 canned stdout 应答的假 spawn。 */
function cannedSpawn(stdoutText: string, recorded: { args: string[]; env: NodeJS.ProcessEnv }) {
  const spawnFn = ((_command: string, args: string[], options: { env: NodeJS.ProcessEnv }) => {
    recorded.args = args
    recorded.env = options.env
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter
      stderr: EventEmitter
      kill: (signal?: string) => boolean
    }
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.kill = () => true
    queueMicrotask(() => {
      child.stdout.emit('data', stdoutText)
      child.emit('close', 0)
    })
    return child
  }) as unknown as SpawnFn
  return spawnFn
}

const TAVILY_JSON = JSON.stringify({
  ok: true,
  selectedService: 'tavily',
  results: [
    { title: 'T', url: 'https://a.example.com', content: 's', published_date: '2026-09-01' },
  ],
})

test('given fixture script and envFile with tavily key, when available, then true', (t) => {
  withoutProcessKeys(t)
  const provider = new SearchServicesProvider(() => cfg({ envFile: FIXTURE_ENV }))
  assert.equal(provider.available(), true)
})

test('given no script on disk, when available, then false regardless of keys', (t) => {
  withoutProcessKeys(t)
  const provider = new SearchServicesProvider(() =>
    cfg({
      scriptPath: '/tmp/not-exist-web-search-services.py',
      keys: { ...Config({}).keys, exa: 'exa-k' },
    }),
  )
  assert.equal(provider.available(), false)
})

test('given no key anywhere, when available, then false (pin 下报 CONFIGURED_UNAVAILABLE，不落付费)', (t) => {
  withoutProcessKeys(t)
  const provider = new SearchServicesProvider(() => cfg())
  assert.equal(provider.available(), false)
})

test('given row-level keys override, when childEnv built, then empty strings skipped and values mapped', (t) => {
  withoutProcessKeys(t)
  const keys = { ...Config({}).keys, tavily: 'tvly-x', exa: '', openaiModel: 'm' }
  assert.deepEqual(keyOverridesEnv(keys), { TAVILY_API_KEY: 'tvly-x', SEARCH_OPENAI_MODEL: 'm' })
})

test('given canned tavily stdout, when search, then argv/env forwarded and result normalized', async (t) => {
  withoutProcessKeys(t)
  const recorded = { args: [] as string[], env: {} as NodeJS.ProcessEnv }
  const provider = new SearchServicesProvider(
    () => cfg({ keys: { ...Config({}).keys, tavily: 'tvly-override' } }),
    cannedSpawn(TAVILY_JSON, recorded),
  )
  const result = await provider.search({ query: 'q', maxResults: 5 })
  assert.equal(PROVIDER_ID, 'search-services')
  assert.equal(provider.id, 'search-services')
  assert.deepEqual(recorded.args, [
    FIXTURE_SCRIPT,
    'search',
    '--query',
    'q',
    '--service',
    'tavily,exa,openai-chat',
    '--max-results',
    '5',
  ])
  assert.equal(recorded.env.TAVILY_API_KEY, 'tvly-override')
  assert.equal(result.sources[0]?.url, 'https://a.example.com')
})

test('given all-backend failure JSON, when search, then WebError WEB_PROVIDER_ERROR with attempts summary', async (t) => {
  withoutProcessKeys(t)
  const failure = JSON.stringify({
    ok: false,
    error: '所有候选搜索服务均不可用或返回失败',
    attempts: [{ service: 'tavily', error: 'HTTP 429' }],
  })
  const recorded = { args: [] as string[], env: {} as NodeJS.ProcessEnv }
  const provider = new SearchServicesProvider(() => cfg(), cannedSpawn(failure, recorded))
  await assert.rejects(provider.search({ query: 'q' }), (err: unknown) => {
    assert.ok(err instanceof WebError)
    assert.equal(err.code, 'WEB_PROVIDER_ERROR')
    assert.match(err.message, /尝试过: tavily: HTTP 429/)
    return true
  })
})

test('given aborted signal, when search, then WebError WEB_ABORTED', async (t) => {
  withoutProcessKeys(t)
  const controller = new AbortController()
  controller.abort()
  const recorded = { args: [] as string[], env: {} as NodeJS.ProcessEnv }
  const provider = new SearchServicesProvider(() => cfg(), cannedSpawn('{}', recorded))
  await assert.rejects(provider.search({ query: 'q' }, controller.signal), (err: unknown) => {
    assert.ok(err instanceof WebError)
    assert.equal(err.code, 'WEB_ABORTED')
    return true
  })
})
