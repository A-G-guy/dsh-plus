/**
 * 配置卡片文案（zh/en）。经 ctx.locale.register 注册、bind 取用。
 * 公共键（save/discard/unsaved 等）来自 shared 的 common 字典，本文件只维护业务键。
 *
 * 两处说明文案是有意为之的「落点」：密钥与高级字段都没有编辑器，必须在卡片内
 * 写清「为什么没有、该去哪里配」，否则就是留给用户的空承诺。
 * @module @dsh-plus/actual/client/i18n
 */
import { commonEn, commonZh, mergeDict } from '@dsh-plus/shared/client'

export const NS = 'dsh-plus-actual'

const ownZh = {
  title: 'Actual Budget 连接',
  description:
    '配置本机 Actual 同步服务器与 CLI 行为。改动热生效，无需重载：连接相关字段会触发能力重新发现。',
  summaryLine: 'Actual 服务器地址、预算 Sync ID、CLI 与工具策略。',

  enabled: '启用 actual 预设',
  enabledHint: '关闭即不注册该预设（等价插件未安装）；已开的会话保持原组合，新会话起不再出现。',

  serverUrl: '同步服务器地址',
  serverUrlHint:
    '自托管默认 http://127.0.0.1:5006。服务端版本从 <地址>/info 读取，用于版本一致性告警。',
  serverUrlInvalid: '必须是 http(s):// 开头的完整地址',

  syncId: '预算 Sync ID',
  syncIdHint:
    'Actual 客户端 → 设置 → 显示高级设置 → Sync ID。留空则读环境变量 ACTUAL_SYNC_ID。多数命令都需要它。',

  cliCommand: 'CLI 命令',
  cliCommandHint:
    '留空 = 自动探测（ACTUAL_CLI 环境变量 → PATH 上的 actual → 包内 @actual-app/cli）。需要指定具体副本时填完整 argv，如 node /opt/actual/dist/cli.js（空格分隔，不支持引号）。',
  cliCommandInvalid: '不支持引号：请直接以空格分隔各个参数',

  cliVersionPolicy: '版本不一致处置',
  cliVersionPolicyHint:
    'CLI 与服务端 major.minor 不一致时：warn 告警继续（Actual 服务端只做同步中继，通常仍可用）；strict 直接让发现失败。',
  policyWarn: 'warn —— 告警并继续',
  policyStrict: 'strict —— 直接失败',

  confirmWrites: '写操作需确认',
  confirmWritesHint:
    '经 DSH 审批策略生效：会话为「每次询问」时弹审批窗；「完全权限」下自动通过（绝不静默拒绝）。',
  auxTools: '挂载辅助工具',
  auxToolsHint: '额外提供 web 检索、结构化提问与待办跟踪三件套；它们不改动预算数据。',

  namePrefix: '工具名前缀',
  namePrefixHint:
    '模型可见的工具名 = 前缀 + 命令族名（如 actual_accounts）。留空则直接用裸族名——query、server 等过于通用，不建议。',
  namePrefixInvalid: '只允许字母、数字、下划线与连字符',

  secretsTitle: '服务器口令',
  secretsBody:
    '口令属密钥：它不进用户层配置，卡片也不提供输入框（写进来会被脱敏遮蔽，等于白填）。请在 profile 的 cordis.patch.yml 里做行级注入，口令本身放环境变量：',
  secretsSnippet:
    '- id: dsh-plus-actual\n  config:\n    syncId: !!js process.env.ACTUAL_SYNC_ID\n    password: !!js process.env.ACTUAL_PASSWORD',
  secretsTail:
    '把 ACTUAL_PASSWORD 放进 dsh 服务进程的环境（systemd 的 EnvironmentFile）。官方 CLI 还支持 ACTUAL_PASSWORD_FILE——更适合密钥文件；encrypted 预算另需 ACTUAL_ENCRYPTION_PASSWORD。改动环境变量后需重启 dsh 服务。',

  advancedTitle: '其余字段',
  advancedBody:
    '以下字段只在 profile 的 cordis.patch.yml 里配置：预算目录与超时（dataDir / cacheTtl / lockTimeout / toolCallTimeoutMs）、工具暴露与读写判定（allow / deny / readActions / alwaysAsk / readTools）、预设显示与提示词（name / description / order / personaPrefix / includeRuntimeContext）。',
} as const

