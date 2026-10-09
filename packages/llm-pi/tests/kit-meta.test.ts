/**
 * 运行期套件元信息：生效版本读取（真实安装副本 + 假树夹具）、
 * 已验证区间提示只提示不阻断。
 * @module @dsh-plus/llm-pi/tests/kit-meta
 */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  collectTreeVersions,
  collectVendoredVersions,
  installedPackageDir,
  packageVersionOf,
  piAiVersionNotice,
  readPackageVersion,
  VERIFIED_PI_AI_RANGE,
} from '../src/kit-meta.ts'

/** 造一棵最小 dsh 安装树：只写版本清单。 */
async function withFakeTree(
  manifests: { dsh?: string; adapter?: string; piAi?: string },
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-plus-kitmeta-'))
  try {
    await mkdir(join(root, 'node_modules', '@deepseek-ai', 'dsh-llm-pi-ai'), { recursive: true })
    await mkdir(join(root, 'node_modules', '@earendil-works', 'pi-ai'), { recursive: true })
    if (manifests.dsh !== undefined) {
      await writeFile(
        join(root, 'package.json'),
        JSON.stringify({ name: '@deepseek-ai/dsh', version: manifests.dsh }),
      )
    }
    if (manifests.adapter !== undefined) {
      await writeFile(
        join(root, 'node_modules', '@deepseek-ai', 'dsh-llm-pi-ai', 'package.json'),
        JSON.stringify({ name: '@deepseek-ai/dsh-llm-pi-ai', version: manifests.adapter }),
      )
    }
    if (manifests.piAi !== undefined) {
      await writeFile(
        join(root, 'node_modules', '@earendil-works', 'pi-ai', 'package.json'),
        JSON.stringify({ name: '@earendil-works/pi-ai', version: manifests.piAi }),
      )
    }
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('readPackageVersion：读不到/坏 JSON/无 version 一律 undefined（不影响启动）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-plus-kitmeta-read-'))
  try {
    assert.equal(readPackageVersion(join(dir, 'missing.json')), undefined)
    const broken = join(dir, 'broken.json')
    await writeFile(broken, '{ not json')
    assert.equal(readPackageVersion(broken), undefined)
    const noVersion = join(dir, 'noversion.json')
    await writeFile(noVersion, JSON.stringify({ name: 'x' }))
    assert.equal(readPackageVersion(noVersion), undefined)
    const ok = join(dir, 'ok.json')
    await writeFile(ok, JSON.stringify({ version: '1.2.3' }))
    assert.equal(readPackageVersion(ok), '1.2.3')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('collectTreeVersions：读树内 pi-ai / 官方适配器 / dsh 本体三个版本', async () => {
  await withFakeTree(
    { dsh: '0.2.1-alpha.1', adapter: '0.2.1-alpha.1', piAi: '0.87.1' },
    async (root) => {
      assert.deepEqual(collectTreeVersions(root), {
        piAi: '0.87.1',
        piAiAdapter: '0.2.1-alpha.1',
        dsh: '0.2.1-alpha.1',
      })
    },
  )
})

test('collectTreeVersions：根不是 dsh 本体时不给 dsh 版本；缺清单的版本键省略', async () => {
  await withFakeTree({ adapter: '0.2.1-alpha.1' }, async (root) => {
    assert.deepEqual(collectTreeVersions(root), { piAiAdapter: '0.2.1-alpha.1' })
  })
})

test('collectVendoredVersions / installedPackageDir：指向插件自己装的那两份副本', () => {
  const versions = collectVendoredVersions()
  assert.equal(typeof versions.piAi, 'string')
  assert.equal(typeof versions.piAiAdapter, 'string')
  // pi-ai 包目录必须真的存在（package.json 不可经 exports 解析，只能读文件）
  const dir = installedPackageDir('@earendil-works/pi-ai')
  assert.ok(dir)
  assert.equal(packageVersionOf(dir as string), versions.piAi)
  assert.equal(installedPackageDir('@deepseek-ai/definitely-not-installed'), undefined)
})

test('piAiVersionNotice：区间内不提示，区间外/过低提示，未知版本不提示', () => {
  assert.equal(piAiVersionNotice(undefined), undefined)
  assert.equal(piAiVersionNotice('not-a-version'), undefined)
  assert.equal(piAiVersionNotice('1.0.2'), undefined)
  assert.equal(piAiVersionNotice('1.1.0'), undefined)
  assert.equal(piAiVersionNotice('1.1.0-alpha.1'), undefined)
  assert.match(piAiVersionNotice('2.0.0') ?? '', /超出本插件验证过的区间/)
  assert.match(piAiVersionNotice('2.4.1') ?? '', /超出本插件验证过的区间/)
  assert.match(piAiVersionNotice('0.87.1') ?? '', /低于本插件验证过的下限/)
  assert.match(piAiVersionNotice('1.0.1') ?? '', /低于本插件验证过的下限/)
  assert.match(VERIFIED_PI_AI_RANGE, /1\.0\.2/)
})

test('生效版本就地断言：当前装的两份副本都在已验证区间内（超出时本测试会提示）', () => {
  const versions = collectVendoredVersions()
  assert.equal(
    piAiVersionNotice(versions.piAi),
    undefined,
    `vendored pi-ai ${versions.piAi} 超出验证区间：请更新 VERIFIED_PI_AI_RANGE 或核对适配`,
  )
})
