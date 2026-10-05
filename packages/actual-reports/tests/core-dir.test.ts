/**
 * core 包根定位的行为测试：官方 `@actual-app/core` 的 exports 不暴露 `./package.json`，
 * 因此只能借**已导出的子路径**落到包内文件、再向上认领包根；认不出时显式报错并给 `--core-dir` 指引。
 * @module @dsh-plus/actual-reports/tests/core-dir
 */

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { resolveCoreDir } from '../src/api.ts'
import type { ReportsConfig } from '../src/env.ts'
import { createNodeIo } from '../src/node-io.ts'

/** 基准配置（只有定位相关字段有意义）。 */
function configOf(overrides: Partial<ReportsConfig> = {}): ReportsConfig {
  return {
    serverUrl: 'http://127.0.0.1:5006',
    password: '',
    sessionToken: '',
    encryptionPassword: '',
    syncId: 'sync-1',
    dataDir: '/tmp/data',
    cacheTtlSec: 60,
    lockTimeoutSec: 10,
    noLock: false,
    cliEntry: '',
    apiPath: '',
    coreDir: '',
    ...overrides,
  }
}

interface Fixture {
  root: string
  coreDir: string
  cliEntry: string
}

/**
 * 造一个真实可解析的包布局：`<root>/cli.js` 是官方 CLI 入口，
 * `<root>/node_modules/@actual-app/core` 是它的依赖。
 *
 * @param exportsMap core 的 exports 映射（决定哪些子路径可解析）。
 * @param withModel 是否放上 `src/types/models/dashboard.ts`（模型文件）。
 */
async function makeFixture(exportsMap: Record<string, string>, withModel = true): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'core-dir-'))
  const coreDir = join(root, 'node_modules', '@actual-app', 'core')
  await mkdir(join(coreDir, 'src', 'types', 'models'), { recursive: true })
  await writeFile(
    join(coreDir, 'package.json'),
    JSON.stringify({ name: '@actual-app/core', type: 'module', exports: exportsMap }),
  )
  await writeFile(join(coreDir, 'src', 'types', 'models', 'index.ts'), 'export {}\n')
  if (withModel) {
    await writeFile(
      join(coreDir, 'src', 'types', 'models', 'dashboard.ts'),
      'export type Widget = { type: string }\n',
    )
  }
  const cliEntry = join(root, 'cli.js')
  await writeFile(cliEntry, '// 官方 CLI 入口替身\n')
  return { root, coreDir, cliEntry }
}

test('core 定位：exports 不含 ./package.json 时，借已导出子路径向上认领包根', async () => {
  const fixture = await makeFixture({
    './types/models': './src/types/models/index.ts',
  })
  try {
    const dir = await resolveCoreDir(configOf({ cliEntry: fixture.cliEntry }), createNodeIo())
    assert.equal(dir, fixture.coreDir)
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('core 定位：exports 里没有用于定位的子路径时，报错并指向 --core-dir', async () => {
  const fixture = await makeFixture({ './client/store': './src/client/store.ts' })
  try {
    await assert.rejects(
      () => resolveCoreDir(configOf({ cliEntry: fixture.cliEntry }), createNodeIo()),
      (error: Error) => {
        assert.match(error.message, /无法从官方 CLI/)
        assert.match(error.message, /--core-dir/)
        return true
      },
    )
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('core 定位：包根认出来了但缺少模型文件时，报错指出缺哪个文件', async () => {
  const fixture = await makeFixture({ './types/models': './src/types/models/index.ts' }, false)
  try {
    await assert.rejects(
      () => resolveCoreDir(configOf({ cliEntry: fixture.cliEntry }), createNodeIo()),
      (error: Error) => {
        assert.match(error.message, /没有 src\/types\/models\/dashboard\.ts/)
        assert.match(error.message, /--core-dir/)
        return true
      },
    )
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('core 定位：--core-dir / DSH_ACTUAL_CORE_DIR 优先，不碰官方 CLI', async () => {
  const fixture = await makeFixture({
    './types/models': './src/types/models/index.ts',
  })
  try {
    // cliEntry 指向不存在的路径：走 --core-dir 时不该被读
    const dir = await resolveCoreDir(
      configOf({ cliEntry: join(fixture.root, 'missing.js'), coreDir: fixture.coreDir }),
      createNodeIo(),
    )
    assert.equal(dir, fixture.coreDir)
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})
