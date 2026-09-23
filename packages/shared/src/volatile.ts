/**
 * 0.1.7 配置活动引用（schemastery `.volatile()`）解包工具。
 *
 * 平台在 loader 解析层把 volatile 字段校验为稳定的活动引用
 * （cosmokit `Volatile<T>`，`get()` 读当前不可变快照，loader 提交时
 * 原位更新引用），插件运行期需要的是平面配置值。本模块提供类型面
 * 与运行期面的统一解包：引用取活值、普通字段直通。
 * @module @dsh-plus/shared/volatile
 */

/** 只识别活动引用协议（`get()` 方法）；普通配置对象直通。 */
interface VolatileRef {
  get(): unknown
}

/**
 * 活动字段引用的**声明面**：与 cosmokit `Volatile<T>` 结构兼容
 * （`get()` 返回深层只读快照）。annotated schema（`z<Input, Fields>`）
 * 用它标注 volatile 输出面，让 dts 可命名、避免 TS2883。
 */
export interface VolatileField<T> {
  get(): VolatileSnapshotOf<T>
}

/** `VolatileSnapshot` 的结构同型（深层只读；数组/元组同构保留）。 */
export type VolatileSnapshotOf<T> = T extends readonly (infer E)[]
  ? readonly VolatileSnapshotOf<E>[]
  : T extends object
    ? { readonly [K in keyof T]: VolatileSnapshotOf<T[K]> }
    : T

/** 把平面配置类型逐字段映射为活动引用声明面。 */
export type VolatileFields<T> = { [K in keyof T]: VolatileField<T[K]> }

/**
 * 把 schema 输出中的活动引用映射回平面值类型：
 * - `Volatile<T>`（含深层只读快照）→ 可变平面 `T`；
 * - 普通字段原样保留。
 */
export type UnwrapVolatile<T> = {
  [K in keyof T]: T[K] extends { get(): infer U } ? MutableSnapshot<U> : T[K]
}

/** `VolatileSnapshot` 的逆映射：还原深层可变形态（数组/元组同构保留）。 */
type MutableSnapshot<U> = U extends readonly (infer E)[]
  ? MutableSnapshot<E>[]
  : U extends object
    ? { -readonly [K in keyof U]: MutableSnapshot<U[K]> }
    : U

/** 判断值是否实现活动引用协议（跨 ESM/CJS 实例的结构识别）。 */
export function isVolatileRef(value: unknown): value is VolatileRef {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { get?: unknown }).get === 'function'
  )
}

/** 值（或其任一自有字段）是否携带活动引用——用于区分已解析配置与裸行配置。 */
export function hasVolatileRefs(value: unknown): boolean {
  if (isVolatileRef(value)) return true
  if (typeof value !== 'object' || value === null) return false
  return Object.values(value).some((field) => isVolatileRef(field))
}

/**
 * 读取配置的平面快照：活动引用 `.get()` 取活值、普通字段直通。
 * 两种形态（loader 已解析的活动引用 / 测试与裸行配置的平面值）皆可传入。
 */
export function unwrapVolatile<T extends object>(fields: T): UnwrapVolatile<T> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(fields)) {
    out[key] = isVolatileRef(value) ? value.get() : value
  }
  return out as UnwrapVolatile<T>
}
