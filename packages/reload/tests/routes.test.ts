import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { test } from 'node:test'

import { Config } from '../src/config.ts'
import { createReloadHandler } from '../src/routes.ts'
import { ReloadScheduler } from '../src/scheduler.ts'

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function fakeReq(method: string, path: string, body?: unknown): IncomingMessage {
  const emitter = new EventEmitter()
  const req = emitter as unknown as IncomingMessage
  req.method = method
  req.url = `/dsh-plus/reload${path}`
  req.headers = body === undefined ? {} : { 'content-type': 'application/json' }
  queueMicrotask(() => {
    if (body !== undefined) emitter.emit('data', Buffer.from(JSON.stringify(body)))
    emitter.emit('end')
  })
  return req
}

interface Captured {
  status: number
  body: Record<string, unknown>
}

function fakeRes(): { res: ServerResponse; done: Promise<Captured> } {
  let status = 0
  let resolveDone!: (captured: Captured) => void
  const done = new Promise<Captured>((resolve) => {
    resolveDone = resolve
  })
  const res = {
    writeHead(code: number) {
      status = code
    },
    end(payload?: string) {
      resolveDone({
        status,
        body: payload ? (JSON.parse(payload) as Record<string, unknown>) : {},
      })
    },
    headersSent: false,
  } as unknown as ServerResponse
  return { res, done }
}

function makeHandler(overrides: { runningAgents?: number; pidMismatch?: boolean } = {}) {
  const spawned: string[] = []
  const scheduler = new ReloadScheduler({
    unitName: 'dsh-web',
    confirmTokenTtlMs: 60000,
    serverGraceMs: 10,
    spawnRestart: (unit) => spawned.push(unit),
  })
  const handler = createReloadHandler({
    scheduler,
    config: Config({}),
    pid: overrides.pidMismatch ? process.pid + 1 : process.pid,
    runner: (cmd, args) =>
      Promise.resolve(
        args[0] === 'show'
          ? { code: 0, stdout: `${process.pid}\n` }
          : cmd === 'systemctl'
            ? { code: 0, stdout: 'active\n' }
            : { code: 0, stdout: '' },
      ),
    runningAgents: () => overrides.runningAgents ?? 0,
  })
  return { handler, scheduler, spawned }
}

async function call(
  handler: ReturnType<typeof createReloadHandler>,
  method: string,
  path: string,
  body?: unknown,
): Promise<Captured> {
  const { res, done } = fakeRes()
  await handler(fakeReq(method, path, body), res)
  return done
}

test('given any state, when GET health, then 200 with bootId', async () => {
  const { handler, scheduler } = makeHandler()
  const res = await call(handler, 'GET', '/health')
  assert.equal(res.status, 200)
  assert.equal(res.body.ok, true)
  assert.equal(res.body.bootId, scheduler.bootId)
})

test('given healthy preflight, when POST prepare, then token and metadata returned', async () => {
  const { handler } = makeHandler({ runningAgents: 2 })
  const res = await call(handler, 'POST', '/prepare')
  assert.equal(res.status, 200)
  assert.equal(typeof res.body.token, 'string')
  assert.equal(res.body.runningAgents, 2)
  assert.equal(res.body.countdownSeconds, 5)
})

test('given non-main-process pid, when POST prepare, then 409 with preflight reasons', async () => {
  const { handler } = makeHandler({ pidMismatch: true })
  const res = await call(handler, 'POST', '/prepare')
  assert.equal(res.status, 409)
  const preflight = res.body.preflight as { ok: boolean; reasons: string[] }
  assert.equal(preflight.ok, false)
  assert.match(preflight.reasons.join('\n'), /MainPID 不匹配/)
})

test('given prepared token, when confirm, then 200 and restart spawns after grace', async () => {
  const { handler, spawned } = makeHandler()
  const prepare = await call(handler, 'POST', '/prepare')
  const res = await call(handler, 'POST', '/confirm', {
    token: prepare.body.token,
  })
  assert.equal(res.status, 200)
  assert.equal(typeof res.body.etaMs, 'number')
  await sleep(30)
  assert.deepEqual(spawned, ['dsh-web'])
})

test('given bad token, when confirm, then 403', async () => {
  const { handler } = makeHandler()
  const res = await call(handler, 'POST', '/confirm', { token: 'forged' })
  assert.equal(res.status, 403)
})

test('given running agents, when confirm without force, then 409 with count; with force then 200', async () => {
  const { handler, spawned } = makeHandler({ runningAgents: 1 })
  const prepare = await call(handler, 'POST', '/prepare')
  const blocked = await call(handler, 'POST', '/confirm', {
    token: prepare.body.token,
  })
  assert.equal(blocked.status, 409)
  assert.equal(blocked.body.runningAgents, 1)
  const forced = await call(handler, 'POST', '/confirm', {
    token: prepare.body.token,
    force: true,
  })
  assert.equal(forced.status, 200)
  await sleep(30)
  assert.equal(spawned.length, 1)
})

test('given malformed body, when confirm, then 400', async () => {
  const { handler } = makeHandler()
  const emitter = new EventEmitter()
  const req = emitter as unknown as IncomingMessage
  req.method = 'POST'
  req.url = '/dsh-plus/reload/confirm'
  req.headers = { 'content-type': 'application/json' }
  const { res, done } = fakeRes()
  const pending = handler(req, res)
  emitter.emit('data', Buffer.from('{broken'))
  emitter.emit('end')
  await pending
  assert.equal((await done).status, 400)
})

test('given scheduled restart, when cancel with token, then 200 and spawn never fires', async () => {
  const { handler, spawned } = makeHandler()
  const prepare = await call(handler, 'POST', '/prepare')
  await call(handler, 'POST', '/confirm', { token: prepare.body.token })
  const res = await call(handler, 'POST', '/cancel', {
    token: prepare.body.token,
  })
  assert.equal(res.status, 200)
  await sleep(30)
  assert.equal(spawned.length, 0)
})

test('given no flow, when cancel with unknown token, then 404', async () => {
  const { handler } = makeHandler()
  const res = await call(handler, 'POST', '/cancel', { token: 'forged' })
  assert.equal(res.status, 404)
})

test('given unknown endpoint or method, when called, then 404 or 405', async () => {
  const { handler } = makeHandler()
  assert.equal((await call(handler, 'GET', '/nope')).status, 404)
  assert.equal((await call(handler, 'DELETE', '/health')).status, 405)
  assert.equal((await call(handler, 'GET', '/confirm')).status, 405)
})
