import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'

import { isAbortError, runProcess, type SpawnFn } from '../src/runner.ts'

/** 最小 ChildProcess 假件：只实现 runner 触碰的面（stdout/stderr/on/kill）。 */
class FakeChild {
  readonly stdout = new EventEmitter()
  readonly stderr = new EventEmitter()
  readonly killedWith: string[] = []
  private readonly events = new EventEmitter()

  on(event: string, listener: (...args: unknown[]) => void): this {
    this.events.on(event, listener)
    return this
  }

  kill(signal?: number | string): boolean {
    this.killedWith.push(String(signal))
    return true
  }

  close(code: number | null): void {
    queueMicrotask(() => this.events.emit('close', code))
  }

  fail(err: Error): void {
    queueMicrotask(() => this.events.emit('error', err))
  }
}

interface RecordedCall {
  command: string
  args: string[]
  env: NodeJS.ProcessEnv
}

function fakeSpawn(setup: (child: FakeChild) => void) {
  const recorded: RecordedCall = { command: '', args: [], env: {} }
  const spawnFn = ((command: string, args: string[], options: { env: NodeJS.ProcessEnv }) => {
    recorded.command = command
    recorded.args = args
    recorded.env = options.env
    const child = new FakeChild()
    // 异步驱动：runner 在 spawnFn 返回后才挂监听，同步 emit 会丢数据。
    queueMicrotask(() => setup(child))
    return child
  }) as unknown as SpawnFn
  return { spawnFn, recorded }
}

const base = { command: 'python3', args: ['s.py', 'search'], env: {}, timeoutMs: 30_000 }

test('given clean exit, when run, then resolves stdout and forwards env to spawn', async () => {
  const { spawnFn, recorded } = fakeSpawn((child) => {
    child.stdout.emit('data', '{"ok":')
    child.stdout.emit('data', 'true}')
    child.close(0)
  })
  const out = await runProcess({ ...base, env: { MARKER: '1' }, spawnFn })
  assert.equal(out, '{"ok":true}')
  assert.equal(recorded.command, 'python3')
  assert.deepEqual(recorded.args, ['s.py', 'search'])
  assert.equal(recorded.env.MARKER, '1')
})

test('given non-zero exit, when run, then rejects with code and stderr tail', async () => {
  const { spawnFn } = fakeSpawn((child) => {
    child.stderr.emit('data', 'Traceback: quota exceeded')
    child.close(1)
  })
  await assert.rejects(
    runProcess({ ...base, spawnFn }),
    /exited with code 1: Traceback: quota exceeded/,
  )
})

test('given already-aborted signal, when run, then rejects AbortError without spawning', async () => {
  const { spawnFn, recorded } = fakeSpawn(() => {})
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    runProcess({ ...base, signal: controller.signal, spawnFn }),
    (err: unknown) => isAbortError(err),
  )
  assert.equal(recorded.command, '')
})

test('given abort mid-run, when fired, then SIGTERM and single AbortError settle', async () => {
  const controller = new AbortController()
  const { spawnFn } = fakeSpawn((child) => {
    queueMicrotask(() => controller.abort())
    child.close(0)
  })
  await assert.rejects(
    runProcess({ ...base, signal: controller.signal, spawnFn }),
    (err: unknown) => isAbortError(err),
  )
})

test('given silent child, when timeout hits, then SIGTERM and timeout error', async () => {
  const { spawnFn } = fakeSpawn(() => {})
  await assert.rejects(runProcess({ ...base, timeoutMs: 50, spawnFn }), /timed out after 50ms/)
})

test('given spawn error event, when run, then rejects with start failure message', async () => {
  const { spawnFn } = fakeSpawn((child) => child.fail(new Error('ENOENT python3')))
  await assert.rejects(runProcess({ ...base, spawnFn }), /failed to start python3: ENOENT/)
})
