/**
 * service 层端到端（零网络出站，本地 mock 上游）：
 * 提交 → 并发执行 → 画廊入库 → 任务状态投影 → 凭据即时 resolve。
 * credentials/settings/webServer 均以 cordis 注入伪对象承载。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Context, Service } from '@deepseek-ai/cordis'
import { Config, type ImageStudioConfig } from '../src/config.ts'
import { ImageStudioService } from '../src/service.ts'

const PNG_1PX = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52,
])

/** credentials 伪服务（Service 子类直接实现，方法在原型上可被 cordis 代理）。 */
function credentialRefName(ref: unknown): string {
  return String((ref as { name?: string }).name ?? ref)
}

class FakeCredentialsService extends Service {
  readonly store = new Map<string, string>()
  resolveCount = 0

  constructor(ctx: Context, seed: Map<string, string>) {
    super(ctx, 'credentials')
    for (const [key, value] of seed) this.store.set(key, value)
  }

  async resolve(ref: unknown): Promise<{ value: string; source: string } | undefined> {
    this.resolveCount += 1
    const value = this.store.get(credentialRefName(ref))
    return value === undefined ? undefined : { value, source: 'test' }
  }

  async describe(ref: unknown): Promise<{ configured: boolean }> {
    return { configured: this.store.has(credentialRefName(ref)) }
  }

  async set(ref: unknown, value: string): Promise<void> {
    this.store.set(credentialRefName(ref), value)
  }

  async unset(ref: unknown): Promise<void> {
    this.store.delete(credentialRefName(ref))
  }
}

/** webServer 伪实现：捕获注册的 prefix 路由。 */
class FakeWebServer {
  route: { kind: string; path: string; handler: (req: unknown, res: unknown) => void } | null = null

  register(entry: {
    kind: string
    path: string
    handler: (req: unknown, res: unknown) => void
  }): void {
    this.route = entry
  }
}

class FakeWebServerService extends Service {
  readonly route: FakeWebServer

  constructor(ctx: Context, instance: FakeWebServer) {
    super(ctx, 'webServer')
    this.route = instance
  }

  register(entry: {
    kind: string
    path: string
    handler: (req: unknown, res: unknown) => void
  }): void {
    this.route.register(entry)
  }
}

interface Harness {
  service: ImageStudioService
  credentials: FakeCredentialsService
  webServer: FakeWebServerService
  ctx: Context
  home: string
  baseUrl: string
  server: Server
  upstreamBodies: string[]
}

