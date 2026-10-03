/**
 * 卡片草稿纯逻辑测试：解析值 ↔ 草稿 ↔ settings 载荷的往返与边界校验。
 * （draft.ts 不含 JSX/React，node --test 可直接导入。）
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { draftOf, emptyParamDraft, emptyPromptDraft, payloadOf } from '../src/client/draft.ts'
import type { ImageStudioConfig } from '../src/config.ts'

const VALUE: ImageStudioConfig = {
  promptPresets: [{ id: 'p1', name: '写实', text: 'a photo' }],
  paramPresets: [
    {
      id: 'q1',
      name: '默认',
      endpoint: 'generation',
      paramSpecs: { size: { enabled: true, value: '1024x1024' } },
    },
  ],
  providerPresets: [
    {
      id: 'my-relay',
      name: '中转',
      protocol: 'openai-images',
      baseUrl: 'https://relay.example.com/v1',
      model: 'gpt-image-1',
      credentialRef: 'IMAGE_STUDIO_PRESET_MY_RELAY',
      extraHeaders: { 'x-token': 'abc' },
    },
  ],
  maxConcurrent: 2,
  requestTimeoutMs: 300_000,
  proxy: '',
  galleryMaxItems: 50,
  uploadTtlHours: 24,
}

test('给定配置值，当折算草稿时，则 JSON 字段以格式化文本镜像', () => {
  const draft = draftOf(VALUE)
  assert.equal(draft.providers[0]?.extraHeadersText, JSON.stringify({ 'x-token': 'abc' }, null, 2))
  assert.equal(
    draft.params[0]?.specsText,
    JSON.stringify({ size: { enabled: true, value: '1024x1024' } }, null, 2),
  )
  assert.equal(draft.maxConcurrent, '2')
  assert.equal(draft.uploadTtlHours, '24')
})

test('给定草稿，当折算载荷时，则凭据引用重算、数值折算并夹取下界', () => {
  const draft = draftOf(VALUE)
  draft.maxConcurrent = '-3'
  draft.requestTimeoutMs = '10'
  draft.galleryMaxItems = 'abc'
  // 非数字（含 '0'）落到默认 24，小数下取整后夹取下界 1
  draft.uploadTtlHours = '0.4'
  const payload = payloadOf(draft)
  assert.equal(payload['maxConcurrent'], 0)
  assert.equal(payload['requestTimeoutMs'], 10_000)
  assert.equal(payload['galleryMaxItems'], 0)
  assert.equal(payload['uploadTtlHours'], 1)
  assert.deepEqual(
    (payload['providerPresets'] as Array<Record<string, unknown>>)[0]?.['credentialRef'],
    'IMAGE_STUDIO_PRESET_MY_RELAY',
  )
  assert.deepEqual(payload['promptPresets'], [{ id: 'p1', name: '写实', text: 'a photo' }])
})

test('给定非法预设 id 或畸形参数表，当折算载荷时，则抛错拦在保存前', () => {
  const badId = draftOf(VALUE)
  if (badId.providers[0] !== undefined) badId.providers[0].id = 'Bad Id'
  assert.throws(() => payloadOf(badId))

  const badSpecs = draftOf(VALUE)
  if (badSpecs.params[0] !== undefined) badSpecs.params[0].specsText = '{"size": true}'
  assert.throws(() => payloadOf(badSpecs))

  const badJson = draftOf(VALUE)
  if (badJson.providers[0] !== undefined) badJson.providers[0].extraHeadersText = '{'
  assert.throws(() => payloadOf(badJson))
})

test('给定新增行，当生成空草稿时，则 id/名称留空、协议与参数表带默认值', () => {
  const param = emptyParamDraft()
  assert.equal(param.endpoint, 'generation')
  assert.equal(param.specsText, '{}')
  assert.ok(param.id.startsWith('param-'))
  const prompt = emptyPromptDraft()
  assert.equal(prompt.name, '')
  assert.ok(prompt.id.startsWith('prompt-'))
})
