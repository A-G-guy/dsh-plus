import assert from 'node:assert/strict'
import { test } from 'node:test'

import { extractMarkdownLinks, normalizeSearchOutput } from '../src/normalize.ts'

test('given tavily envelope, when normalized, then sources carry content/published_date and answer becomes content', () => {
  const raw = {
    ok: true,
    service: 'tavily',
    selectedService: 'tavily',
    status: 200,
    data: {
      answer: 'Tavily 生成的回答',
      results: [
        {
          title: 'T1',
          url: 'https://a.example.com/1',
          content: 'snippet-1',
          published_date: '2026-09-01',
        },
        { title: 'T2', url: 'https://b.example.com/2', content: 'snippet-2' },
        { url: 'https://no-title.example.com' },
        { title: 'no-url 被丢弃' },
      ],
    },
  }
  const result = normalizeSearchOutput(raw)
  assert.equal(result.content, 'Tavily 生成的回答')
  assert.equal(result.truncated, false)
  assert.deepEqual(
    result.sources.map((s) => s.url),
    ['https://a.example.com/1', 'https://b.example.com/2', 'https://no-title.example.com'],
  )
  const first = result.sources[0]
  assert.equal(first?.title, 'T1')
  assert.equal(first?.snippet, 'snippet-1')
  assert.equal(first?.publishedAt, '2026-09-01')
})

test('given legacy top-level tavily payload, when normalized, then still works (shape tolerance)', () => {
  const result = normalizeSearchOutput({
    ok: true,
    selectedService: 'tavily',
    answer: 'A',
    results: [{ title: 'T', url: 'https://legacy.example.com' }],
  })
  assert.equal(result.content, 'A')
  assert.equal(result.sources[0]?.url, 'https://legacy.example.com')
})

test('given exa envelope, when normalized, then id falls back to url and highlights join into snippet', () => {
  const raw = {
    ok: true,
    service: 'exa',
    selectedService: 'exa',
    status: 200,
    data: {
      results: [
        {
          id: 'https://exa.example.com/x',
          title: 'E1',
          highlights: ['h1', 'h2'],
          publishedDate: '2026-08-30',
        },
        { url: 'https://exa.example.com/y', highlights: [] },
      ],
    },
  }
  const result = normalizeSearchOutput(raw)
  assert.equal(result.content, undefined)
  assert.equal(result.sources[0]?.url, 'https://exa.example.com/x')
  assert.equal(result.sources[0]?.snippet, 'h1 h2')
  assert.equal(result.sources[0]?.publishedAt, '2026-08-30')
  assert.equal(result.sources[1]?.snippet, undefined)
})

test('given openai-chat payload, when normalized, then answer becomes content and markdown links become sources', () => {
  const answer =
    '结论：[官方文档](https://docs.example.com/dsh) 与 [社区帖](https://bbs.example.com/t/1)。重复 [官方文档](https://docs.example.com/dsh)。'
  const result = normalizeSearchOutput({
    ok: true,
    selectedService: 'openai-chat',
    data: { answer },
  })
  assert.equal(result.content, answer)
  assert.deepEqual(
    result.sources.map((s) => [s.url, s.title]),
    [
      ['https://docs.example.com/dsh', '官方文档'],
      ['https://bbs.example.com/t/1', '社区帖'],
    ],
  )
})

test('given openai-chat payload without links, when normalized, then content-only result is legal', () => {
  const result = normalizeSearchOutput({
    ok: true,
    selectedService: 'openai-chat',
    data: { answer: '纯文本回答' },
  })
  assert.equal(result.content, '纯文本回答')
  assert.deepEqual(result.sources, [])
})

test('given ok=false with attempts, when normalized, then error message carries per-backend failure summary', () => {
  assert.throws(
    () =>
      normalizeSearchOutput({
        ok: false,
        error: '所有候选搜索服务均不可用或返回失败',
        attempts: [
          { service: 'tavily', error: 'HTTP 429' },
          { service: 'exa', error: 'quota exceeded' },
        ],
      }),
    /所有候选搜索服务均不可用或返回失败（尝试过: tavily: HTTP 429; exa: quota exceeded）/,
  )
})

test('given unknown selectedService, when normalized, then loud error instead of guess', () => {
  assert.throws(
    () => normalizeSearchOutput({ ok: true, selectedService: 'context7' }),
    /未知或不支持/,
  )
})

test('given markdown with duplicate/bare links, when extracted, then dedup by url with limit', () => {
  const md =
    '[a](https://x.example.com) [b](https://x.example.com) [c](https://y.example.com) ![](https://z.example.com/img.png)'
  const links = extractMarkdownLinks(md, 10)
  assert.deepEqual(
    links.map((s) => s.url),
    ['https://x.example.com', 'https://y.example.com', 'https://z.example.com/img.png'],
  )
  assert.equal(extractMarkdownLinks(md, 2).length, 2)
})

test('given over-long tavily content, when normalized, then snippet capped with ellipsis', () => {
  const longContent = 'x'.repeat(1200)
  const result = normalizeSearchOutput({
    ok: true,
    selectedService: 'tavily',
    data: { results: [{ title: 'T', url: 'https://a.example.com', content: longContent }] },
  })
  const snippet = result.sources[0]?.snippet
  assert.ok(snippet !== undefined)
  assert.equal(snippet.length, 501)
  assert.ok(snippet.endsWith('…'))
})

test('given short tavily content, when normalized, then snippet passes through untouched', () => {
  const result = normalizeSearchOutput({
    ok: true,
    selectedService: 'tavily',
    data: { results: [{ title: 'T', url: 'https://a.example.com', content: 'short' }] },
  })
  assert.equal(result.sources[0]?.snippet, 'short')
})
