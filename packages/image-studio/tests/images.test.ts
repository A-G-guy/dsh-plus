/**
 * 图片基础工具：魔数嗅探（上传边界不信任声明类型）、扩展名/MIME 互转、
 * 标识形态白名单（uuid，兼作路径穿越防线）。
 * 验收条件：伪装的非图片字节被拒绝；四类白名单格式均能正确识别。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isImageId } from '../src/images/id.ts'
import { detectImageMime, extOfMime, mimeOfExt } from '../src/images/mime.ts'

/** 各格式的最小特征头（只需魔数可判定）。 */
const HEADS: Record<string, Uint8Array> = {
  png: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]),
  jpeg: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]),
  gif: Uint8Array.from([...'GIF89a'].map((c) => c.charCodeAt(0))),
  webp: Uint8Array.from([
    ...'RIFF'.split('').map((c) => c.charCodeAt(0)),
    0x24,
    0,
    0,
    0,
    ...'WEBP'.split('').map((c) => c.charCodeAt(0)),
  ]),
}

test('魔数嗅探识别白名单位图格式', () => {
  assert.equal(detectImageMime(HEADS.png as Uint8Array), 'image/png')
  assert.equal(detectImageMime(HEADS.jpeg as Uint8Array), 'image/jpeg')
  assert.equal(detectImageMime(HEADS.gif as Uint8Array), 'image/gif')
  assert.equal(detectImageMime(HEADS.webp as Uint8Array), 'image/webp')
})

test('伪装文件被拒绝（改名不改字节骗不过嗅探）', () => {
  const text = new TextEncoder().encode('<?php echo 1; ?>')
  assert.equal(detectImageMime(text), null)
  // RIFF 容器但不是 WEBP（如 wav）：仅前缀相同不足以判定。
  const wav = Uint8Array.from([
    ...'RIFF'.split('').map((c) => c.charCodeAt(0)),
    0x24,
    0,
    0,
    0,
    ...'WAVE'.split('').map((c) => c.charCodeAt(0)),
  ])
  assert.equal(detectImageMime(wav), null)
  assert.equal(detectImageMime(new Uint8Array(0)), null)
})

test('扩展名与 MIME 互逆，未知类型回落 png', () => {
  for (const mime of ['image/png', 'image/jpeg', 'image/webp', 'image/gif']) {
    assert.equal(mimeOfExt(extOfMime(mime)), mime)
  }
  assert.equal(extOfMime('image/tiff'), 'png', '白名单外按 png 落盘')
  assert.equal(mimeOfExt('jpeg'), 'image/jpeg', 'jpg/jpeg 两种写法等价')
})

test('图片标识白名单：仅接受 uuid 形态', () => {
  assert.ok(isImageId('3f2504e0-4f89-11d3-9a0c-0305e82c3301'))
  assert.ok(!isImageId('../../etc/passwd'))
  assert.ok(!isImageId('3F2504E0-4F89-11D3-9A0C-0305E82C3301'), '大写不合法')
  assert.ok(!isImageId('short'))
  assert.ok(!isImageId(undefined))
})
