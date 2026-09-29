/**
 * 桌面端运行时探测单测：官方判据（'dshDesktop' in globalThis）的注入替身验证。
 * @module @dsh-plus/reload/tests/runtime
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isDesktopRuntime } from '../src/client/runtime.ts'

test('given a scope carrying the dshDesktop bridge, when probing, then desktop runtime is detected', () => {
  const scope = { dshDesktop: {} } as unknown as typeof globalThis
  assert.equal(isDesktopRuntime(scope), true)
})

test('given a plain browser scope without the bridge, when probing, then not desktop', () => {
  const scope = {} as unknown as typeof globalThis
  assert.equal(isDesktopRuntime(scope), false)
})
