/**
 * HTTP 端点路由集成测：经真实 node:http 请求打 FakeWebServer 捕获的 handler，
 * 验证 generate/tasks/gallery/images/uploads/credentials/providers/presets
 * 全路由与错误映射。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Context, Service } from '@deepseek-ai/cordis'
import { readBinaryBody } from '../src/api.ts'
import { Config, type ImageStudioConfig } from '../src/config.ts'
import { ImageStudioService } from '../src/service.ts'

const PNG_1PX = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52,
])

/** 上游 mock（b64 回包）。 */
function startUpstream(): Promise<{ server: Server; baseUrl: string; bodies: string[] }> {
  const bodies: string[] = []
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      bodies.push(`${req.url}\u0000${Buffer.concat(chunks).toString('utf8')}`)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          created: 9,
          data: [{ b64_json: Buffer.from(PNG_1PX).toString('base64'), revised_prompt: null }],
        }),
      )
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
        bodies,
      })
    })
  })
}

class FakeCredentialsService extends Service {
  readonly store: Map<string, string>

  constructor(ctx: Context, seed: Map<string, string>) {
    super(ctx, 'credentials')
    this.store = seed
  }

  async resolve(ref: unknown): Promise<{ value: string; source: string } | undefined> {
    const name = String((ref as { name?: string }).name ?? ref)
    const value = this.store.get(name)
    return value === undefined ? undefined : { value, source: 'test' }
  }

  async describe(ref: unknown): Promise<{ configured: boolean }> {
    const name = String((ref as { name?: string }).name ?? ref)
    return { configured: this.store.has(name) }
  }

  async set(ref: unknown, value: string): Promise<void> {
    this.store.set(String((ref as { name?: string }).name ?? ref), value)
  }

  async unset(ref: unknown): Promise<void> {
    this.store.delete(String((ref as { name?: string }).name ?? ref))
  }
}

class FakeWebServerService extends Service {
  handler: ((req: IncomingMessage, res: ServerResponse) => void) | null = null

  constructor(ctx: Context) {
    super(ctx, 'webServer')
  }

  register(entry: {
    kind: string
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void
  }): void {
    this.handler = entry.handler
  }
}

interface Harness {
  service: ImageStudioService
  web: FakeWebServerService
  credentials: FakeCredentialsService
  home: string
  httpServer: Server
  upstream: Server
  upstreamBase: string
  /** 上游收到的原始请求（`url\0body`），断言请求形态用。 */
  upstreamBodies: string[]
  dispose: () => void
}

async function makeHarness(): Promise<Harness> {
  const home = mkdtempSync(join(tmpdir(), 'image-studio-api-'))
  process.env.DSH_HOME = home
  const upstream = await startUpstream()
  const ctx = new Context()
  ctx.plugin(FakeCredentialsService, new Map([['IMAGE_STUDIO_PRESET_PACKY', 'sk-key']]))
  ctx.plugin(FakeWebServerService)
  await new Promise((r) => setTimeout(r, 20))
  const web = ctx.get('webServer') as unknown as FakeWebServerService
  const config = Config({
    providerPresets: [
      {
        id: 'packy',
        name: 'Packy',
        protocol: 'openai-images',
        baseUrl: upstream.baseUrl,
        model: 'gpt-image-2',
        credentialRef: 'IMAGE_STUDIO_PRESET_PACKY',
        extraHeaders: {},
      },
    ],
  } as Partial<ImageStudioConfig>)
  const service = new ImageStudioService(ctx, config)
  // 经真实 http server 打插件 handler（同源路由语义）。
  const httpServer = createServer((req, res) => {
    web.handler?.(req, res)
  })
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
  return {
    service,
    web,
    credentials: ctx.get('credentials') as unknown as FakeCredentialsService,
    home,
    httpServer,
    upstream: upstream.server,
    upstreamBase: upstream.baseUrl,
    upstreamBodies: upstream.bodies,
    dispose: () => {
      httpServer.close()
      upstream.server.close()
      rmSync(home, { recursive: true, force: true })
    },
  }
}

const BASE = '/dsh-plus/image-studio'