async function makeHarness(overrides: Partial<ImageStudioConfig> = {}): Promise<Harness> {
  const home = mkdtempSync(join(tmpdir(), 'image-studio-svc-'))
  process.env.DSH_HOME = home
  // 本地 mock 上游：回一张 1px PNG（b64 形态），记录每次收到的请求体。
  const upstreamBodies: string[] = []
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      upstreamBodies.push(`${req.url}\u0000${Buffer.concat(chunks).toString('utf8')}`)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          created: 42,
          data: [{ b64_json: Buffer.from(PNG_1PX).toString('base64'), revised_prompt: 'rp' }],
        }),
      )
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`

  const credentialsSeed = new Map<string, string>([['IMAGE_STUDIO_PRESET_PACKY', 'sk-test-key']])
  const webServer = new FakeWebServer()

  const ctx = new Context()
  ctx.plugin(FakeCredentialsService, credentialsSeed)
  ctx.plugin(FakeWebServerService, webServer)
  // cordis fiber 化延迟实例化：等伪服务就绪后取活实例再建消费方。
  await new Promise((r) => setTimeout(r, 20))
  const credentialsService = ctx.get('credentials') as unknown as FakeCredentialsService
  const webServerService = ctx.get('webServer') as unknown as FakeWebServerService

  const config = Config({
    providerPresets: [
      {
        id: 'packy',
        name: 'Packy 中转',
        protocol: 'openai-images',
        baseUrl,
        model: 'gpt-image-2',
        credentialRef: 'IMAGE_STUDIO_PRESET_PACKY',
        extraHeaders: {},
      },
    ],
    maxConcurrent: 2,
    requestTimeoutMs: 10_000,
    proxy: '',
    ...overrides,
  } as never)
  const service = new ImageStudioService(ctx, config)
  return {
    service,
    credentials: credentialsService,
    webServer: webServerService,
    ctx,
    home,
    baseUrl,
    server,
    upstreamBodies,
  }
}

test('提交生图任务：排队 → 执行 → 成功入画廊（凭据即时 resolve）', async () => {
  const harness = await makeHarness()
  try {
    const taskId = await harness.service.submitGenerate({
      providerPresetId: 'packy',
      endpoint: 'generation',
      prompt: '一只橘猫',
      paramSpecs: { size: { enabled: true, value: '1024x1024' } },
    })
    assert.match(taskId, /^task-\d+$/)
    // 轮询至完结（runner pump 链为异步）。
    let wire = harness.service.taskWire(taskId)
    for (let i = 0; i < 50 && wire?.state !== 'succeeded' && wire?.state !== 'failed'; i += 1) {
      await new Promise((r) => setTimeout(r, 20))
      wire = harness.service.taskWire(taskId)
    }
    assert.equal(wire?.state, 'succeeded', `任务应成功：${wire?.error ?? ''}`)
    assert.ok(wire?.galleryItemId)
    // 上游收到 JSON 请求体（generations），含 Authorization。
    const body = harness.upstreamBodies[0] ?? ''
    assert.match(body, /\/v1\/images\/generations/)
    assert.match(body, /"prompt":"一只橘猫"/)
    assert.match(body, /"size":"1024x1024"/)
    assert.equal(harness.credentials.resolveCount, 1, '凭据在任务执行时即时 resolve')
    // 画廊条目存在且图片可读。
    const items = await harness.service.gallery()
    assert.equal(items.length, 1)
    assert.equal(items[0]?.prompt, '一只橘猫')
    const seededId = items[0]?.imageIds[0]
    assert.ok(seededId, '画廊条目应含图片 id')
    const bytes = await harness.service.imageBytes(seededId)
    assert.ok(bytes, '结果图应已落盘')
  } finally {
    harness.server.close()
    rmSync(harness.home, { recursive: true, force: true })
  }
})

test('并发上限生效：maxConcurrent=1 时第二任务排队', async () => {
  let release!: () => void
  const gate = new Promise<void>((r) => {
    release = r
  })
  // 专用慢上游：请求挂起直至放行（不复用 harness.server，避免动其内部监听）。
  let hits = 0
  const slow = createServer(
    (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => {
      req.resume()
      hits += 1
      void gate.then(() => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            created: 1,
            data: [{ b64_json: Buffer.from(PNG_1PX).toString('base64') }],
          }),
        )
      })
    },
  )
  await new Promise<void>((resolve) => slow.listen(0, '127.0.0.1', resolve))
  const slowBase = `http://127.0.0.1:${(slow.address() as AddressInfo).port}/v1`
  const harness = await makeHarness({
    maxConcurrent: 1,
    providerPresets: [
      {
        id: 'packy',
        name: 'slow',
        protocol: 'openai-images',
        baseUrl: slowBase,
        model: 'gpt-image-2',
        credentialRef: 'IMAGE_STUDIO_PRESET_PACKY',
        extraHeaders: {},
      },
    ],
  } as Partial<ImageStudioConfig>)
  try {
    const first = await harness.service.submitGenerate({
      providerPresetId: 'packy',
      endpoint: 'generation',
      prompt: 'first',
    })
    const second = await harness.service.submitGenerate({
      providerPresetId: 'packy',
      endpoint: 'generation',
      prompt: 'second',
    })
    await new Promise((r) => setTimeout(r, 30))
    assert.equal(harness.service.taskWire(first)?.state, 'running')
    assert.equal(harness.service.taskWire(second)?.state, 'queued', '并发 1 时第二任务应排队')
    assert.equal(hits, 1, '上游只应收到首个任务的请求')
    release()
    for (let i = 0; i < 100; i += 1) {
      await new Promise((r) => setTimeout(r, 20))
      if (
        harness.service.taskWire(second)?.state === 'succeeded' ||
        harness.service.taskWire(second)?.state === 'failed'
      ) {
        break
      }
    }
    assert.equal(harness.service.taskWire(second)?.state, 'succeeded')
    assert.equal(hits, 2, '放行后第二任务补位')
  } finally {
    release()
    slow.close()
    harness.server.close()
    rmSync(harness.home, { recursive: true, force: true })
  }
})