const ownEn = {
  title: 'Actual Budget connection',
  description:
    'Configure the local Actual sync server and CLI behaviour. Changes apply hot — connection fields trigger a fresh capability discovery.',
  summaryLine: 'Actual server address, budget sync ID, CLI and tool policy.',

  enabled: 'Enable the actual preset',
  enabledHint:
    'Off stops registering the preset (equivalent to not installed). Live sessions keep their composition; new ones will not see it.',

  serverUrl: 'Sync server URL',
  serverUrlHint:
    'Self-hosted default is http://127.0.0.1:5006. The server version is read from <url>/info for the version-mismatch warning.',
  serverUrlInvalid: 'Must be a full http(s):// URL',

  syncId: 'Budget sync ID',
  syncIdHint:
    'Actual client → Settings → Show advanced settings → Sync ID. Empty falls back to the ACTUAL_SYNC_ID environment variable. Most commands need it.',

  cliCommand: 'CLI command',
  cliCommandHint:
    'Empty = auto-detect (ACTUAL_CLI env → actual on PATH → bundled @actual-app/cli). To pin a specific copy, give the full argv, e.g. node /opt/actual/dist/cli.js (space-separated, no quotes).',
  cliCommandInvalid: 'Quotes are not supported: separate arguments with spaces',

  cliVersionPolicy: 'On version mismatch',
  cliVersionPolicyHint:
    'When CLI and server major.minor differ: warn keeps going (the Actual server is a sync relay, usually still fine); strict fails discovery outright.',
  policyWarn: 'warn — alert and continue',
  policyStrict: 'strict — fail outright',

  confirmWrites: 'Confirm write operations',
  confirmWritesHint:
    'Routed through the DSH approval policy: prompts when the session asks every time, passes automatically under full permission (never silently denies).',
  auxTools: 'Mount auxiliary tools',
  auxToolsHint:
    'Adds web search, structured questions and todo tracking; none of them touch budget data.',

  namePrefix: 'Tool name prefix',
  namePrefixHint:
    'Model-visible tool name = prefix + command family (e.g. actual_accounts). Empty uses bare family names — query, server and tags are too generic, so a prefix is advised.',
  namePrefixInvalid: 'Letters, digits, underscore and hyphen only',

  secretsTitle: 'Server password',
  secretsBody:
    'The password is a secret: it never enters the user-layer configuration, and this card offers no input for it (a value written here is masked away — filling it in would do nothing). Inject it at the profile row in cordis.patch.yml and keep the value in the environment:',
  secretsSnippet:
    '- id: dsh-plus-actual\n  config:\n    syncId: !!js process.env.ACTUAL_SYNC_ID\n    password: !!js process.env.ACTUAL_PASSWORD',
  secretsTail:
    'Put ACTUAL_PASSWORD into the dsh service process environment (systemd EnvironmentFile). The official CLI also supports ACTUAL_PASSWORD_FILE, which suits secret files better; an encrypted budget additionally needs ACTUAL_ENCRYPTION_PASSWORD. Restart the dsh service after changing environment variables.',

  advancedTitle: 'Remaining fields',
  advancedBody:
    'These are configured only in the profile cordis.patch.yml: budget directory and timeouts (dataDir / cacheTtl / lockTimeout / toolCallTimeoutMs), tool exposure and read/write classification (allow / deny / readActions / alwaysAsk / readTools), and preset display and prompt (name / description / order / personaPrefix / includeRuntimeContext).',
} as const

export type DictKey = keyof typeof commonZh | keyof typeof ownZh

/** 卡片共用的翻译函数类型（slot 注入的 bind 结果按此消费）。 */
export type Translate = (key: DictKey) => string

// 标注为 Record<DictKey, string>：en 缺任一键即编译期报错（中英强制对齐）。
export const zh: Record<DictKey, string> = mergeDict(commonZh, ownZh)
export const en: Record<DictKey, string> = mergeDict(commonEn, ownEn)
