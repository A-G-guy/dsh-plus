import assert from 'node:assert/strict'
import { test } from 'node:test'

import { runPreflight, type RunOutput } from '../src/preflight.ts'

type Stub = (cmd: string, args: string[]) => Promise<RunOutput>

const ok = (stdout = ''): RunOutput => ({ code: 0, stdout })

function stub(map: Record<string, RunOutput | Error>): Stub {
  return (cmd, args) => {
    const key = `${cmd} ${args.join(' ')}`
    const value = map[key]
    if (value === undefined) return Promise.resolve({ code: 1, stdout: '' })
    if (value instanceof Error) return Promise.reject(value)
    return Promise.resolve(value)
  }
}

test('given main-process pid with active unit and passwordless sudo, when preflight, then ok', async () => {
  const result = await runPreflight('dsh-web', 12345, stub({
    'systemctl show -p MainPID --value dsh-web': ok('12345\n'),
    'systemctl is-active dsh-web': ok('active\n'),
    'sudo -n true': ok(),
  }))
  assert.deepEqual(result, { ok: true, reasons: [] })
})

test('given non-main-process pid, when preflight, then refused with manual path hint', async () => {
  const result = await runPreflight('dsh-web', 99999, stub({
    'systemctl show -p MainPID --value dsh-web': ok('12345\n'),
    'systemctl is-active dsh-web': ok('active\n'),
    'sudo -n true': ok(),
  }))
  assert.equal(result.ok, false)
  assert.equal(result.reasons.length, 1)
  assert.match(result.reasons[0] ?? '', /MainPID 不匹配/)
})

test('given inactive unit, when preflight, then refused with unit state', async () => {
  const result = await runPreflight('dsh-web', 12345, stub({
    'systemctl show -p MainPID --value dsh-web': ok('12345\n'),
    'systemctl is-active dsh-web': { code: 3, stdout: 'inactive\n' },
    'sudo -n true': ok(),
  }))
  assert.equal(result.ok, false)
  assert.match(result.reasons.join('\n'), /非 active/)
})

test('given sudo requiring password, when preflight, then refused', async () => {
  const result = await runPreflight('dsh-web', 12345, stub({
    'systemctl show -p MainPID --value dsh-web': ok('12345\n'),
    'systemctl is-active dsh-web': ok('active\n'),
    'sudo -n true': { code: 1, stdout: '' },
  }))
  assert.equal(result.ok, false)
  assert.match(result.reasons.join('\n'), /sudo 免密/)
})

test('given systemctl missing entirely, when preflight, then error collected not thrown', async () => {
  const result = await runPreflight('dsh-web', 12345, stub({
    'systemctl show -p MainPID --value dsh-web': new Error('无法执行 systemctl: spawn systemctl ENOENT'),
    'sudo -n true': ok(),
  }))
  assert.equal(result.ok, false)
  assert.match(result.reasons.join('\n'), /ENOENT/)
})

test('given multiple failures, when preflight, then all reasons reported together', async () => {
  const result = await runPreflight('dsh-web', 99999, stub({
    'systemctl show -p MainPID --value dsh-web': ok('12345\n'),
    'systemctl is-active dsh-web': { code: 3, stdout: 'inactive\n' },
    'sudo -n true': { code: 1, stdout: '' },
  }))
  assert.equal(result.ok, false)
  assert.equal(result.reasons.length, 3)
})