async function call(
  harness: Harness,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: unknown; contentType?: string }> {
  const port = (harness.httpServer.address() as AddressInfo).port
  const res = await fetch(`http://127.0.0.1:${port}${BASE}${path}`, init)
  const contentType = res.headers.get('content-type') ?? undefined
  if (contentType?.includes('json')) {
    return { status: res.status, body: (await res.json()) as unknown, contentType }
  }
  return { status: res.status, body: new Uint8Array(await res.arrayBuffer()), contentType }
}

test('providers：协议 registry 与参数目录投影', async () => {
  const harness = await makeHarness()
  try {
    const { status, body } = await call(harness, '/providers')
    assert.equal(status, 200)
    const wire = body as {
      protocols: Array<{ id: string; endpoints: string[] }>
      params: unknown[]
    }
    assert.deepEqual(wire.protocols[0]?.id, 'openai-images')
    assert.ok(wire.params.length >= 13, '参数目录应覆盖官方全集')
  } finally {
    harness.dispose()
  }
})

test('generate → 202 接受 → tasks 轮询到 succeeded → 画廊/图片可达', async () => {
  const harness = await makeHarness()
  try {
    const accepted = await call(harness, '/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        providerPresetId: 'packy',
        endpoint: 'generation',
        prompt: '端到端',
        paramSpecs: { size: { enabled: true, value: '1024x1024' } },
      }),
    })
    assert.equal(accepted.status, 202)
    const { taskId } = accepted.body as { taskId: string }
    let wire: { state: string; galleryItemId: string | null } | null = null
    for (let i = 0; i < 100; i += 1) {
      await new Promise((r) => setTimeout(r, 20))
      const single = await call(harness, `/tasks/${taskId}`)
      wire = single.body as { state: string; galleryItemId: string | null }
      if (wire.state === 'succeeded' || wire.state === 'failed') break
    }
    assert.equal(wire?.state, 'succeeded')
    const gallery = await call(harness, '/gallery')
    const items = (
      gallery.body as { items: Array<{ id: string | null; imageIds: string[]; prompt: string }> }
    ).items
    assert.equal(items.length, 1)
    assert.equal(items[0]?.prompt, '端到端')
    const imageRes = await call(harness, `/images/${items[0]?.imageIds[0]}`)
    assert.equal(imageRes.status, 200)
    assert.match(imageRes.contentType ?? '', /image\/png/)
    // 参数回放（详情端点）。
    const detail = await call(harness, `/gallery/${items[0]?.id}`)
    const item = detail.body as { params: Record<string, unknown>; prompt: string }
    assert.equal(item.params.size, '1024x1024')
    // DELETE 移除。
    const removed = await call(harness, `/gallery/${items[0]?.id}`, { method: 'DELETE' })
    assert.equal(removed.status, 200)
  } finally {
    harness.dispose()
  }
})

test('credentials：GET describe / POST set / DELETE unset（值永不回传）', async () => {
  const harness = await makeHarness()
  try {
    const described = await call(harness, '/credentials/packy')
    assert.deepEqual(described.body, {
      credentialRef: 'IMAGE_STUDIO_PRESET_PACKY',
      configured: true,
    })
    await call(harness, '/credentials/second', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'sk-2' }),
    })
    const afterSet = await call(harness, '/credentials/second')
    assert.deepEqual(afterSet.body, {
      credentialRef: 'IMAGE_STUDIO_PRESET_SECOND',
      configured: true,
    })
    await call(harness, '/credentials/second', { method: 'DELETE' })
    const afterUnset = await call(harness, '/credentials/second')
    assert.deepEqual(afterUnset.body, {
      credentialRef: 'IMAGE_STUDIO_PRESET_SECOND',
      configured: false,
    })
    // 值泄漏防护：任何响应不包含明文 key。
    const text = JSON.stringify(afterSet.body)
    assert.ok(!text.includes('sk-2'), 'describe 不得回传凭据值')
  } finally {
    harness.dispose()
  }
})