test('凭据未配置：提交即拒绝并携带结构化错误', async () => {
  const harness = await makeHarness()
  harness.credentials.store.delete('IMAGE_STUDIO_PRESET_PACKY')
  try {
    await assert.rejects(
      () =>
        harness.service.submitGenerate({
          providerPresetId: 'packy',
          endpoint: 'generation',
          prompt: 'x',
        }),
      (error: Error) => {
        assert.match(error.message, /凭据未配置|credential-unavailable/)
        return true
      },
    )
  } finally {
    harness.server.close()
    rmSync(harness.home, { recursive: true, force: true })
  }
})

test('edit 请求携带源图（multipart）且画廊记录 sourceIds', async () => {
  const harness = await makeHarness()
  try {
    // 先造一张画廊图作为源图。
    const seed = await harness.service.submitGenerate({
      providerPresetId: 'packy',
      endpoint: 'generation',
      prompt: 'seed',
    })
    for (let i = 0; i < 100; i += 1) {
      await new Promise((r) => setTimeout(r, 20))
      const state = harness.service.taskWire(seed)?.state
      if (state === 'succeeded' || state === 'failed') break
    }
    const items = await harness.service.gallery()
    const sourceImageId = items[0]?.imageIds[0]
    assert.ok(sourceImageId, '种子任务应产出图片')
    const before = harness.upstreamBodies.length
    const editTask = await harness.service.submitGenerate({
      providerPresetId: 'packy',
      endpoint: 'edit',
      prompt: '加上帽子',
      sourceIds: [sourceImageId],
      paramSpecs: { input_fidelity: { enabled: true, value: 'high' } },
    })
    for (let i = 0; i < 100; i += 1) {
      await new Promise((r) => setTimeout(r, 20))
      const state = harness.service.taskWire(editTask)?.state
      if (state === 'succeeded' || state === 'failed') break
    }
    assert.equal(harness.service.taskWire(editTask)?.state, 'succeeded')
    const editBody = harness.upstreamBodies[before] ?? ''
    assert.match(editBody, /\/v1\/images\/edits/)
    assert.match(editBody, /name="image"/, 'edit 请求应为 multipart 且含 image 字段')
    assert.match(editBody, /name="input_fidelity"/)
    const itemsAfter = await harness.service.gallery()
    const editItem = itemsAfter.find((item) => item.prompt === '加上帽子')
    assert.deepEqual(editItem?.sourceIds, [sourceImageId], '画廊应记录衍生链源图')
  } finally {
    harness.server.close()
    rmSync(harness.home, { recursive: true, force: true })
  }
})

test('inline 提供商 + 预设凭据引用', async () => {
  const harness = await makeHarness()
  try {
    const taskId = await harness.service.submitGenerate({
      providerPresetId: 'packy',
      inlineProvider: {
        protocol: 'openai-images',
        baseUrl: harness.baseUrl,
        model: 'gpt-image-mini',
      },
      endpoint: 'generation',
      prompt: 'inline',
    })
    for (let i = 0; i < 100; i += 1) {
      await new Promise((r) => setTimeout(r, 20))
      const state = harness.service.taskWire(taskId)?.state
      if (state === 'succeeded' || state === 'failed') break
    }
    const wire = harness.service.taskWire(taskId)
    assert.equal(wire?.state, 'succeeded', `任务应成功：${wire?.error ?? ''}`)
    assert.equal(wire?.model, 'gpt-image-mini')
  } finally {
    harness.server.close()
    rmSync(harness.home, { recursive: true, force: true })
  }
})
