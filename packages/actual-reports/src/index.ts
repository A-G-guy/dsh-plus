/**
 * `@dsh-plus/actual-reports` 公开面。
 *
 * 两层用途：
 * - **可执行**：`bin/report.js` 是伴侣 CLI，供 DSH 与 MCP 经子进程调用；
 * - **可 import**：`FAMILY_CAPABILITIES` 给出工具描述符（名字/描述/schema/执行计划），
 *   由 `@dsh-plus/actual-mcp` 挂进能力目录，保证 schema 与 CLI 解析同源。
 * @module @dsh-plus/actual-reports
 */

export * from './action.ts'
export * from './actions.ts'
export * from './aggregate.ts'
export * from './api.ts'
export * from './cache.ts'
export * from './capability.ts'
export * from './cli.ts'
export * from './compute.ts'
export * from './dashboard-commands.ts'
export * from './dashboard-store.ts'
export * from './dates.ts'
export * from './env.ts'
export * from './groups.ts'
export * from './interval-range.ts'
export * from './lock.ts'
export * from './model.ts'
export * from './node-io.ts'
export * from './query.ts'
export * from './render.ts'
export * from './report-commands.ts'
export * from './report-ranges.ts'
export * from './report-store.ts'
export * from './session.ts'
