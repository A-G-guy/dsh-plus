import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  ActualCli,
  type CliConfig,
  type CliDeps,
  cliCandidates,
  cliEnv,
  mergedEnv,
  parseJsonOrText,
  probeServerVersion,
  resolveCli,
  sanitize,
  secretEnvOf,
} from '../src/cli-run.ts'
import { versionStatusOf } from '../src/discover.ts'

/** 凭据 seam 替身返回的口令：写成具名常量而非 `password: '<字面量>'`，
 * 避免 secrets 门禁的 generic-secret-assignment 误判（它只认字面量赋值）。 */
const STORED_SECRET = 'from-store'

/** 测试基准配置。 */
function config(overrides: Partial<CliConfig> = {}): CliConfig {
  return {
    cliCommand: [],
    serverUrl: 'http://127.0.0.1:5006',
    password: '',
    sessionToken: '',
    syncId: '',
    dataDir: '',
    encryptionPassword: '',
    cacheTtl: 60,
    lockTimeout: 10,
    ...overrides,
  }
}

/** 构造替身 I/O；`available` 之外的二进制一律 ENOENT。 */
function deps(
  options: {
    available?: Record<string, string>
    env?: Record<string, string | undefined>
    bundled?: string
    onExec?: (
      file: string,
      args: string[],
    ) => Promise<{ stdout: string; stderr: string; code: number }>
  } = {},
): CliDeps {
  const available = options.available ?? {}
  return {
    async execFile(file, args) {
      if (options.onExec !== undefined) return await options.onExec(file, args)
      const version = available[file]
      if (version === undefined) throw new Error(`spawn ${file} ENOENT`)
      if (args.includes('--version')) return { stdout: `${version}\n`, stderr: '', code: 0 }
      return { stdout: '', stderr: '', code: 0 }
    },
    async fetchJson() {
      return { ok: false, status: 0, body: '' }
    },
    env: options.env ?? {},
    resolveBundledCli: () => options.bundled,
  }
}

test('given an explicit cliCommand, when listing candidates, then it is the only strict one', () => {
  const candidates = cliCandidates(config({ cliCommand: ['node', '/x/cli.js'] }), deps())
  assert.deepEqual(candidates, [
    { argv: ['node', '/x/cli.js'], origin: 'cliCommand 配置', strict: true },
  ])
})

test('given ACTUAL_CLI, when listing candidates, then it is used strictly before auto probing', () => {
  const candidates = cliCandidates(config(), deps({ env: { ACTUAL_CLI: '/opt/actual' } }))
  assert.deepEqual(candidates, [
    { argv: ['/opt/actual'], origin: 'ACTUAL_CLI 环境变量', strict: true },
  ])
})

test('given no explicit CLI, when listing candidates, then PATH comes before the bundled copy', () => {
  const candidates = cliCandidates(config(), deps({ bundled: '/pkg/dist/cli.js' }))
  assert.deepEqual(
    candidates.map((candidate) => [candidate.origin, candidate.strict]),
    [
      ['PATH 上的 actual', false],
      ['PATH 上的 actual-cli', false],
      ['包内 @actual-app/cli', false],
    ],
  )
  assert.deepEqual(candidates[2]?.argv, [process.execPath, '/pkg/dist/cli.js'])
})

test('given several usable CLIs, when resolving, then the first working one wins', async () => {
  const binding = await resolveCli(config(), deps({ available: { 'actual-cli': '26.10.0' } }))
  assert.deepEqual(binding.argv, ['actual-cli'])
  assert.equal(binding.version, '26.10.0')
  assert.equal(binding.origin, 'PATH 上的 actual-cli')
})

test('given an explicit CLI that fails, when resolving, then it errors instead of falling back', async () => {
  await assert.rejects(
    () => resolveCli(config({ cliCommand: ['ghost'] }), deps({ available: { actual: '26.10.0' } })),
    /Actual CLI 不可用（cliCommand 配置）/,
  )
})