test('边界：未知端点 404、非法参数 400、未知任务 400', async () => {
  const harness = await makeHarness()
  try {
    const unknown = await call(harness, '/nope')
    assert.equal(unknown.status, 404)
    const bad = await call(harness, '/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        endpoint: 'generation',
        prompt: 'x',
        inlineProvider: { protocol: 'openai-images', baseUrl: 'http://x/v1', model: 'm' },
      }),
    })
    assert.equal(bad.status, 400)
    assert.equal((bad.body as { error: string }).error, 'invalid-request')
    const missing = await call(harness, '/tasks/task-999')
    assert.equal(missing.status, 400)
    assert.equal((missing.body as { error: string }).error, 'unknown-task')
    // 参数越界同样 400。
    const overflow = await call(harness, '/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        providerPresetId: 'packy',
        endpoint: 'generation',
        prompt: 'x',
        paramSpecs: { n: { enabled: true, value: 99 } },
      }),
    })
    assert.equal(overflow.status, 400)
  } finally {
    harness.dispose()
  }
})

test('cancel：运行中任务可取消', async () => {
  const harness = await makeHarness()
  try {
    const accepted = await call(harness, '/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        providerPresetId: 'packy',
        endpoint: 'generation',
        prompt: 'cancellable',
      }),
    })
    const { taskId } = accepted.body as { taskId: string }
    const canceled = await call(harness, `/tasks/${taskId}/cancel`, { method: 'POST' })
    assert.ok(
      canceled.status === 200 || canceled.status === 409,
      '取消应返回 200（受理）或 409（已完结）',
    )
  } finally {
    harness.dispose()
  }
})

test('presets：只读快照端点', async () => {
  const harness = await makeHarness()
  try {
    const { status, body } = await call(harness, '/presets')
    assert.equal(status, 200)
    const wire = body as {
      providerPresets: Array<{ id: string }>
      promptPresets: unknown[]
      paramPresets: unknown[]
    }
    assert.equal(wire.providerPresets[0]?.id, 'packy')
  } finally {
    harness.dispose()
  }
})

