/**
 * 配置卡片文案（zh/en）。经 ctx.locale.register 注册、bind 取用。
 * 公共键（save/discard/unsaved 等）来自 shared 的 common 字典，本文件只维护业务键。
 * @module web-search-services/client/i18n
 */
import { commonEn, commonZh, mergeDict } from '@dsh-plus/shared/client'

export const NS = 'dsh-plus-web-search-services'

const ownZh = {
  title: '搜索后端聚合',
  description:
    '把 search-services skill 接成 dsh 的 web_search 后端：按优先级尝试 Tavily / Exa / OpenAI-compatible，失败自动回退。',
  summaryLine: 'web_search 免费后端聚合：优先级链 + 失败自动回退（密钥读 skill 的 env 文件）。',
  scriptPath: 'search.py 路径',
  scriptPathHint: '留空 = 使用随包内置脚本；支持 ~ 展开。',
  envFile: '密钥 env 文件',
  envFileHint:
    '默认 ~/.config/search-services/env（skill 的单事实源）；留空表示不读该文件。支持 ~ 展开。',
  python: 'python 解释器',
  pythonHint: '可含参数（如 py -3）；留空 = 自动发现（桌面捆绑运行时 → PATH → 平台兜底名）。',
  priority: '后端优先级',
  priorityHint:
    '每行一个，靠前先试，失败自动回退到下一个。可选值：tavily、exa、openai-chat；重复或未知值会被拒绝保存。',
  timeoutMs: '单次搜索超时（毫秒）',
  timeoutMsHint: '应低于 dsh-tool-web 的 searchTimeoutMs；下限 1000，默认 55000。',
  invalidPriority: '请填写至少一个有效后端，且不要重复',
  invalidTimeout: '请输入不小于 1000 的整数',
  keysGroup: '密钥与覆盖项（本卡片不编辑）',
  keysHint:
    '密钥主来源是上面的 env 文件，保持 skill 单事实源：TAVILY_API_KEY、EXA_API_KEY、SEARCH_OPENAI_API_KEY，以及可选的 SEARCH_OPENAI_BASE_URL、SEARCH_OPENAI_MODEL。',
  keysUserLayerHint:
    'schema 里的 keys 段是行级覆盖逃生舱（role(secret) 字段只允许 profile 行级注入）；写入 settings 用户层会被脱敏遮蔽，因此配置卡片不提供编辑。需要覆盖时请改 env 文件，或在 profile 的 cordis.patch.yml 行级注入。',
  reloadHint: '改动热生效（下一次 web_search 调用即用新配置）；scriptPath / python 变化无需重启。',
} as const

const ownEn = {
  title: 'Search backend aggregation',
  description:
    'Bridges the search-services skill into dsh as a web_search backend: tries Tavily / Exa / OpenAI-compatible in priority order with automatic fallback.',
  summaryLine:
    'web_search backend aggregation: priority chain with automatic fallback (keys from the skill env file).',
  scriptPath: 'search.py path',
  scriptPathHint: 'Empty uses the bundled copy; ~ is expanded.',
  envFile: 'Credential env file',
  envFileHint:
    'Defaults to ~/.config/search-services/env (the skill’s single source); empty skips the file. ~ is expanded.',
  python: 'Python interpreter',
  pythonHint:
    'May include arguments (e.g. py -3); empty auto-detects (desktop runtime → PATH → platform default).',
  priority: 'Backend priority',
  priorityHint:
    'One per line, earlier first, with automatic fallback on failure. Allowed: tavily, exa, openai-chat; duplicates or unknown values block saving.',
  timeoutMs: 'Per-search timeout (ms)',
  timeoutMsHint: 'Keep it below dsh-tool-web’s searchTimeoutMs; minimum 1000, default 55000.',
  invalidPriority: 'Enter at least one valid backend without duplicates',
  invalidTimeout: 'Enter an integer of at least 1000',
  keysGroup: 'Credentials and overrides (not edited here)',
  keysHint:
    'Credentials come from the env file above, keeping the skill as the single source: TAVILY_API_KEY, EXA_API_KEY, SEARCH_OPENAI_API_KEY, plus optional SEARCH_OPENAI_BASE_URL and SEARCH_OPENAI_MODEL.',
  keysUserLayerHint:
    'The keys section in the schema is a line-level escape hatch (role(secret) fields accept profile-line injection only); values written to the settings user layer are masked, so this card offers no editor. To override, edit the env file or inject at the profile row in cordis.patch.yml.',
  reloadHint:
    'Changes apply hot (the next web_search call uses them); scriptPath / python need no restart.',
} as const

export type DictKey = keyof typeof commonZh | keyof typeof ownZh

/** 卡片共用的翻译函数类型（slot 注入的 bind 结果按此消费）。 */
export type Translate = (key: DictKey) => string

// 标注为 Record<DictKey, string>：en 缺任一键即编译期报错（中英强制对齐）。
export const zh: Record<DictKey, string> = mergeDict(commonZh, ownZh)
export const en: Record<DictKey, string> = mergeDict(commonEn, ownEn)
