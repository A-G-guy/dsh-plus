/**
 * OpenAI Images 适配器：请求构造（JSON/multipart）与本地 mock HTTP 往返。
 * mock 服务监听 127.0.0.1 随机端口，零真实 API 调用。
 */
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test } from 'node:test'

import {
  buildEditBody,
  buildGenerationBody,
  endpointPath,
  generateViaOpenAIImages,
} from '../src/provider/openai-images.ts'
import type { NormalizedRequest, ProviderTarget } from '../src/provider/types.ts'

const PNG_1PX = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52,
])

function target(baseUrl: string, over: Partial<ProviderTarget> = {}): ProviderTarget {
  return {
    protocol: 'openai-images',
    baseUrl,
    model: 'gpt-image-2',
    apiKey: 'sk-test',
    proxy: '',
    timeoutMs: 5000,
    ...over,
  }
}

function request(
  baseUrl: string,
  endpoint: NormalizedRequest['endpoint'],
  over: Partial<NormalizedRequest> = {},
): NormalizedRequest {
  return {
    target: target(baseUrl),
    endpoint,
    prompt: '一只橘猫',
    n: 1,
    images: [],
    mask: null,
    params: { size: '1024x1024', quality: 'high' },
    ...over,
  }
}

test('endpointPath 映射官方路径', () => {
  assert.equal(endpointPath('generation'), '/images/generations')
  assert.equal(endpointPath('edit'), '/images/edits')
})

test('generations 请求体为 JSON：model/prompt/n/启用参数', () => {
  const body = JSON.parse(buildGenerationBody(request('http://x', 'generation')))
  assert.equal(body.model, 'gpt-image-2', 'model 是请求基础，必须进请求体（缺省上游会落到 dall-e）')
  assert.equal(body.prompt, '一只橘猫')
  assert.equal(body.n, 1)
  assert.equal(body.size, '1024x1024')
  assert.equal(body.quality, 'high')
  assert.ok(!('stream' in body), '未启用参数不得出现')
})

test('edits 请求体为 multipart：model/prompt/n/参数/image/mask', () => {
  const { headers, body } = buildEditBody(
    request('http://x', 'edit', {
      images: [{ data: PNG_1PX, mime: 'image/png' }],
      mask: { data: PNG_1PX, mime: 'image/png' },
      params: { size: '1024x1024', input_fidelity: 'high' },
    }),
  )
  assert.match(headers['content-type'], /^multipart\/form-data; boundary=BOUNDARY$/)
  // 文本字段断言用 utf8 解码（中文 prompt）；文件头 ASCII 兼容同解码。
  const text = body.toString('utf8')
  assert.match(text, /name="model"\r\n\r\ngpt-image-2/, 'model 应作为表单字段入体')
  assert.match(text, /name="prompt"\r\n\r\n一只橘猫/)
  assert.match(text, /name="n"\r\n\r\n1/)
  assert.match(text, /name="size"\r\n\r\n1024x1024/)
  assert.match(text, /name="input_fidelity"\r\n\r\nhigh/)
  assert.match(text, /name="image"; filename="image-0\.png"/)
  assert.match(text, /name="mask"; filename="mask-0\.png"/)
  assert.ok(text.endsWith('--BOUNDARY--\r\n'))
})

test('edits 多张输入图：image 字段逐张编码（≤16 由边界校验）', () => {
  const { body } = buildEditBody(
    request('http://x', 'edit', {
      images: [
        { data: PNG_1PX, mime: 'image/png' },
        { data: PNG_1PX, mime: 'image/jpeg' },
      ],
    }),
  )
  const text = body.toString('latin1')
  assert.match(text, /filename="image-0\.png"/)
  assert.match(text, /filename="image-1\.jpeg"/)
})