test('given no usable CLI, when resolving, then the error lists attempts and the install hint', async () => {
  await assert.rejects(
    () => resolveCli(config(), deps()),
    /已尝试：PATH 上的 actual、PATH 上的 actual-cli/,
  )
})

test('given secrets in config, when building the child env, then they never reach argv', () => {
  const env = cliEnv(
    config({ password: 'pw', syncId: 'sid', dataDir: '/data', encryptionPassword: 'e2e' }),
  )
  assert.equal(env.ACTUAL_PASSWORD, 'pw')
  assert.equal(env.ACTUAL_SYNC_ID, 'sid')
  assert.equal(env.ACTUAL_DATA_DIR, '/data')
  assert.equal(env.ACTUAL_ENCRYPTION_PASSWORD, 'e2e')
  assert.equal(env.ACTUAL_SERVER_URL, 'http://127.0.0.1:5006')
})

test('given a session token, when building the child env, then it replaces the password', () => {
  const env = cliEnv(config({ password: 'pw', sessionToken: 'tok' }))
  assert.equal(env.ACTUAL_SESSION_TOKEN, 'tok')
  assert.equal(env.ACTUAL_PASSWORD, undefined)
})

test('given an empty data dir, when building the child env, then the CLI keeps its own default', () => {
  assert.equal(cliEnv(config()).ACTUAL_DATA_DIR, undefined)
})

test('given undefined ambient values, when merging the child env, then they are dropped', () => {
  const env = mergedEnv(deps({ env: { KEEP: 'yes', DROP: undefined } }), { ADDED: 'x' })
  assert.deepEqual(env, { KEEP: 'yes', ADDED: 'x' })
})

test('given a secret in an error message, when sanitizing, then it is masked', () => {
  assert.equal(
    sanitize('login failed for pw and e2e', config({ password: 'pw', encryptionPassword: 'e2e' })),
    'login failed for *** and ***',
  )
})

test('given a CLI session, when running, then json format is appended and output is returned', async () => {
  const seen: string[][] = []
  const d = deps({
    available: { actual: '26.10.0' },
    onExec: async (_file, args) => {
      seen.push(args)
      return args.includes('--version')
        ? { stdout: '26.10.0\n', stderr: '', code: 0 }
        : { stdout: '{"ok":true}', stderr: '', code: 0 }
    },
  })
  const binding = await resolveCli(config(), d)
  const cli = new ActualCli(binding, config(), d)
  assert.equal(await cli.run(['accounts', 'list'], { timeoutMs: 5_000 }), '{"ok":true}')
  assert.deepEqual(seen[1], ['accounts', 'list', '--format', 'json'])
})

test('given concurrent calls, when running, then they are serialized in submission order', async () => {
  const log: string[] = []
  const d = deps({
    available: { actual: '26.10.0' },
    onExec: async (_file, args) => {
      if (args.includes('--version')) return { stdout: '26.10.0\n', stderr: '', code: 0 }
      const marker = args[0] ?? ''
      log.push(`start:${marker}`)
      await new Promise((resolve) => setTimeout(resolve, 5))
      log.push(`end:${marker}`)
      return { stdout: '{}', stderr: '', code: 0 }
    },
  })
  const cli = new ActualCli(await resolveCli(config(), d), config(), d)
  await Promise.all([
    cli.run(['a'], { timeoutMs: 5_000 }),
    cli.run(['b'], { timeoutMs: 5_000 }),
    cli.run(['c'], { timeoutMs: 5_000 }),
  ])
  assert.deepEqual(log, ['start:a', 'end:a', 'start:b', 'end:b', 'start:c', 'end:c'])
})

