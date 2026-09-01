/**
 * SecretEnvService 核心规则测试（Given-When-Then）：
 * 注入解析优先级、会话隔离、一次性自毁、会话清理、登记簿回收、写入校验。
 * 用假 ctx（credentials/shellEnv/settings 内存实现）直构服务，不经框架。
 * @module secret-env/tests/service
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Context } from '@deepseek-ai/cordis'
import { SecretEnvError } from '../src/errors.ts'
import { envNameOf } from '../src/names.ts'
import { SecretEnvService } from '../src/service.ts'

interface FakeContributor {
  name: string
  variables: Record<string, { description: string }>
  resolve(execution: unknown): Record<string, string>
}

function createFakeCtx(
  meta: Array<{ name: string; description: string; createdAt: string }> = [],
  values: Record<string, string> = {},
) {
  const contributors = new Map<string, FakeContributor>()
  const store = new Map<string, string>(Object.entries(values))
  const handlers: Record<string, (arg: never) => void> = {}
  const credentials = {
    async resolve(ref: string) {
      const value = store.get(ref)
      return value === undefined ? undefined : { value, source: 'file' }
    },
    async describe(ref: string) {
      return {
        configured: store.has(ref),
        source: store.has(ref) ? 'file' : undefined,
        writable: true,
      }
    },
    async set(ref: string, value: string) {
      if (value === '') throw new Error('empty')
      store.set(ref, value)
    },
    async unset(ref: string) {
      store.delete(ref)
    },
  }
  const settings = {
    data: { secrets: meta } as Record<string, unknown>,
    onChange: undefined as undefined | (() => void),
    get() {
      return this.data
    },
    async update(_ns: string, patch: Record<string, unknown>) {
      Object.assign(this.data, patch)
      // 模拟真实 settings：提交后 watch 触发 onChange。
      this.onChange?.()
    },
    // installSection 范式：setSource 收实时 getter（scope.get 活视图）。
    installSection(
      _ownerCtx: unknown,
      _ns: string,
      _schema: unknown,
      _base: unknown,
      hooks: { setSource(source: () => unknown): void; onChange(): void },
    ) {
      hooks.setSource(() => this.data)
      this.onChange = hooks.onChange
    },
  }
  const ctx = {
    credentials,
    shellEnv: {
      register(contributor: FakeContributor) {
        for (const key of Object.keys(contributor.variables)) {
          if ([...contributors.values()].some((c) => key in c.variables)) {
            throw new Error(`duplicate key ${key}`)
          }
        }
        contributors.set(contributor.name, contributor)
        return () => {
          contributors.delete(contributor.name)
        }
      },
    },
    reflect: { provide: () => {} },
    inject(keys: string[], cb: (c: unknown) => void) {
      // webServer 缺席是合法组合（仅端点不挂）；settings 提供内存实现。
      if (keys.includes('settings')) cb({ settings })
    },
    root: {
      on(event: string, listener: (arg: never) => void) {
        handlers[event] = listener
      },
    },
    on(event: string, listener: (arg: never) => void) {
      handlers[event] = listener
    },
  }
  const service = new SecretEnvService(ctx as unknown as Context, { secrets: meta })
  return { contributors, credentials: store, handlers, service, settings }
}

/** 模拟一次 shell 执行收集：返回注入的 DSH_* 快照。 */
function collect(
  fake: ReturnType<typeof createFakeCtx>,
  sessionId?: string,
): Record<string, string> {
  const execution = sessionId === undefined ? {} : { agent: { id: sessionId } }
  const out: Record<string, string> = {}
  for (const contributor of fake.contributors.values()) {
    Object.assign(out, contributor.resolve(execution))
  }
  return out
}

test('given a global secret, when any shell runs, then the value is injected by name', async () => {
  const fake = createFakeCtx()
  await fake.service.setGlobal('GITHUB_TOKEN', 'test-only-global', 'demo')
  const envName = envNameOf('GITHUB_TOKEN')
  assert.equal(collect(fake)[envName], 'test-only-global')
  assert.equal(collect(fake, 's1')[envName], 'test-only-global')
  // 设置索引已持久化到 settings 命名空间（仅元数据，无值）。
  const index = fake.settings.data.secrets as Array<{ name: string }>
  assert.deepEqual(
    index.map((item) => item.name),
    ['GITHUB_TOKEN'],
  )
  assert.equal(JSON.stringify(fake.settings.data).includes('test-only-global'), false)
})

