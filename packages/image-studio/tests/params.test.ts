/**
 * 参数目录与归一化裁剪：开关语义、端点适用性、约束校验。
 * 验收条件：enabled=false 不进请求；禁用/未知/越界参数边界拒绝；
 * edit 专属参数不可用于 generation。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { PARAM_CATALOG, paramEntryOf, paramKeysFor } from '../src/params/catalog.ts'
import {
  normalizeParamSpecs,
  ParamValidationError,
  validateParamSpecs,
  validateParamValue,
} from '../src/params/spec.ts'

test('目录覆盖官方 Images API 全参数面', () => {
  const keys = PARAM_CATALOG.map((entry) => entry.key)
  for (const required of [
    'n',
    'size',
    'quality',
    'background',
    'output_format',
    'output_compression',
    'moderation',
    'response_format',
    'stream',
    'partial_images',
    'user',
    'input_fidelity',
    'style',
  ]) {
    assert.ok(keys.includes(required), `缺少官方参数：${required}`)
  }
})

test('enabled=false 的参数不进归一化结果（用上游默认值）', () => {
  const normalized = normalizeParamSpecs(
    {
      size: { enabled: false, value: '1024x1024' },
      quality: { enabled: true, value: 'high' },
    },
    'generation',
  )
  assert.deepEqual(normalized, { quality: 'high' })
})

test('edit 专属参数不可用于 generation 端点', () => {
  assert.throws(
    () => normalizeParamSpecs({ input_fidelity: { enabled: true, value: 'high' } }, 'generation'),
    ParamValidationError,
  )
  const ok = normalizeParamSpecs({ input_fidelity: { enabled: true, value: 'high' } }, 'edit')
  assert.deepEqual(ok, { input_fidelity: 'high' })
})

test('未知参数与越界值在边界拒绝', () => {
  assert.throws(
    () => normalizeParamSpecs({ nope: { enabled: true, value: 'x' } }, 'generation'),
    /不在参数目录中/,
  )
  assert.throws(
    () => normalizeParamSpecs({ n: { enabled: true, value: 11 } }, 'generation'),
    /不能大于 10/,
  )
  assert.throws(
    () => normalizeParamSpecs({ quality: { enabled: true, value: 'ultra' } }, 'generation'),
    /必须是/,
  )
})

test('validateParamValue 按类型约束校验', () => {
  assert.equal(validateParamValue('n', 3), 3)
  assert.throws(() => validateParamValue('n', 1.5), /整数/)
  assert.throws(() => validateParamValue('n', '3'), /整数/)
  assert.throws(() => validateParamValue('size', ''), /非空字符串/)
  assert.equal(validateParamValue('stream', true), true)
  assert.throws(() => validateParamValue('stream', 'true'), /布尔/)
})

test('model 是 host 承载参数，不计入协议参数表', () => {
  const normalized = normalizeParamSpecs(
    { model: { enabled: true, value: 'gpt-image-2' } },
    'generation',
  )
  assert.deepEqual(normalized, {})
})

test('validateParamSpecs 校验预设结构并回放值', () => {
  const specs = validateParamSpecs({
    size: { enabled: true, value: '1024x1024' },
    stream: { enabled: false },
  })
  assert.equal(specs.size?.enabled, true)
  assert.equal(specs.stream?.enabled, false)
  assert.throws(() => validateParamSpecs({ size: { enabled: 'yes' } }), /enabled 必须是布尔/)
  assert.throws(() => validateParamSpecs([]), /必须是对象/)
})

test('paramKeysFor 按端点过滤', () => {
  const generationKeys = paramKeysFor('generation')
  const editKeys = paramKeysFor('edit')
  assert.ok(!generationKeys.includes('input_fidelity'))
  assert.ok(editKeys.includes('input_fidelity'))
  assert.ok(!editKeys.includes('style'))
  assert.ok(paramEntryOf('style') !== null)
})

test('size 参数在边界按官方尺寸规则拒绝（目录 rules 驱动）', () => {
  // 合法：auto 与 16 倍数的自定义尺寸。
  assert.deepEqual(normalizeParamSpecs({ size: { enabled: true, value: 'auto' } }, 'generation'), {
    size: 'auto',
  })
  assert.deepEqual(normalizeParamSpecs({ size: { enabled: true, value: '1536x1024' } }, 'edit'), {
    size: '1536x1024',
  })
  // 非法：非 16 倍数 / 超长边 / 比例越界 / 畸形，均在提交前拦下并给出原因。
  assert.throws(
    () => normalizeParamSpecs({ size: { enabled: true, value: '1000x1000' } }, 'generation'),
    /16 的倍数/,
  )
  assert.throws(
    () => normalizeParamSpecs({ size: { enabled: true, value: '4096x2160' } }, 'generation'),
    /长边/,
  )
  assert.throws(
    () => normalizeParamSpecs({ size: { enabled: true, value: '3840x1024' } }, 'generation'),
    /宽高比/,
  )
  assert.throws(
    () => normalizeParamSpecs({ size: { enabled: true, value: '1024' } }, 'generation'),
    /宽x高/,
  )
  // 两侧空白在归一化时裁剪（用户复制粘贴容错）。
  assert.deepEqual(
    normalizeParamSpecs({ size: { enabled: true, value: ' 2048X1152 ' } }, 'generation'),
    { size: '2048x1152' },
  )
  // 参数预设同样受规则约束（另存前本地校验）。
  assert.throws(
    () => validateParamSpecs({ size: { enabled: true, value: '999x999' } }),
    /16 的倍数/,
  )
})

test('quality 目录覆盖 image 2.5 高档位（xhigh/max）', () => {
  const entry = paramEntryOf('quality')
  assert.deepEqual(entry?.values, ['auto', 'low', 'medium', 'high', 'xhigh', 'max'])
  assert.deepEqual(
    normalizeParamSpecs({ quality: { enabled: true, value: 'max' } }, 'generation'),
    { quality: 'max' },
  )
  assert.throws(
    () => normalizeParamSpecs({ quality: { enabled: true, value: 'ultra' } }, 'generation'),
    /必须是/,
  )
})
