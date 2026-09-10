/**
 * 尺寸参数规则：auto 与「宽x高」形态、倍数/长边/比例/像素区间约束。
 * 验收条件：官方 image 系列放行的尺寸通过；越界与畸形取值给出可读原因；
 * 预设尺寸表本身全部合法（快捷项不会产出被自己拒绝的值）。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { checkImageSize, IMAGE_SIZE_RULE, SIZE_PRESETS } from '../src/params/size.ts'

function reasonOf(value: string): string {
  const checked = checkImageSize(value)
  assert.equal(checked.ok, false, `${value} 应被拒绝`)
  return checked.ok ? '' : checked.message
}

test('auto 与推荐尺寸通过（image 2.5 文档三档 + auto）', () => {
  for (const value of ['auto', '1024x1024', '1536x1024', '1024x1536']) {
    assert.deepEqual(checkImageSize(value), { ok: true }, `${value} 应通过`)
  }
})

test('自定义尺寸按倍数/长边/比例/像素区间放行', () => {
  // 16:9 / 9:16 / 4K 边界：长边恰为 3840、像素恰为上限，应通过。
  for (const value of ['2048x1152', '1152x2048', '3840x2160', '2160x3840', '2048x2048']) {
    assert.deepEqual(checkImageSize(value), { ok: true }, `${value} 应通过`)
  }
  assert.equal(IMAGE_SIZE_RULE.maxEdge, 3840)
  assert.equal(IMAGE_SIZE_RULE.maxPixels, 3840 * 2160)
})

test('非 16 倍数的常见分辨率同样被拒（官方仅放行 16 倍数）', () => {
  assert.match(reasonOf('1920x1080'), /16 的倍数/)
  assert.match(reasonOf('1080x1920'), /16 的倍数/)
})

test('越界取值被拒绝且原因可读', () => {
  assert.match(reasonOf('1000x1000'), /16 的倍数/)
  assert.match(reasonOf('1024x1025'), /16 的倍数/)
  assert.match(reasonOf('4096x2160'), /长边/)
  assert.match(reasonOf('3840x1024'), /宽高比/, '3.75:1 超过 3:1')
  assert.match(reasonOf('256x256'), /总像素不能少于/)
  assert.match(reasonOf('3840x3840'), /宽高比|总像素/, '正方形边长 3840 总像素超上限')
})

test('畸形取值与空值被拒绝', () => {
  assert.match(reasonOf(''), /宽x高/)
  assert.match(reasonOf('1024'), /宽x高/)
  assert.match(reasonOf('1024*1024'), /宽x高/)
  assert.match(reasonOf('axb'), /宽x高/)
})

test('大小写与分隔符写法宽容', () => {
  assert.deepEqual(checkImageSize(' 1024X1024 '), { ok: true })
  assert.deepEqual(checkImageSize('1024×1024'), { ok: true })
})

test('预设尺寸表每项都能通过自身规则', () => {
  assert.ok(SIZE_PRESETS.length >= 4, '应提供若干快捷尺寸')
  assert.ok(SIZE_PRESETS.some((preset) => preset.value === 'auto'))
  for (const preset of SIZE_PRESETS) {
    assert.deepEqual(checkImageSize(preset.value), { ok: true }, `${preset.value} 应合法`)
  }
})
