/**
 * 参数表单状态换算：目录驱动初始化、预设/画廊回放、提交导出。
 * 验收条件：host 参数（model）不进表单；回放仅启用出现在快照中的键；
 * 导出仅含启用项且 integer 解析为数值；edit 端点不含 generation 专属参数。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  applyParams,
  applySpecs,
  emptyParamForm,
  formToSpecs,
  paramEntriesFor,
} from '../src/client/panel/param-state.ts'
import { PARAM_CATALOG } from '../src/params/catalog.ts'

test('空表单：端点适用参数全部入场且默认关闭，model 不进表单', () => {
  const form = emptyParamForm(PARAM_CATALOG, 'generation')
  assert.equal('model' in form, false)
  assert.equal('size' in form, true)
  assert.equal(form.size?.enabled, false)
  // edit 专属参数不出现在 generation 表单
  assert.equal('input_fidelity' in form, false)
  // generation 专属（dall-e-3 代际 style）出现在 generation 表单
  assert.equal('style' in form, true)
})

test('画廊回放：仅快照中出现的键被启用，值字符串化', () => {
  const form = applyParams(PARAM_CATALOG, 'generation', {
    size: '1536x1024',
    n: 2,
    stream: true,
  })
  assert.deepEqual(form.size, { enabled: true, value: '1536x1024' })
  assert.deepEqual(form.n, { enabled: true, value: '2' })
  assert.deepEqual(form.stream, { enabled: true, value: true })
  assert.equal(form.quality?.enabled, false)
})

test('参数预设套用：enabled=false 的键显式关闭并回到默认值', () => {
  const form = applySpecs(PARAM_CATALOG, 'edit', {
    input_fidelity: { enabled: true, value: 'low' },
    size: { enabled: false },
  })
  assert.deepEqual(form.input_fidelity, { enabled: true, value: 'low' })
  assert.equal(form.size?.enabled, false)
  assert.equal(form.size?.value, '1024x1024')
})

test('提交导出：仅启用项出场，integer 解析为数值，boolean 透传', () => {
  const form = emptyParamForm(PARAM_CATALOG, 'generation')
  form.n = { enabled: true, value: '3' }
  form.size = { enabled: true, value: '1024x1536' }
  form.stream = { enabled: true, value: true }
  form.quality = { enabled: false, value: 'high' }
  const specs = formToSpecs(PARAM_CATALOG, 'generation', form)
  assert.deepEqual(specs, {
    n: { enabled: true, value: 3 },
    size: { enabled: true, value: '1024x1536' },
    stream: { enabled: true, value: true },
  })
})

test('提交导出：启用但空串的 integer 导出无 value（交由边界校验报错）', () => {
  const form = emptyParamForm(PARAM_CATALOG, 'generation')
  form.n = { enabled: true, value: '' }
  const specs = formToSpecs(PARAM_CATALOG, 'generation', form)
  assert.deepEqual(specs.n, { enabled: true })
})

test('端点过滤：paramEntriesFor 剔除他端点专属与 host 参数', () => {
  const editKeys = paramEntriesFor(PARAM_CATALOG, 'edit').map((entry) => entry.key)
  assert.equal(editKeys.includes('input_fidelity'), true)
  assert.equal(editKeys.includes('style'), false)
  assert.equal(editKeys.includes('model'), false)
})