test('given global and session values for one name, when the owning session runs, then session wins', async () => {
  const fake = createFakeCtx()
  await fake.service.setGlobal('API_KEY', 'test-only-global', '')
  fake.service.setSession('s1', 'API_KEY', 'test-only-session', '', false)
  const envName = envNameOf('API_KEY')
  assert.equal(collect(fake, 's1')[envName], 'test-only-session')
  // 其他会话回落全局值；无会话执行同样回落。
  assert.equal(collect(fake, 's2')[envName], 'test-only-global')
  assert.equal(collect(fake)[envName], 'test-only-global')
})

test('given a session-only secret, when another session runs, then nothing is injected', () => {
  const fake = createFakeCtx()
  fake.service.setSession('s1', 'TEMP_KEY', 'test-only-s1', '', false)
  const envName = envNameOf('TEMP_KEY')
  assert.equal(collect(fake, 's1')[envName], 'test-only-s1')
  assert.equal(collect(fake, 's2')[envName], undefined)
  assert.equal(collect(fake)[envName], undefined)
})

test('given a once secret, when first resolved, then it burns and the contributor is released', async () => {
  const fake = createFakeCtx()
  fake.service.setSession('s1', 'ONCE_KEY', 'test-only-once', '', true)
  const envName = envNameOf('ONCE_KEY')
  assert.equal(collect(fake, 's1')[envName], 'test-only-once')
  // 自毁的 contributor 注销推迟到微任务。
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(collect(fake, 's1')[envName], undefined)
  assert.equal(fake.contributors.size, 0)
})

test('given a session with secrets, when the session is disposed, then its secrets vanish', async () => {
  const fake = createFakeCtx()
  fake.service.setSession('s1', 'A_KEY', 'test-only-a', '', false)
  fake.service.setSession('s2', 'B_KEY', 'test-only-b', '', false)
  fake.handlers['session/disposed']({ id: 's1' } as never)
  assert.equal(collect(fake, 's1')[envNameOf('A_KEY')], undefined)
  assert.equal(collect(fake, 's2')[envNameOf('B_KEY')], 'test-only-b')
  // A_KEY 为 s1 独占，contributor 应已回收。
  assert.deepEqual([...fake.contributors.keys()], ['secret-env:B_KEY'])
})

test('given an empty value, when setting global or session, then a coded error is raised', async () => {
  const fake = createFakeCtx()
  await assert.rejects(
    () => fake.service.setGlobal('X_KEY', '', ''),
    (error: unknown) => error instanceof SecretEnvError && error.code === 'empty-value',
  )
  assert.throws(
    () => fake.service.setSession('s1', 'X_KEY', '', '', false),
    (error: unknown) => error instanceof SecretEnvError && error.code === 'empty-value',
  )
})

test('given a global secret, when unset, then the variable disappears from injection', async () => {
  const fake = createFakeCtx()
  await fake.service.setGlobal('GONE_KEY', 'test-only-gone', '')
  assert.equal(collect(fake)[envNameOf('GONE_KEY')], 'test-only-gone')
  await fake.service.unsetGlobal('GONE_KEY')
  assert.equal(collect(fake)[envNameOf('GONE_KEY')], undefined)
  assert.equal(fake.contributors.size, 0)
})

test('given persisted metadata, when the service boots, then the mirror is rebuilt from the seam', async () => {
  const fake = createFakeCtx([{ name: 'BOOT_KEY', description: 'd', createdAt: 'now' }], {
    [envNameOf('BOOT_KEY')]: 'test-only-boot',
  })
  await fake.service.ready
  assert.equal(collect(fake)[envNameOf('BOOT_KEY')], 'test-only-boot')
  // 索引在而凭据缺席的名：镜像空、不注入、列表报未配置。
  const list = await fake.service.list()
  assert.equal(list.global[0]?.configured, true)
  assert.equal(JSON.stringify(list).includes('test-only-boot'), false)
})

test('given a blank description, when registering, then a fallback description is used (registry rejects empty)', async () => {
  const fake = createFakeCtx()
  await fake.service.setGlobal('NODESC_KEY', 'test-only-nodesc', '')
  const contributor = fake.contributors.get('secret-env:NODESC_KEY')
  assert.ok(contributor !== undefined)
  assert.notEqual(contributor.variables[envNameOf('NODESC_KEY')]?.description.trim(), '')
})