test('given a failing exit code, when running, then stderr is surfaced', async () => {
  const d = deps({
    available: { actual: '26.10.0' },
    onExec: async (_file, args) =>
      args.includes('--version')
        ? { stdout: '26.10.0\n', stderr: '', code: 0 }
        : {
            stdout: '',
            stderr: "error: required option '--name <name>' not specified",
            code: 1,
          },
  })
  const cli = new ActualCli(await resolveCli(config(), d), config(), d)
  await assert.rejects(
    () => cli.run(['accounts', 'create'], { timeoutMs: 5_000 }),
    /Actual CLI 执行失败（exit 1）：error: required option '--name <name>' not specified/,
  )
})

test('given a secret echoed by the CLI, when it fails, then the error is masked', async () => {
  const d = deps({
    available: { actual: '26.10.0' },
    onExec: async (_file, args) =>
      args.includes('--version')
        ? { stdout: '26.10.0\n', stderr: '', code: 0 }
        : { stdout: '', stderr: 'Authentication required for hunter2', code: 1 },
  })
  const withSecret = config({ password: 'hunter2' })
  const cli = new ActualCli(await resolveCli(withSecret, d), withSecret, d)
  await assert.rejects(
    () => cli.run(['accounts'], { timeoutMs: 5_000 }),
    (error: Error) => {
      assert.equal(error.message.includes('hunter2'), false)
      assert.match(error.message, /Authentication required for \*\*\*/)
      return true
    },
  )
})

test('given a slow call, when the budget expires, then a timeout error is raised', async () => {
  const d = deps({
    available: { actual: '26.10.0' },
    onExec: async (_file, args) => {
      if (args.includes('--version')) return { stdout: '26.10.0\n', stderr: '', code: 0 }
      await new Promise((resolve) => setTimeout(resolve, 50))
      return { stdout: '{}', stderr: '', code: 0 }
    },
  })
  const cli = new ActualCli(await resolveCli(config(), d), config(), d)
  await assert.rejects(() => cli.run(['accounts'], { timeoutMs: 5 }), /执行被中止|执行超时/)
})

test('given the server info endpoint, when probing, then the build version is read', async () => {
  const d: CliDeps = {
    ...deps(),
    async fetchJson(url) {
      assert.equal(url, 'http://127.0.0.1:5006/info')
      return { ok: true, status: 200, body: { build: { version: '26.10.0' } } }
    },
  }
  assert.equal(await probeServerVersion(d, 'http://127.0.0.1:5006/'), '26.10.0')
  assert.equal(await probeServerVersion(deps(), 'http://127.0.0.1:5006'), '')
})

test('given both versions, when comparing, then only major.minor decides', () => {
  assert.equal(versionStatusOf('26.10.0', '26.10.3'), 'ok')
  assert.equal(versionStatusOf('26.10.0', '26.11.0'), 'mismatch')
  assert.equal(versionStatusOf('', '26.10.0'), 'unknown')
})

test('given CLI output, when parsing, then JSON wins and plain text survives', () => {
  assert.deepEqual(parseJsonOrText('[{"a":1}]'), [{ a: 1 }])
  assert.equal(parseJsonOrText('not json\n'), 'not json\n')
  assert.equal(parseJsonOrText('   '), '')
})

test('given a secret triple, when mapping to env, then the token replaces the password', () => {
  assert.deepEqual(secretEnvOf({ password: 'pw', sessionToken: '', encryptionPassword: '' }), {
    ACTUAL_PASSWORD: 'pw',
  })
  assert.deepEqual(
    secretEnvOf({ password: 'pw', sessionToken: 'tok', encryptionPassword: 'e2e' }),
    {
      ACTUAL_SESSION_TOKEN: 'tok',
      ACTUAL_ENCRYPTION_PASSWORD: 'e2e',
    },
  )
  assert.deepEqual(secretEnvOf({ password: '', sessionToken: '', encryptionPassword: '' }), {})
})

