/**
 * 配置卡片文案（zh/en）。经 ctx.locale.register 注册、bind 取用，与官方卡片同机制。
 * @module subagent-model/client/i18n
 */

export const NS = 'dsh-plus-subagent-model'

export const zh: Record<string, string> = {
  title: '子代理模型配置',
  description: '为 subagent / subagent_fork 等子代理单独指定提供商、模型与思考程度，或继承主代理。',
  enabled: '启用插件',
  rowEnabled: '启用该行',
  provider: '提供商',
  model: '模型',
  effort: '思考程度',
  inheritProvider: '继承主代理',
  inheritModel: '继承主代理',
  effortInherit: '继承主代理',
  effortDefault: '跟随模型默认',
  providerHint: '留空 = 子代理沿用主代理的提供商与模型。',
  modelHint: '留空 = 沿用主代理的模型（需与所选提供商匹配）。',
  effortHint: 'inherit = 不干预（fork 会随会话继承）；default = 显式使用模型默认档位。',
  rowHint:
    '按子代理 provider 名匹配；standard preset 中 spawn ↔ subagent 工具、fork ↔ subagent_fork 工具。',
  rowDesc: '未注册的 provider 行不生效，可保留待用。',
  noRows: '当前未发现子代理 provider；配置将在 provider 注册后生效。',
  catalogError: '提供商目录加载失败：',
  catalogRetry: '重试',
  catalogLoading: '目录加载中…',
  unknownValue: '目录外',
  save: '保存',
  saving: '保存中…',
  discard: '放弃',
  unsaved: '未保存',
  saveFailed: '保存失败：',
  loading: '加载中…',
  unavailable: '配置服务不可用。',
  readOnly: '当前部署无 settings provider，配置为只读；请编辑 settings.yaml。',
  expand: '展开',
  collapse: '收起',
  invalidModel: '模型不能脱离提供商单独配置。',
}

export const en: Record<string, string> = {
  title: 'Subagent model config',
  description:
    'Pick a provider, model, and thinking effort for subagent / subagent_fork children, or inherit from the main agent.',
  enabled: 'Enable plugin',
  rowEnabled: 'Enable row',
  provider: 'Provider',
  model: 'Model',
  effort: 'Effort',
  inheritProvider: 'Inherit from main agent',
  inheritModel: 'Inherit from main agent',
  effortInherit: 'Inherit from main agent',
  effortDefault: 'Follow model default',
  providerHint: 'Empty = the child follows the main agent\u2019s provider and model.',
  modelHint: 'Empty = follow the main agent\u2019s model (must match the chosen provider).',
  effortHint:
    'inherit = do not touch (forks inherit via session seed); default = explicitly use the model\u2019s default level.',
  rowHint:
    'Matched by subagent provider name; in the standard preset spawn \u2194 subagent tool, fork \u2194 subagent_fork tool.',
  rowDesc: 'Rows for unregistered providers are inert; keep them for later.',
  noRows: 'No subagent provider registered yet; config takes effect once one appears.',
  catalogError: 'Failed to load provider catalog: ',
  catalogRetry: 'Retry',
  catalogLoading: 'Loading catalog\u2026',
  unknownValue: 'outside catalog',
  save: 'Save',
  saving: 'Saving\u2026',
  discard: 'Discard',
  unsaved: 'Unsaved',
  saveFailed: 'Save failed: ',
  loading: 'Loading\u2026',
  unavailable: 'Configuration service unavailable.',
  readOnly: 'No settings provider in this deployment; edit settings.yaml instead.',
  expand: 'Expand',
  collapse: 'Collapse',
  invalidModel: 'Model cannot be set without a provider.',
}