/** 上传一张 PNG（raw body + query 文件名），返回响应体。 */
async function uploadPng(
  harness: Harness,
  name = 'ref.png',
  bytes: Uint8Array = PNG_1PX,
): Promise<{ status: number; body: unknown }> {
  return call(harness, `/uploads?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    // Buffer 视图满足 BodyInit（Uint8Array<ArrayBufferLike> 不被 DOM 类型接受）。
    body: Buffer.from(bytes),
  })
}

test('uploads：原图上传 → 列表/缩略图可达，非图片与超限被拒', async () => {
  const harness = await makeHarness()
  try {
    const created = await uploadPng(harness, '参考图.png')
    assert.equal(created.status, 201)
    const entry = created.body as { id: string; name: string; mime: string; size: number }
    assert.match(entry.id, /^[0-9a-f-]{36}$/)
    assert.equal(entry.name, '参考图.png', '原始文件名经 query 保留')
    assert.equal(entry.mime, 'image/png', 'MIME 由魔数嗅探决定')
    assert.equal(entry.size, PNG_1PX.byteLength)

    const list = await call(harness, '/uploads')
    assert.equal(list.status, 200)
    assert.equal((list.body as { total: number }).total, 1)

    const thumb = await call(harness, `/uploads/${entry.id}`)
    assert.equal(thumb.status, 200)
    assert.match(thumb.contentType ?? '', /image\/png/)
    assert.ok((thumb.body as Uint8Array).byteLength > 0)

    // 伪装成图片的文本：魔数嗅探拒绝（415），不落盘。
    const fake = await uploadPng(harness, 'fake.png', new TextEncoder().encode('not an image'))
    assert.equal(fake.status, 415)
    assert.equal((fake.body as { error: string }).error, 'unsupported-media')
    const afterFake = await call(harness, '/uploads')
    assert.equal((afterFake.body as { total: number }).total, 1, '被拒的上传不得进索引')

    // 未知上传 id：404。
    const missing = await call(harness, '/uploads/3f2504e0-4f89-11d3-9a0c-0305e82c3301')
    assert.equal(missing.status, 404)
  } finally {
    harness.dispose()
  }
})

test('edit：本地文件上传的源图可直接作为 edits 输入', async () => {
  const harness = await makeHarness()
  try {
    const created = await uploadPng(harness, 'source.png')
    const uploadId = (created.body as { id: string }).id
    const before = harness.upstreamBodies.length
    const accepted = await call(harness, '/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        providerPresetId: 'packy',
        endpoint: 'edit',
        prompt: '把背景换成海滩',
        sources: [{ kind: 'upload', id: uploadId }],
      }),
    })
    assert.equal(accepted.status, 202)
    const { taskId } = accepted.body as { taskId: string }
    let wire: { state: string } | null = null
    for (let i = 0; i < 100; i += 1) {
      await new Promise((r) => setTimeout(r, 20))
      wire = (await call(harness, `/tasks/${taskId}`)).body as { state: string }
      if (wire.state === 'succeeded' || wire.state === 'failed') break
    }
    assert.equal(wire?.state, 'succeeded')
    const editBody = harness.upstreamBodies[before] ?? ''
    assert.match(editBody, /\/v1\/images\/edits/)
    assert.match(editBody, /name="image"/, '上传源图应作为 multipart image 字段发出')
    // 衍生链：上传引用记入条目（画廊 imageId 未参与本任务）。
    const items = (await call(harness, '/gallery')).body as {
      items: Array<{ prompt: string; sourceIds: string[]; sourceUploads: string[] }>
    }
    const item = items.items.find((entry) => entry.prompt === '把背景换成海滩')
    assert.deepEqual(item?.sourceUploads, [uploadId])
    assert.deepEqual(item?.sourceIds, [])
  } finally {
    harness.dispose()
  }
})

test('边界：源图引用形态非法（未知 kind / 非 uuid）拒绝', async () => {
  const harness = await makeHarness()
  try {
    for (const sources of [
      [{ kind: 'weird', id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' }],
      [{ kind: 'gallery', id: '../../etc/passwd' }],
      [{ kind: 'upload', id: 'nope' }],
    ]) {
      const res = await call(harness, '/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          providerPresetId: 'packy',
          endpoint: 'edit',
          prompt: 'x',
          sources,
        }),
      })
      assert.equal(res.status, 400, `${JSON.stringify(sources)} 应被拒绝`)
      assert.equal((res.body as { error: string }).error, 'invalid-request')
    }
    // 非数组形态同样按 invalid-request 拒绝（不落到 500）。
    for (const sources of ['not-an-array', null, 42]) {
      const res = await call(harness, '/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ providerPresetId: 'packy', endpoint: 'edit', prompt: 'x', sources }),
      })
      assert.equal(res.status, 400, `${JSON.stringify(sources)} 应被拒绝`)
      assert.equal((res.body as { error: string }).error, 'invalid-request')
    }
    // 不存在的上传 id：形态合法但查无此图。
    const ghost = await call(harness, '/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        providerPresetId: 'packy',
        endpoint: 'edit',
        prompt: 'x',
        sources: [{ kind: 'upload', id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' }],
      }),
    })
    assert.equal(ghost.status, 400)
    assert.equal((ghost.body as { error: string }).error, 'unknown-source')
  } finally {
    harness.dispose()
  }
})

test('遮罩边界：非 PNG 遮罩在提交前拒绝（不用白跑一次计费请求）', async () => {
  const harness = await makeHarness()
  try {
    // JP/WebP 遮罩（含上传通道）一律拒绝：官方 mask 必须是带透明的 PNG。
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46])
    const uploaded = await uploadPng(harness, 'mask.jpg', jpeg)
    assert.equal(uploaded.status, 201)
    const uploadId = (uploaded.body as { id: string; mime: string }).id
    assert.equal((uploaded.body as { mime: string }).mime, 'image/jpeg')
    const rejected = await call(harness, '/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        providerPresetId: 'packy',
        endpoint: 'edit',
        prompt: 'x',
        sources: [{ kind: 'upload', id: uploadId }],
        mask: { kind: 'upload', id: uploadId },
      }),
    })
    assert.equal(rejected.status, 415)
    assert.equal((rejected.body as { error: string }).error, 'unsupported-media')
    assert.match((rejected.body as { message: string }).message, /PNG/)
  } finally {
    harness.dispose()
  }
})

test('readBinaryBody：超过限额即中止（不依赖构造 50MB 负载）', async () => {
  const { Readable } = await import('node:stream')
  const chunks = [Buffer.alloc(64, 1), Buffer.alloc(64, 2)]
  const stream = Readable.from(chunks) as unknown as IncomingMessage
  await assert.rejects(
    () => readBinaryBody(stream, 100),
    (error: Error) => error.message.includes('上限'),
  )
  const ok = Readable.from([Buffer.alloc(32, 7)]) as unknown as IncomingMessage
  assert.equal((await readBinaryBody(ok, 100)).byteLength, 32)
})