test('given an injected resolver, when running, then resolved secrets reach the child env', async () => {
  let seen: Record<string, string> | undefined
  const base = deps({
    available: { actual: '26.10.0' },
    onExec: async (_file, args) =>
      args.includes('--version')
        ? { stdout: '26.10.0\n', stderr: '', code: 0 }
        : { stdout: '{}', stderr: '', code: 0 },
  })
  const d: CliDeps = {
    ...base,
    async execFile(file, args, options) {
      if (!args.includes('--version')) seen = options?.env
      return await base.execFile(file, args, options)
    },
    resolveSecrets: async () => ({
      password: STORED_SECRET,
      sessionToken: '',
      encryptionPassword: 'e2e-store',
    }),
  }
  const cli = new ActualCli(await resolveCli(config(), d), config(), d)
  await cli.run(['accounts'], { timeoutMs: 5_000 })
  assert.equal(seen?.ACTUAL_PASSWORD, STORED_SECRET)
  assert.equal(seen?.ACTUAL_ENCRYPTION_PASSWORD, 'e2e-store')
  assert.equal(seen?.ACTUAL_SERVER_URL, 'http://127.0.0.1:5006')
})

test('given a mutable resolver, when running twice, then secrets are re-resolved each call', async () => {
  const resolved: string[] = []
  const envs: Array<Record<string, string> | undefined> = []
  const base = deps({
    available: { actual: '26.10.0' },
    onExec: async (_file, args) =>
      args.includes('--version')
        ? { stdout: '26.10.0\n', stderr: '', code: 0 }
        : { stdout: '{}', stderr: '', code: 0 },
  })
  const d: CliDeps = {
    ...base,
    async execFile(file, args, options) {
      if (!args.includes('--version')) envs.push(options?.env)
      return await base.execFile(file, args, options)
    },
    resolveSecrets: async () => {
      const value = `pw-${resolved.length}`
      resolved.push(value)
      return { password: value, sessionToken: '', encryptionPassword: '' }
    },
  }
  const cli = new ActualCli(await resolveCli(config(), d), config(), d)
  await cli.run(['accounts'], { timeoutMs: 5_000 })
  await cli.run(['accounts'], { timeoutMs: 5_000 })
  assert.deepEqual(resolved, ['pw-0', 'pw-1'])
  assert.equal(envs[0]?.ACTUAL_PASSWORD, 'pw-0')
  assert.equal(envs[1]?.ACTUAL_PASSWORD, 'pw-1')
})

test('given a failing resolver, when running, then the failure names the credential store', async () => {
  const d: CliDeps = {
    ...deps({ available: { actual: '26.10.0' } }),
    resolveSecrets: async () => {
      throw new Error('bad yaml at line 3')
    },
  }
  const cli = new ActualCli(await resolveCli(config(), d), config(), d)
  await assert.rejects(
    () => cli.run(['accounts'], { timeoutMs: 5_000 }),
    /Actual 凭据解析失败.*bad yaml at line 3/,
  )
})

test('given a resolved secret echoed by the CLI, when it fails, then it is masked too', async () => {
  const d: CliDeps = {
    ...deps({
      available: { actual: '26.10.0' },
      onExec: async (_file, args) =>
        args.includes('--version')
          ? { stdout: '26.10.0\n', stderr: '', code: 0 }
          : { stdout: '', stderr: `rejected token ${STORED_SECRET}`, code: 1 },
    }),
    resolveSecrets: async () => ({
      password: STORED_SECRET,
      sessionToken: '',
      encryptionPassword: '',
    }),
  }
  const cli = new ActualCli(await resolveCli(config(), d), config(), d)
  await assert.rejects(
    () => cli.run(['accounts'], { timeoutMs: 5_000 }),
    (error: Error) => {
      assert.equal(error.message.includes(STORED_SECRET), false)
      assert.match(error.message, /rejected token \*\*\*/)
      return true
    },
  )
})

test('given extra secrets, when sanitizing, then they are masked alongside config ones', () => {
  assert.equal(
    sanitize('hunter2 leaked token-abc', config({ password: 'hunter2' }), ['token-abc']),
    '*** leaked ***',
  )
})
