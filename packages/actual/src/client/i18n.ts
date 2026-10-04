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
    'Actual 客户端 → 设置 → 显示高级设置 → Sync ID，即 budgets list 里的 groupId；' +
    '不要填同一条目里的 cloudFileId（填错会报 Budget not found）。留空则读环境变量 ACTUAL_SYNC_ID。',

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

  secretsTitle: '凭据',
  secretsBody:
    '密钥单独存放，不进入会话、提示词与配置流，保存后立即生效（下一次工具调用即用新值）。三行都可留空：口令与会话令牌二选一即可，加密口令仅加密预算需要。',
  secretPassword: '服务器口令',
  secretPasswordHint: '自托管部署的登录口令。ACTUAL_LOGIN_METHOD=password 时用它换会话令牌。',
  secretToken: '会话令牌',
  secretTokenHint: '已有的会话令牌（优先于口令）。从浏览器开发者工具的 X-Actual-Token 头可取。',
  secretEncryption: '端到端加密口令',
  secretEncryptionHint: '仅当预算启用了端到端加密时需要；普通预算留空。',
  secretSet: '已配置',
  secretUnset: '未配置',
  secretClear: '清除',
  secretShadowed:
    '该引用由 dsh 进程环境提供（只读层优先于凭据文件），卡片改不了：请改环境来源并重启 dsh。',
  secretFailed: '凭据操作失败：',

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
    'Actual client → Settings → Show advanced settings → Sync ID, i.e. the groupId in budgets list; ' +
    'not the cloudFileId of the same entry (a wrong value reports Budget not found). Empty falls back to ACTUAL_SYNC_ID.',

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

  secretsTitle: 'Credentials',
  secretsBody:
    'Secrets live separately — they never enter the conversation, the prompt or the settings stream, and a save applies immediately (the next tool call uses it). All three may stay empty: password and session token are alternatives, and the encryption password is only needed for encrypted budgets.',
  secretPassword: 'Server password',
  secretPasswordHint:
    'The login password of your self-hosted deployment. Exchanged for a session token when ACTUAL_LOGIN_METHOD=password.',
  secretToken: 'Session token',
  secretTokenHint:
    'An existing session token; it takes precedence over the password. Read it from the X-Actual-Token header in devtools.',
  secretEncryption: 'End-to-end encryption password',
  secretEncryptionHint:
    'Only needed when the budget has end-to-end encryption enabled; leave empty otherwise.',
  secretSet: 'Configured',
  secretUnset: 'Not configured',
  secretClear: 'Clear',
  secretShadowed:
    'This reference comes from the dsh process environment, which shadows the credentials file and cannot be edited here. Change the environment source and restart dsh.',
  secretFailed: 'Credential operation failed: ',

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
