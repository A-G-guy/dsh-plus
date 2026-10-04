/**
 * 凭据引用名字面量（纯常量，零依赖）。
 *
 * 宿主半（credentials.ts 的 seam 解析）与浏览器半（配置卡片的
 * `remote.credentials` 读写）共用同一份取值；浏览器包不得经此路径拖入
 * `@dsh-plus/actual-mcp` 的 node 侧实现（child_process 等），故字面量独立成模块。
 *
 * **必须与 `@dsh-plus/actual-mcp` 的 `SECRET_ENV` 逐字一致**：引用名与官方 CLI
 * 原生读取的环境变量名同形（`ACTUAL_` 前缀亦符合《插件存储规范》的
 * `<PLUGIN_ID>_` 大写约定），凭据文件里的一处配置才能同时被 seam 解析、
 * 又被 CLI 自身继承环境读到。该一致性由 `tests/refs.test.ts` 钉住。
 * @module @dsh-plus/actual/refs
 */

/** 服务器口令。 */
export const REF_PASSWORD = 'ACTUAL_PASSWORD'
/** 会话令牌（官方 CLI 优先于口令）。 */
export const REF_SESSION_TOKEN = 'ACTUAL_SESSION_TOKEN'
/** 端到端加密口令（仅加密预算需要）。 */
export const REF_ENCRYPTION_PASSWORD = 'ACTUAL_ENCRYPTION_PASSWORD'

/** 卡片展示与批量 describe 使用的引用清单（顺序即展示顺序）。 */
export const CREDENTIAL_REFS = [REF_PASSWORD, REF_SESSION_TOKEN, REF_ENCRYPTION_PASSWORD] as const
