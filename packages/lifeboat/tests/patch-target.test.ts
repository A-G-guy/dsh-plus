/**
 * 隔离目标 patch 文件解析单测：显式配置 > 当前 profile（profileContext）> 停用。
 * 桌面端回归：desktop profile 下绝不回落 profiles/web 硬编码路径。
 * @module @dsh-plus/lifeboat/tests/patch-target
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Context } from '@deepseek-ai/cordis'

import { resolvePatchFile } from '../src/index.ts'

/** 只提供 get 的最小 ctx 替身（resolvePatchFile 仅经 ctx.get 读 profileContext）。 */
function fakeCtx(profileContext: unknown): Context {
  return {
    get: (key: string) => (key === 'profileContext' ? profileContext : undefined),
  } as unknown as Context
}

const baseConfig = { enabled: true, patchFile: '', llmFallback: true, alertCooldownMs: 300000 }

test('given explicit patchFile config, when resolving, then it wins over profileContext', () => {
  const ctx = fakeCtx({ patchPath: '/home/u/.dsh/profiles/desktop/cordis.patch.yml' })
  assert.equal(
    resolvePatchFile(ctx, { ...baseConfig, patchFile: '/tmp/custom-patch.yml' }),
    '/tmp/custom-patch.yml',
  )
})

test('given no explicit config, when resolving under a dsh profile, then the current profile patch path is used', () => {
  const ctx = fakeCtx({
    name: 'desktop',
    patchPath: 'C:\\Users\\u\\.dsh\\profiles\\desktop\\cordis.patch.yml',
  })
  assert.equal(
    resolvePatchFile(ctx, baseConfig),
    'C:\\Users\\u\\.dsh\\profiles\\desktop\\cordis.patch.yml',
  )
})

test('given no profileContext (bare cordis tree), when resolving, then quarantine target is undefined instead of a guessed web path', () => {
  assert.equal(resolvePatchFile(fakeCtx(undefined), baseConfig), undefined)
  assert.equal(resolvePatchFile(fakeCtx(null), baseConfig), undefined)
})
