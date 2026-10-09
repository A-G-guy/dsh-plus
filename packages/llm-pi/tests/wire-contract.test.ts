/**
 * 服务端产出 ↔ 浏览器半消费的类型契约：HTTP payload 是手写镜像，靠类型级断言
 * 把两侧钉在一起（`dshctl typecheck` 逐包跑 tsc 时即校验；本文件的运行期断言只是
 * 让 node --test 也有一个可执行锚点）。
 * @module @dsh-plus/llm-pi/tests/wire-contract
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { BrowseResult, BuiltinModelInfo } from '../src/catalog/browse.ts'
import type { BuiltinProviderEntry } from '../src/catalog/builtin.ts'
import type {
  CatalogMeta,
  CatalogPage,
  WireKitInfo,
  WireModelInfo,
  WireProviderEntry,
} from '../src/client/api.ts'
import type { LlmPiKitInfo, LlmPiRuntime } from '../src/service.ts'

/** 类型级断言：条件为假即编译期报错（typecheck 门禁捕获）。 */
type Assert<T extends true> = T

// ── meta 端点：service 产出 → /catalog 响应 → 浏览器半类型 ────────────────
export type {
  _ApisIndex,
  _InfoMirror,
  _KitToWire,
  _MetaShape,
  _PageShape,
  _ProviderMirror,
  _RuntimeHasMeta,
}

type _KitToWire = Assert<LlmPiKitInfo extends WireKitInfo ? true : false>
type _RuntimeHasMeta = Assert<LlmPiRuntime['kitInfo'] extends () => LlmPiKitInfo ? true : false>
type _MetaShape = Assert<
  CatalogMeta extends {
    kit: WireKitInfo
    providers: WireProviderEntry[]
    apis: Record<string, Record<string, string>>
  }
    ? true
    : false
>
type _ProviderMirror = Assert<BuiltinProviderEntry extends WireProviderEntry ? true : false>
type _ApisIndex = Assert<
  ReturnType<LlmPiRuntime['apiIndex']> extends Record<string, Record<string, string>> ? true : false
>

// ── models 端点：browse 结果 → 分页响应 → 浏览器半类型 ────────────────────
type _InfoMirror = Assert<BuiltinModelInfo extends WireModelInfo ? true : false>
type _PageShape = Assert<
  BrowseResult extends { total: number; servableHidden: number; offset: number; limit: number }
    ? CatalogPage extends { total: number; servableHidden: number; offset: number; limit: number }
      ? true
      : false
    : false
>

test('wire 契约的锚点断言（形状一致性由类型级断言保证）', () => {
  // 这两个类型都来自真实实现；此处只断言它们仍是"结构可赋值"的同一形状，
  // 任何一侧增删必填字段都会让上面的 Assert 编译失败。
  const kit: LlmPiKitInfo = {
    source: 'vendored',
    versions: { piAi: '1.1.0' },
    verifiedRange: '>=1.0.2 <2.0.0',
    protocols: ['openai-completions'],
    protocolSource: 'official',
    catalog: { providers: 1, models: 1 },
    compatSource: 'official',
    officialCopy: { path: '/tmp/llm-pi.official-patch.yaml', routes: 1, warnings: [] },
    diagnostics: [{ level: 'info', message: '官方 src 不随 npm 发布' }],
  }
  const wire: WireKitInfo = kit
  assert.deepEqual(wire.protocols, ['openai-completions'])
  assert.equal(wire.catalog.models, 1)
})
