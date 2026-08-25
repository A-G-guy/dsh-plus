/**
 * Registry 行为测试：FakePty + FakeSink 驱动（无真实 PTY/网络）。
 * 覆盖：创建/列表/改名/杀、maxSessions 上限、空闲清扫只杀零挂载零活动
 * 会话、退出事件清理、多挂载扇出、resize 钳制。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { Context } from '@deepseek-ai/cordis'
import type { WebTerminalConfig } from '../src/config.ts'
import type { PtyFactory, PtyLike, PtySpawnSpec } from '../src/pty.ts'
import { sanitizeName, TerminalRegistryError, WebTerminalService } from '../src/registry.ts'
import type { SessionSink } from '../src/scrollback.ts'

class FakePty implements PtyLike {
  pid: number
  written: string[] = []
  resized: Array<{ cols: number; rows: number }> = []
  killed: string[] = []
  exited = false
  private dataListeners: Array<(data: string) => void> = []
  private exitListeners: Array<(event: { exitCode: number; signal?: number }) => void> = []

  static nextPid = 1000
  constructor(pid: number) {
    this.pid = pid
  }

  write(data: string): void {
    this.written.push(data)
  }
  resize(cols: number, rows: number): void {
    this.resized.push({ cols, rows })
  }
  kill(signal?: string): void {
    this.killed.push(signal ?? 'SIGTERM')
  }
  onData(listener: (data: string) => void): () => void {
    this.dataListeners.push(listener)
    return () => {}
  }
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): () => void {
    this.exitListeners.push(listener)
    return () => {}
  }

  emitData(data: string): void {
    for (const listener of [...this.dataListeners]) listener(data)
  }
  emitExit(exitCode = 0, signal?: number): void {
    if (this.exited) return
    this.exited = true
    for (const listener of [...this.exitListeners]) listener({ exitCode, signal })
  }
}

interface Harness {
  service: WebTerminalService
  ptys: FakePty[]
  ctx: Context
}

function makeHarness(overrides: Partial<WebTerminalConfig> = {}): Harness {
  const ptys: FakePty[] = []
  const factory: PtyFactory = (spec: PtySpawnSpec) => {
    assert.ok(spec.argv.length > 0, 'shell argv must be non-empty')
    const pty = new FakePty(FakePty.nextPid++)
    ptys.push(pty)
    return pty
  }
  const ctx = new Context()
  const config = {
    enabled: true,
    shellPath: '/bin/bash',
    shellArgs: [],
    cwd: '',
    env: {},
    initialCols: 80,
    initialRows: 24,
    scrollbackLines: 100,
    scrollbackMaxKb: 64,
    maxSessions: 3,
    idleTimeoutMs: 1000,
    killGraceMs: 50,
    ...overrides,
  } as WebTerminalConfig
  const service = new WebTerminalService(ctx, config, factory)
  return { service, ptys, ctx }
}

function sink(output: string[] = [], exits: string[] = []): SessionSink {
  return {
    output: (data) => output.push(data),
    exit: (code, signal) => exits.push(signal ?? String(code)),
  }
}

test('given the service, when creating sessions, then list shows them and maxSessions rejects the excess', () => {
  const { service } = makeHarness()
  const a = service.create({})
  const b = service.create({})
  assert.equal(service.list().length, 2)
  assert.deepEqual(
    service
      .list()
      .map((dto) => dto.id)
      .sort(),
    [a.id, b.id].sort(),
  )
  service.create({})
  assert.throws(
    () => service.create({}),
    (error: unknown) => {
      assert.ok(error instanceof TerminalRegistryError)
      assert.equal(error.code, 'too-many-sessions')
      return true
    },
  )
})

test('given a session, when renaming, then the dto reflects it; invalid names are rejected', () => {
  const { service } = makeHarness()
  const session = service.create({ name: 'build' })
  assert.equal(service.rename(session.id, 'deploy').name, 'deploy')
  assert.throws(
    () => service.rename(session.id, '   '),
    (error: unknown) => {
      assert.ok(error instanceof TerminalRegistryError)
      assert.equal(error.code, 'name-invalid')
      return true
    },
  )
})

test('given pty output, when multiple sinks attach, then each receives the delta and replay carries scrollback', () => {
  const { service, ptys } = makeHarness()
  const session = service.create({})
  const outA: string[] = []
  const outB: string[] = []
  const a = service.attach(session.id, sink(outA))
  assert.equal(a.replay, '', 'replay at attach-time precedes later output')
  ptys[0]?.emitData('hello\n')
  const b = service.attach(session.id, sink(outB))
  assert.equal(b.replay, 'hello\n', 'late attacher receives scrollback replay')
  ptys[0]?.emitData('world\n')
  assert.deepEqual(outA, ['hello\n', 'world\n'])
  assert.deepEqual(outB, ['world\n'])
  assert.equal(service.list().find((dto) => dto.id === session.id)?.attachedCount, 2)
  a.detach()
  b.detach()
})

test('given a session whose shell exits, when the exit event fires, then it is removed from the registry and sinks see exit', () => {
  const { service, ptys } = makeHarness()
  const session = service.create({})
  const exits: string[] = []
  service.attach(session.id, sink([], exits))
  ptys[0]?.emitExit(0)
  assert.deepEqual(exits, ['0'])
  assert.equal(service.list().length, 0)
  assert.throws(() => service.get(session.id), /unknown session/)
})

test('given idle timeout, when a session has no attachment and no activity, then sweep kills it; active or attached sessions survive', async () => {
  const { service, ptys } = makeHarness({ idleTimeoutMs: 60 })
  const idle = service.create({})
  const busy = service.create({})
  const attached = service.create({})
  service.attach(attached.id, sink())

  await new Promise((resolve) => setTimeout(resolve, 80))

  // busy 会话此刻仍在输出 → 非空闲；attached 会话即使静默也保留。
  ptys[1]?.emitData('building...\n')
  const killed = await service.sweep(Date.now())
  assert.equal(killed, 1, 'only the idle unattached session is swept')
  assert.equal(service.list().length, 2)
  assert.equal(service.get(busy.id).running(), true)
  assert.equal(service.get(attached.id).running(), true)
  void idle
})

test('given idleTimeoutMs = 0, when sweeping, then idle cleanup is disabled', async () => {
  const { service } = makeHarness({ idleTimeoutMs: 0 })
  service.create({})
  const killed = await service.sweep(Date.now() + 1_000_000)
  assert.equal(killed, 0)
})

test('given resize requests, when cols/rows are out of range, then they are clamped to [2, 500]', () => {
  const { service, ptys } = makeHarness()
  const session = service.create({})
  service.get(session.id).resize(0, 999)
  assert.deepEqual(ptys[0]?.resized, [{ cols: 2, rows: 500 }])
})

test('given kill, when the session resists TERM, then KILL escalates and the session is removed', async () => {
  const { service, ptys } = makeHarness({ killGraceMs: 30 })
  const session = service.create({})
  const pty = ptys[0]
  // TERM 后不退，等 KILL 时才退。
  setTimeout(() => pty?.emitExit(137, 9), 60)
  const killed = await service.kill(session.id)
  assert.equal(killed, true)
  assert.deepEqual(pty?.killed, ['SIGTERM', 'SIGKILL'])
  assert.equal(service.list().length, 0)
})

test('given name sanitation rules, when names contain control chars or whitespace, then they are rejected or trimmed', () => {
  assert.equal(sanitizeName('  ok  '), 'ok')
  assert.equal(sanitizeName('   '), undefined)
  assert.equal(sanitizeName(undefined), undefined)
  assert.equal(sanitizeName('bad\x07name'), undefined)
  assert.equal(sanitizeName('x'.repeat(100))?.length, 64)
})

test('given disposal, when the service is torn down, then all sessions are closed', async () => {
  const harness = makeHarness()
  harness.service.create({})
  harness.service.create({})
  await harness.ctx.fiber.dispose()
  assert.equal(harness.service.list().length, 0)
  for (const pty of harness.ptys) assert.ok(pty.killed.length > 0)
})
