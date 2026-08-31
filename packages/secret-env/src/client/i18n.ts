/**
 * 浏览器半文案（zh/en）。公共键来自 shared common，本文件只维护业务键。
 * @module secret-env/client/i18n
 */
import { commonEn, commonZh, mergeDict } from '@dsh-plus/shared/client'

export const NS = 'dsh-plus-secret-env'

const ownZh = {
  nav: '密钥变量',
  title: '密钥变量',
  description:
    '以 $DSH_SECRET_* 变量名向 agent 暴露密钥：值在每次 shell 调用时由宿主注入，不进入对话记录与提示词，不影响上下文缓存。',
  // 设置页（全局）
  globalList: '全局密钥',
  colName: '变量名（模型可见）',
  colDescription: '描述',
  colState: '状态',
  colActions: '操作',
  configured: '已配置',
  unconfigured: '未配置',
  readonly: '只读来源',
  addGlobal: '添加全局密钥',
  nameLabel: '变量名后缀',
  nameHint: '大写字母/数字/下划线，如 GITHUB_TOKEN；模型实际使用 $DSH_SECRET_ 前缀拼接后的完整名。',
  valueLabel: '值',
  valueHint: '写入后不可回读；保存于宿主凭据库，不进入对话。',
  descLabel: '描述（可选）',
  descHint: '仅人读备注，不进提示词。',
  save: '保存',
  saving: '保存中…',
  delete: '删除',
  deleteConfirm: '确认删除 {name}？该变量将立即对后续命令失效。',
  copy: '复制变量名',
  copied: '已复制',
  emptyGlobal: '暂无全局密钥。添加后 agent 即可通过变量名引用。',
  loadFailed: '加载失败，请稍后重试。',
  retry: '重试',
  // 会话注入控件
  sessionSecrets: '会话密钥',
  sessionEmpty: '本会话暂无有默认值的密钥。',
  sessionHint: '仅当前会话的 shell 命令可用；会话结束或一次性使用即失效。',
  addSession: '添加会话密钥',
  onceLabel: '一次性（首次使用后销毁）',
  close: '关闭',
  refresh: '刷新',
  scopeGlobal: '全局',
  scopeSession: '会话',
  scopeOnce: '一次性',
  // 错误码
  'error.invalid-name': '变量名不合法：大写字母开头，仅字母/数字/下划线，≤64 字符。',
  'error.empty-value': '值不能为空。',
  'error.shadowed': '进程环境中已存在同名变量且优先级更高，写入无效；请先取消该环境变量。',
  'error.conflict': '变量名与其他插件注册的受管变量冲突。',
  'error.no-session': '缺少会话标识，请刷新后重试。',
  'error.method': '请求方法不允许。',
  'error.internal': '服务内部错误，请查看宿主日志。',
}

const ownEn = {
  nav: 'Secret Variables',
  title: 'Secret Variables',
  description:
    'Expose secrets to the agent as $DSH_SECRET_* variables: values are injected by the host into each shell call, never enter the transcript or prompt, and do not affect context caching.',
  globalList: 'Global secrets',
  colName: 'Variable (model-visible)',
  colDescription: 'Description',
  colState: 'State',
  colActions: 'Actions',
  configured: 'Configured',
  unconfigured: 'Not configured',
  readonly: 'Read-only source',
  addGlobal: 'Add global secret',
  nameLabel: 'Name suffix',
  nameHint:
    'Uppercase letters/digits/underscore, e.g. GITHUB_TOKEN; the model uses the full name with the $DSH_SECRET_ prefix.',
  valueLabel: 'Value',
  valueHint: 'Write-only after saving; stored in the host credential store, never in chat.',
  descLabel: 'Description (optional)',
  descHint: 'Human-readable note only; never enters prompts.',
  save: 'Save',
  saving: 'Saving…',
  delete: 'Delete',
  deleteConfirm: 'Delete {name}? The variable stops working for subsequent commands immediately.',
  copy: 'Copy variable name',
  copied: 'Copied',
  emptyGlobal: 'No global secrets yet. Once added, the agent can reference them by name.',
  loadFailed: 'Failed to load. Try again later.',
  retry: 'Retry',
  sessionSecrets: 'Session secrets',
  sessionEmpty: 'No session secrets yet.',
  sessionHint:
    'Available to shell commands of this session only; expires when the session ends or after one use.',
  addSession: 'Add session secret',
  onceLabel: 'One-time (destroyed after first use)',
  close: 'Close',
  refresh: 'Refresh',
  scopeGlobal: 'global',
  scopeSession: 'session',
  scopeOnce: 'once',
  'error.invalid-name':
    'Invalid name: start with an uppercase letter; letters/digits/underscore only, ≤64 chars.',
  'error.empty-value': 'Value must not be empty.',
  'error.shadowed': 'A same-named process environment variable shadows this write; unset it first.',
  'error.conflict': 'The variable conflicts with a managed variable registered by another plugin.',
  'error.no-session': 'Missing session id; refresh and retry.',
  'error.method': 'Method not allowed.',
  'error.internal': 'Internal error; check the host log.',
}

export const zh: Record<string, string> = mergeDict(commonZh, ownZh)
export const en: Record<string, string> = mergeDict(commonEn, ownEn)