test('b64_json 响应解码；revised_prompt 透传', async () => {
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8')
    })
    req.on('end', () => {
      assert.equal(req.url, '/v1/images/generations')
      assert.equal(req.headers.authorization, 'Bearer sk-test')
      const parsed = JSON.parse(body) as { prompt: string; model?: string }
      assert.equal(parsed.model, 'gpt-image-2', 'model 应随 JSON 请求体发送')
      assert.equal(parsed.prompt, '一只橘猫')
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          created: 1700000000,
          data: [
            { b64_json: Buffer.from(PNG_1PX).toString('base64'), revised_prompt: '改写后的提示词' },
          ],
        }),
      )
    })
  })
  await listen(server)
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
    const result = await generateViaOpenAIImages(
      request(url, 'generation'),
      new AbortController().signal,
    )
    assert.equal(result.images.length, 1)
    assert.equal(result.createdAt, 1700000000)
    const firstImage = result.images[0]
    assert.ok(firstImage, '应返回一张结果图')
    assert.equal(firstImage.revisedPrompt, '改写后的提示词')
    assert.deepEqual([...firstImage.data], [...PNG_1PX])
  } finally {
    server.close()
  }
})

test('url 响应：宿主拉取字节落盘口径（同源 mock 二跳）', async () => {
  const png = Buffer.from(PNG_1PX)
  const server = createServer((req, res) => {
    if (req.url?.startsWith('/file')) {
      res.writeHead(200, { 'content-type': 'image/png' })
      res.end(png)
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        created: 1,
        data: [{ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/file/x.png` }],
      }),
    )
  })
  await listen(server)
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
    const result = await generateViaOpenAIImages(
      request(url, 'generation'),
      new AbortController().signal,
    )
    assert.equal(result.images.length, 1)
    assert.equal(result.images[0]?.mime, 'image/png')
    assert.deepEqual(Buffer.from(result.images[0]?.data), png)
  } finally {
    server.close()
  }
})

test('上游错误：HTTP 状态与响应摘要结构化上抛', async () => {
  const server = createServer((_req, res) => {
    res.writeHead(429, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { message: 'rate limited' } }))
  })
  await listen(server)
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
    await assert.rejects(
      () => generateViaOpenAIImages(request(url, 'generation'), new AbortController().signal),
      (error: Error & { status?: number; upstreamBody?: string }) => {
        assert.equal(error.status, 429)
        assert.match(error.upstreamBody, /rate limited/)
        assert.match(error.message, /rate limited/, '错误消息应携带上游摘要，供任务条直接展示')
        return true
      },
    )
  } finally {
    server.close()
  }
})

test('上游 200 空响应：给出 baseUrl 诊断提示（网关对错误路径回空体）', async () => {
  const server = createServer((_req, res) => {
    // 网关对不存在的路由（如缺 /v1 的路径）返回 200 空 body。
    res.writeHead(200, {})
    res.end()
  })
  await listen(server)
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    await assert.rejects(
      () => generateViaOpenAIImages(request(url, 'generation'), new AbortController().signal),
      (error: Error & { status?: number }) => {
        assert.equal(error.status, 502)
        assert.match(error.message, /baseUrl 是否包含 \/v1/)
        return true
      },
    )
  } finally {
    server.close()
  }
})

test('multipart 端到端：edits 请求被 mock 端以 form 解析', async () => {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('latin1')
      assert.equal(req.url, '/v1/images/edits')
      assert.match(text, /name="model"\r\n\r\ngpt-image-2/, 'edits multipart 也应带 model')
      assert.match(text, /name="image"; filename="image-0\.png"/)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          created: 5,
          data: [{ b64_json: Buffer.from(PNG_1PX).toString('base64') }],
        }),
      )
    })
  })
  await listen(server)
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
    const result = await generateViaOpenAIImages(
      request(url, 'edit', { images: [{ data: PNG_1PX, mime: 'image/png' }] }),
      new AbortController().signal,
    )
    assert.equal(result.images.length, 1)
  } finally {
    server.close()
  }
})

function listen(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve())
  })
}
