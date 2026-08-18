import assert from 'node:assert/strict'
import { test } from 'node:test'

import { inferApi, translateProvider, translateProviders } from '../src/fallback-llm.ts'

test('given explicit api, when inferring, then wins over all hints', () => {
  assert.equal(inferApi('chat', { api: 'openai-responses' }), 'openai-responses')
})

test('given route name hint, when inferring without explicit api, then uses route table', () => {
  assert.equal(inferApi('chat', {}), 'openai-completions')
  assert.equal(inferApi('response', {}), 'openai-responses')
  assert.equal(inferApi('anthropic', {}), 'anthropic-messages')
})

test('given only model extends, when inferring, then maps known source prefix', () => {
  assert.equal(inferApi('custom', { models: [{ id: 'k3', extends: 'kimi-coding/k3' }] }), 'anthropic-messages')
  assert.equal(inferApi('custom', { models: [{ id: 'v4', extends: 'deepseek/deepseek-v4-flash' }] }), 'openai-completions')
})

test('given no hint at all, when inferring, then falls back to openai-completions', () => {
  assert.equal(inferApi('mystery', { models: [{ id: 'm', extends: 'unknown/m' }] }), 'openai-completions')
  assert.equal(inferApi('mystery', {}), 'openai-completions')
})

test('given full provider, when translating, then carries whitelisted fields only', () => {
  const out = translateProvider('chat', {
    displayName: 'newapi(chat)',
    apiKeyEnv: 'NEWAPI_API_KEY',
    baseURL: 'https://gw.example/v1',
    reasoning: 'max',
    compat: { thinkingFormat: 'deepseek', maxTokensField: 'max_completion_tokens' },
    models: [
      { id: 'deepseek-v4-flash', name: 'Flash', contextWindow: 400000, input: [], extends: 'deepseek/deepseek-v4-flash' },
    ],
  })
  assert.equal(out.displayName, 'newapi(chat) [fallback]')
  assert.equal(out.api, 'openai-completions')
  assert.equal(out.apiKeyEnv, 'NEWAPI_API_KEY')
  assert.equal(out.reasoning, 'max')
  assert.deepEqual(out.compat, { thinkingFormat: 'deepseek' })
  assert.deepEqual(out.models, [{ id: 'deepseek-v4-flash', name: 'Flash', contextWindow: 400000 }])
})

test('given out-of-vocabulary reasoning, when translating, then drops it', () => {
  const out = translateProvider('chat', { reasoning: 'ultra' })
  assert.equal(out.reasoning, undefined)
})

test('given provider dict, when translating all, then keys get fallback suffix', () => {
  const out = translateProviders({ chat: {}, anthropic: {} })
  assert.deepEqual(Object.keys(out).sort(), ['anthropic-fb', 'chat-fb'])
})