test('given a global secret, when globally masked, then injection stops and the mask persists', async () => {
  const fake = createFakeCtx()
  await fake.service.setGlobal('MASK_KEY', 'test-only-mask', '')
  const envName = envNameOf('MASK_KEY')
  await fake.service.setMask('MASK_KEY', true)
  assert.equal(collect(fake)[envName], undefined)
  assert.deepEqual(fake.settings.data.masked, ['MASK_KEY'])
  await fake.service.setMask('MASK_KEY', false)
  assert.equal(collect(fake)[envName], 'test-only-mask')
  assert.deepEqual(fake.settings.data.masked, [])
})

test('given global and session values, when masked in one session, then only that session is blocked', async () => {
  const fake = createFakeCtx()
  await fake.service.setGlobal('SMASK_KEY', 'test-only-global', '')
  fake.service.setSession('s1', 'S_ONLY', 'test-only-s1', '', false)
  await fake.service.setMask('SMASK_KEY', true, 's1')
  await fake.service.setMask('S_ONLY', true, 's1')
  assert.equal(collect(fake, 's1')[envNameOf('SMASK_KEY')], undefined)
  assert.equal(collect(fake, 's2')[envNameOf('SMASK_KEY')], 'test-only-global')
  // 会话屏蔽同样拦截会话级值。
  assert.equal(collect(fake, 's1')[envNameOf('S_ONLY')], undefined)
  assert.equal(collect(fake, 's2')[envNameOf('S_ONLY')], undefined)
  // 会话视图列表反映屏蔽态。
  const list = await fake.service.list('s1')
  assert.equal(list.global.find((item) => item.name === 'SMASK_KEY')?.masked, true)
})

test('given an inherited host variable, when the service boots, then it is forwarded by default', async () => {
  process.env[envNameOf('INH_KEY')] = 'test-only-inherited'
  try {
    const fake = createFakeCtx()
    await fake.service.ready
    assert.equal(collect(fake)[envNameOf('INH_KEY')], 'test-only-inherited')
    const list = await fake.service.list()
    assert.deepEqual(
      list.inherited.map((item) => [item.name, item.masked]),
      [['INH_KEY', false]],
    )
    // 列表永不回显继承值。
    assert.equal(JSON.stringify(list).includes('test-only-inherited'), false)
  } finally {
    delete process.env[envNameOf('INH_KEY')]
  }
})

test('given an inherited variable, when masked globally or per session, then forwarding stops', async () => {
  process.env[envNameOf('INH2_KEY')] = 'test-only-inh2'
  try {
    const fake = createFakeCtx()
    await fake.service.ready
    const envName = envNameOf('INH2_KEY')
    await fake.service.setMask('INH2_KEY', true, 's1')
    assert.equal(collect(fake, 's1')[envName], undefined)
    assert.equal(collect(fake, 's2')[envName], 'test-only-inh2')
    await fake.service.setMask('INH2_KEY', true)
    assert.equal(collect(fake)[envName], undefined)
    assert.equal(collect(fake, 's2')[envName], undefined)
    const list = await fake.service.list('s2')
    assert.equal(list.inherited[0]?.masked, true)
    assert.equal(list.inherited[0]?.globallyMasked, true)
    await fake.service.setMask('INH2_KEY', false)
    assert.equal(collect(fake, 's2')[envName], 'test-only-inh2')
  } finally {
    delete process.env[envNameOf('INH2_KEY')]
  }
})

test('given an inherited name later indexed, when managed registration takes over, then no key conflict and back', async () => {
  process.env[envNameOf('TAKE_KEY')] = 'test-only-env'
  try {
    const fake = createFakeCtx()
    await fake.service.ready
    const envName = envNameOf('TAKE_KEY')
    assert.equal(collect(fake)[envName], 'test-only-env')
    // 索引接管：受管 contributor 注册前继承 contributor 让位（无一键两主）。
    await fake.service.setGlobal('TAKE_KEY', 'test-only-managed', '')
    assert.equal(collect(fake)[envName], 'test-only-managed')
    // 继承条目消失（已入索引）。
    const list = await fake.service.list()
    assert.equal(list.inherited.length, 0)
    // 移出索引后回落继承转发。
    await fake.service.unsetGlobal('TAKE_KEY')
    assert.equal(collect(fake)[envName], 'test-only-env')
  } finally {
    delete process.env[envNameOf('TAKE_KEY')]
  }
})
