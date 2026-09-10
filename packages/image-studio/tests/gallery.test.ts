/**
 * 凭据引用派生与画廊存储：引用名规则、JSONL 增删、图片落盘原子性。
 * 存储落点 $DSH_HOME/dsh-plus/image-studio/gallery（测试用临时 DSH_HOME 隔离）。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { credentialRefNameOf, isValidPresetId } from '../src/credentials.ts'
import {
  deleteGalleryItem,
  itemOfImage,
  loadGallery,
  readImageBytes,
  saveGalleryItem,
} from '../src/gallery/store.ts'
import { extOfMime } from '../src/images/mime.ts'

const PNG_1PX = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52,
])

/** 每个用例独占进程级 DSH_HOME（store 模块在 import 期解析根路径，无法 per-case 切换）。 */
function _useTempHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'image-studio-test-'))
  process.env.DSH_HOME = home
  return home
}

test('凭据引用名派生：kebab → 大写下划线，带属主前缀', () => {
  assert.equal(credentialRefNameOf('packy'), 'IMAGE_STUDIO_PRESET_PACKY')
  assert.equal(credentialRefNameOf('my-provider-2'), 'IMAGE_STUDIO_PRESET_MY_PROVIDER_2')
  assert.throws(() => credentialRefNameOf('Bad_Id'), /非法提供商预设 id/)
  assert.throws(() => credentialRefNameOf(''), /非法提供商预设 id/)
  assert.ok(isValidPresetId('packy'))
  assert.ok(!isValidPresetId('Packy'))
})

test('画廊保存与读取：图片落盘 + 元数据 JSONL 追加', async () => {
  const home = mkdtempSync(join(tmpdir(), 'image-studio-test-'))
  process.env.DSH_HOME = home
  try {
    const saved = await saveGalleryItem({
      item: {
        providerPresetId: 'packy',
        protocol: 'openai-images',
        endpoint: 'generation',
        model: 'gpt-image-2',
        prompt: '一只橘猫',
        params: { size: '1024x1024', quality: 'high' },
        sourceIds: [],
        sourceUploads: [],
      },
      images: [{ data: PNG_1PX, mime: 'image/png', revisedPrompt: '改写' }],
    })
    assert.match(saved.id, /^[0-9a-f-]{36}$/)
    assert.equal(saved.imageIds.length, 1)
    assert.equal(saved.revisedPrompts[0], '改写')
    // 图片字节可读回。
    const firstImageId = saved.imageIds[0]
    assert.ok(firstImageId, '应记录一个图片 id')
    const bytes = await readImageBytes(firstImageId)
    assert.deepEqual([...bytes.data], [...PNG_1PX])
    assert.equal(bytes.ext, 'png')
    // 元数据含完整参数与提示词。
    const items = await loadGallery(() => {})
    assert.equal(items.length, 1)
    assert.equal(items[0]?.prompt, '一只橘猫')
    assert.equal(items[0]?.params.size, '1024x1024')
    assert.equal(items[0]?.providerPresetId, 'packy')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('画廊删除：图片文件与 JSONL 行一并移除', async () => {
  const home = mkdtempSync(join(tmpdir(), 'image-studio-test-'))
  process.env.DSH_HOME = home
  try {
    const first = await saveGalleryItem({
      item: {
        providerPresetId: null,
        protocol: 'openai-images',
        endpoint: 'generation',
        model: 'm',
        prompt: 'p1',
        params: {},
        sourceIds: [],
        sourceUploads: [],
      },
      images: [{ data: PNG_1PX, mime: 'image/png', revisedPrompt: null }],
    })
    const second = await saveGalleryItem({
      item: {
        providerPresetId: null,
        protocol: 'openai-images',
        endpoint: 'generation',
        model: 'm',
        prompt: 'p2',
        params: {},
        sourceIds: [],
        sourceUploads: [],
      },
      images: [{ data: PNG_1PX, mime: 'image/png', revisedPrompt: null }],
    })
    assert.ok(await deleteGalleryItem(first.id))
    const items = await loadGallery(() => {})
    assert.equal(items.length, 1)
    assert.equal(items[0]?.id, second.id)
    // 首条图片文件已删。
    const files = await readdir(join(home, 'dsh-plus', 'image-studio', 'gallery', 'images'))
    assert.equal(files.length, 1)
    assert.ok(!(await deleteGalleryItem(first.id)), '重复删除返回 false')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('imageId 反查条目（二次编辑定位）与未知图报错', async () => {
  const home = mkdtempSync(join(tmpdir(), 'image-studio-test-'))
  process.env.DSH_HOME = home
  try {
    const saved = await saveGalleryItem({
      item: {
        providerPresetId: null,
        protocol: 'openai-images',
        endpoint: 'edit',
        model: 'm',
        prompt: 'edit prompt',
        params: {},
        sourceIds: [],
        sourceUploads: [],
      },
      images: [{ data: PNG_1PX, mime: 'image/jpeg', revisedPrompt: null }],
    })
    const seededImageId = saved.imageIds[0]
    assert.ok(seededImageId)
    const found = await itemOfImage(seededImageId, () => {})
    assert.equal(found?.id, saved.id)
    await assert.rejects(
      () => readImageBytes('00000000-0000-4000-8000-000000000000'),
      /unknown-image/,
    )
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('MIME → 扩展名白名单', () => {
  assert.equal(extOfMime('image/png'), 'png')
  assert.equal(extOfMime('image/jpeg'), 'jpg')
  assert.equal(extOfMime('image/webp'), 'webp')
  assert.equal(extOfMime('application/json'), 'png', '未知类型兜底 png')
})
