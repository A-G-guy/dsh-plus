/**
 * 编译期类型断言工具（纯类型，零运行期产物）。
 *
 * 用途：把「类型契约」写成可被 tsc 检查的断言，挂进既有类型闸门
 * （dshctl typecheck 覆盖各包 tsconfig 的 include：src / tests）。
 * 典型场景——配置 schema 推断链被显式 any 切断时，导出类型会静默退化为
 * any 而 tsc 全绿；`Equal` 断言能让这类退化在编译期变红。
 *
 * 用法（务必写在**具体类型**上，不要包成带裸类型参数的泛型助手）：
 * ```ts
 * type _Check = Expect<Equal<WebTerminalConfig['maxSessions'], number>>
 * ```
 * 若 WebTerminalConfig 退化为 any，则 `any['maxSessions']` 仍是 any，
 * `Equal<any, number>` 为 false，tsc 即报 “Type 'false' does not satisfy
 * the constraint 'true'”。
 *
 * 为什么不提供 `NotAny<T>` 这类泛型助手：`T` 作裸类型参数时，`0 extends 1 & T`
 * 之类的条件类型在泛型声明处会求值为 boolean，且实例化 `any` 时可能触发分布式
 * 求值而静默返回 true——实测 `NotAny<any>` 不报错，属反向陷阱。具体断言无此问题。
 *
 * @module @dsh-plus/shared/types/assert
 */

/** 严格相等判定（区分 any、never，且不把可选性差异误判为相等）。 */
export type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

/** 断言条件成立；不成立时 tsc 报 “Type 'false' does not satisfy the constraint 'true'”。 */
export type Expect<T extends true> = T
