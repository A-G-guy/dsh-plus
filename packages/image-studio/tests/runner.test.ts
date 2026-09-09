/**
 * TaskRunner 并发调度：FIFO、并发上限、取消语义、失败隔离。
 * 任务体为注入异步函数，不触网。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { TaskRunner } from '../src/task/runner.ts'

interface Snap {
  label: string
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

test('并发上限约束运行数，队列 FIFO 推进', async () => {
  const gates = [deferred(), deferred(), deferred()]
  let launched = 0
  let counter = 0
  const runner = new TaskRunner<Snap>({
    maxConcurrent: 2,
    nextId: () => `t${++counter}`,
  })
  const records = gates.map((gate, index) =>
    runner.submit({ label: `job-${index}` }, () => {
      launched += 1
      return gate.promise.then(() => index)
    }),
  )
  await Promise.resolve()
  assert.equal(launched, 2, '并发上限 2 时只有 2 个任务启动')
  assert.equal(records[2]?.state, 'queued')
  gates[0]?.resolve()
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(launched, 3, '首任务完成后队列任务补位')
  assert.equal(records[0]?.state, 'succeeded')
  gates[1]?.resolve()
  gates[2]?.resolve()
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(records[2]?.state, 'succeeded')
})

test('queued 任务可取消；running 任务经 abort 通知', async () => {
  const gate = deferred()
  let counter = 0
  let abortSeen = false
  const runner = new TaskRunner<Snap>({
    maxConcurrent: 1,
    nextId: () => `t${++counter}`,
  })
  const first = runner.submit({ label: 'a' }, (signal) => {
    signal.addEventListener('abort', () => {
      abortSeen = true
    })
    return gate.promise
  })
  runner.submit({ label: 'b' }, () => gate.promise)
  // 等待 pump 链把 first 拉起（microtask 链深度不定，让出数轮宏任务）。
  await new Promise((r) => setTimeout(r, 5))
  const second = runner.list().find((record) => record.snapshot.label === 'b')
  assert.ok(second, '第二个任务应在列表中')
  assert.equal(first.state, 'running', '并发 1 时首任务运行中')
  assert.equal(second.state, 'queued')
  assert.ok(runner.cancel(second.id), 'queued 任务应可取消')
  assert.equal(second.state, 'cancelled')
  assert.ok(runner.cancel(first.id), 'running 任务取消应受理')
  gate.resolve()
  await new Promise((r) => setTimeout(r, 10))
  assert.ok(abortSeen, 'running 任务取消应收到 abort 信号')
  assert.equal(first.state, 'failed', '被 abort 的任务以 failed 结算')
})

test('任务体异常隔离：单任务失败不影响其余任务', async () => {
  const gate = deferred()
  let counter = 0
  const runner = new TaskRunner<Snap>({
    maxConcurrent: 1,
    nextId: () => `t${++counter}`,
  })
  const bad = runner.submit({ label: 'bad' }, async () => {
    throw new Error('boom')
  })
  const good = runner.submit({ label: 'good' }, () => gate.promise.then(() => 'ok'))
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(bad.state, 'failed')
  assert.equal(bad.error, 'boom')
  gate.resolve()
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(good.state, 'succeeded')
  assert.equal(good.result, 'ok')
})

test('并发上限 0 = 不限制', async () => {
  const gates = [deferred(), deferred(), deferred()]
  let launched = 0
  let counter = 0
  const runner = new TaskRunner<Snap>({
    maxConcurrent: 0,
    nextId: () => `t${++counter}`,
  })
  for (const gate of gates) {
    runner.submit({ label: 'x' }, () => {
      launched += 1
      return gate.promise
    })
  }
  await Promise.resolve()
  assert.equal(launched, 3, '不限制时全部任务立即启动')
  for (const gate of gates) gate.resolve()
})
