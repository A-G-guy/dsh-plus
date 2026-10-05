/**
 * `@dsh-plus/actual-mcp`：把本机 `@actual-app/cli` 按 help 文本运行时自动封装为
 * **MCP 服务**（格式一，零 DSH 依赖）。
 *
 * 能力目录完全由「已安装 CLI 的 help 树」现场派生：命令族、动作、参数、枚举、
 * 位置参数都不落代码，CLI 升级即目录升级。主插件（@dsh-plus/actual）在进程内
 * 挂载同一个 `createActualMcpServer`，再从 tools/list 派生出 DSH 工具（格式二），
 * 因此本包同时是格式一与格式二的唯一能力来源。
 * @module @dsh-plus/actual-mcp
 */

/**
 * 伴侣报表能力描述符：经本包统一出口转发，供已依赖本包的消费方（主插件/预设侧）
 * 复用同一份 schema 与执行计划，不必为一个只读用途新增依赖边。
 */
export {
  FAMILY_CAPABILITIES,
  familyCapability,
  findCapability,
  type ReportsActionPlan,
  type ReportsArgPlan,
  type ReportsCapability,
  type ReportsPlan,
} from '@dsh-plus/actual-reports'
export { type ArgvPlan, buildArgv } from './argv.ts'
export {
  actionOf,
  askDisplayReason,
  type ClassifySettings,
  classifyAction,
  DEFAULT_ALWAYS_ASK,
  DEFAULT_READ_ACTIONS,
  DEFAULT_READ_TOOLS,
  toSettings,
} from './classify.ts'
export {
  ActualCli,
  type CliCandidate,
  type CliConfig,
  type CliDeps,
  type CliRunOptions,
  type CliSecrets,
  cliCandidates,
  cliEnv,
  configSecretsOf,
  mergedEnv,
  parseJsonOrText,
  probeServerVersion,
  resolveCli,
  SECRET_ENV,
  sanitize,
  secretEnvOf,
} from './cli-run.ts'
export type {
  ActualCliBinding,
  ActualManifest,
  ActualStatus,
  CapabilityDrift,
  CapabilityEntry,
  CapabilitySource,
  CliPlan,
} from './contract.ts'
export {
  buildCatalog,
  type CatalogOptions,
  type CatalogResult,
  computeDrift,
  EXCLUDED_FAMILIES,
  type HelpTree,
  kebabToCamel,
} from './derive.ts'
export {
  collectActionHelps,
  collectFamilyHelps,
  collectHelpTree,
  collectInvokeHelp,
  collectRoot,
  type DiscoverOptions,
  type Discovery,
  discover,
  mapLimit,
  reportsCapabilities,
  versionStatusOf,
} from './discover.ts'
export {
  type CliOption,
  type CliSubcommand,
  type CommanderHelp,
  parseCommanderHelp,
} from './help.ts'
export {
  buildReportsArgv,
  createEntryInvoker,
  type EntryInvoker,
  type InvokeOptions,
  REPORTS_CLI_ENTRY_ENV,
} from './invoke.ts'
export { createNodeDeps } from './node-io.ts'
export {
  type ActualMcpHost,
  callToolResultOf,
  createActualMcpServer,
  formatToolValue,
} from './server.ts'
