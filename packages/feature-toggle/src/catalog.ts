/**
 * 功能目录：封闭世界模型（数据驱动）。
 *
 * 只有本目录登记的行 id 才允许被本插件禁用/启用；一切未登记 id 的写入请求
 * 在边界即被拒绝（默认拒绝），从机制上杜绝关闭核心行（llm/session/settings/
 * webserver/api-gateway/agent-presets/subagent 注册表/sandbox/tools/system-prompt
 * 等根本不在集合里，也无法被加入——目录是编译期常量）。
 *
 * 平面语义：
 * - host 平面行：位于 dsh-base / dsh-web-app / dsh-plus bundle 的组合树行，
 *   经 profile 用户 patch 层（cordis.patch.yml）的 {id, disabled} 覆盖控制，
 *   watchUserPatches 热应用（即时生效）。
 * - preset 平面行：位于 agent preset（standard 等）的 agent.cordis.yml 行，
 *   经托管预设副本（$DSH_HOME/.agent-presets/dsh-plus-toggles/）控制，
 *   对新会话生效（stamp/generation 机制），无需重启进程。
 *
 * 目录事实依据（已核实安装树，版本基准 0.1.1-rc.2）：
 * - 子代理工具全部位于 standard/code preset 的 delegation 组（id: delegation）；
 *   web-app bundle 已禁用 base 层对应行，preset 是唯一有效控制点。
 * - `subagent`（注册表行）被 api-proxy static inject 依赖 → 永不在目录。
 * - `tool-subagent-report` 是 host 平面 continuable setup 注册行 → 永不在目录。
 * - host `web`/`web-search-deepseek` 服务行保留空转：preset 行 tool-web 禁用后
 *   无模型消费者；不禁 host 服务行，避免热 dispose `web` 服务连累在途会话的
 *   tool-web fiber。
 * - host goal 服务族（goal/goal-round-driver/command-goal）被 gateway Remote
 *   依赖 → 只禁 preset 行 tool-goal。
 * @module feature-toggle/catalog
 */

/** 开关作用的平面。 */
export type Plane = 'host' | 'preset'

/** 目录中一个功能组的定义。 */
export interface FeatureDef {
  /** 功能 id（同时是 settings features dict 的键）。 */
  id: string
  /** i18n 名/描述键（i18n 字典直接以 id 寻址）。 */
  titleKey: string
  descriptionKey: string
  /** 该功能覆盖的行（host 平面 = 组合树行 id；preset 平面 = 预设文件行 id）。 */
  rows: { host: string[]; preset: string[] }
  /** 生效方式元数据。 */
  effect:
    | 'immediate' // loader 热应用，即时生效
    | 'new-session' // 预设 generation，新会话生效
  /** 浏览器半是否需要刷新才能看到界面变化（纯提示用）。 */
  needsBrowserRefresh: boolean
}

/**
 * 封闭目录（编译期常量）。新增条目必须同步补 i18n 与测试。
 */
export const CATALOG: readonly FeatureDef[] = [
  {
    id: 'subagents',
    titleKey: 'feature.subagents',
    descriptionKey: 'feature.subagents.desc',
    rows: {
      host: ['subagent-spawn-in-process', 'subagent-fork-in-process'],
      preset: ['delegation'],
    },
    effect: 'new-session',
    needsBrowserRefresh: false,
  },
  {
    id: 'web-search',
    titleKey: 'feature.web-search',
    descriptionKey: 'feature.web-search.desc',
    rows: { host: [], preset: ['tool-web'] },
    effect: 'new-session',
    needsBrowserRefresh: false,
  },
  {
    id: 'plan-mode',
    titleKey: 'feature.plan-mode',
    descriptionKey: 'feature.plan-mode.desc',
    rows: { host: [], preset: ['planning'] },
    effect: 'new-session',
    needsBrowserRefresh: false,
  },
  {
    id: 'todo',
    titleKey: 'feature.todo',
    descriptionKey: 'feature.todo.desc',
    rows: { host: [], preset: ['tool-todo'] },
    effect: 'new-session',
    needsBrowserRefresh: false,
  },
  {
    id: 'goal',
    titleKey: 'feature.goal',
    descriptionKey: 'feature.goal.desc',
    rows: { host: [], preset: ['tool-goal'] },
    effect: 'new-session',
    needsBrowserRefresh: false,
  },
  {
    id: 'dsh-plus-notify-email',
    titleKey: 'feature.dsh-plus-notify-email',
    descriptionKey: 'feature.dsh-plus-notify-email.desc',
    rows: { host: ['dsh-plus-notify-email'], preset: [] },
    effect: 'immediate',
    needsBrowserRefresh: false,
  },
  {
    id: 'dsh-plus-subagent-model',
    titleKey: 'feature.dsh-plus-subagent-model',
    descriptionKey: 'feature.dsh-plus-subagent-model.desc',
    rows: { host: ['dsh-plus-subagent-model'], preset: [] },
    effect: 'immediate',
    needsBrowserRefresh: false,
  },
  {
    id: 'dsh-plus-skill-manual',
    titleKey: 'feature.dsh-plus-skill-manual',
    descriptionKey: 'feature.dsh-plus-skill-manual.desc',
    rows: { host: ['dsh-plus-skill-manual'], preset: [] },
    effect: 'immediate',
    needsBrowserRefresh: true,
  },
  {
    id: 'dsh-plus-reload',
    titleKey: 'feature.dsh-plus-reload',
    descriptionKey: 'feature.dsh-plus-reload.desc',
    rows: { host: ['dsh-plus-reload'], preset: [] },
    effect: 'immediate',
    needsBrowserRefresh: true,
  },
  {
    id: 'dsh-plus-web-files',
    titleKey: 'feature.dsh-plus-web-files',
    descriptionKey: 'feature.dsh-plus-web-files.desc',
    rows: { host: ['dsh-plus-web-files'], preset: [] },
    effect: 'immediate',
    needsBrowserRefresh: true,
  },
  {
    id: 'dsh-plus-ui-mobile-fit',
    titleKey: 'feature.dsh-plus-ui-mobile-fit',
    descriptionKey: 'feature.dsh-plus-ui-mobile-fit.desc',
    rows: { host: ['dsh-plus-ui-mobile-fit'], preset: [] },
    effect: 'immediate',
    needsBrowserRefresh: true,
  },
  {
    id: 'dsh-plus-remote-settings',
    titleKey: 'feature.dsh-plus-remote-settings',
    descriptionKey: 'feature.dsh-plus-remote-settings.desc',
    rows: { host: ['dsh-plus-remote-settings'], preset: [] },
    effect: 'immediate',
    needsBrowserRefresh: true,
  },
]

/** 全部功能 id。 */
export const FEATURE_IDS: readonly string[] = CATALOG.map((feature) => feature.id)

/** 永不可经本插件写禁用的行 id（防御性清单，仅供测试断言与诊断）。 */
export const FORBIDDEN_ROWS: readonly string[] = [
  'llm',
  'session',
  'settings',
  'webserver',
  'api-gateway',
  'agent-presets',
  'subagent',
  'tool-subagent-report',
  'sandbox',
  'sandbox-policy',
  'approval',
  'permission',
  'tools',
  'system-prompt',
  'agent-loop',
  'dsh-plus-lifeboat',
  'dsh-plus-bundle-main',
  'dsh-plus-feature-toggle',
  'dsh-plus-llm-pi',
]

/** 按 id 查目录条目。 */
export function findFeature(id: string): FeatureDef | undefined {
  return CATALOG.find((feature) => feature.id === id)
}

/** 目录内全部 host 平面行 id 的集合。 */
export function hostRows(): Set<string> {
  const rows = new Set<string>()
  for (const feature of CATALOG) for (const row of feature.rows.host) rows.add(row)
  return rows
}

/** 目录内全部 preset 平面行 id 的集合。 */
export function presetRows(): Set<string> {
  const rows = new Set<string>()
  for (const feature of CATALOG) for (const row of feature.rows.preset) rows.add(row)
  return rows
}

/**
 * 校验期望态（features dict）合法：键必须在目录内。
 * @returns 非法键数组（空数组 = 合法）。
 */
export function invalidFeatureKeys(features: Record<string, unknown>): string[] {
  return Object.keys(features).filter((key) => findFeature(key) === undefined)
}

/**
 * 目录结构自检（构建期/测试期调用）：host 行与 preset 行不相交（同一行不可能
 * 同时受两个平面控制）；目录不得包含任何禁止行；行不得跨功能重复登记
 * （重复意味着一个开关会牵连另一个功能的行）。
 * @returns 违规描述数组（空数组 = 通过）。
 */
export function catalogViolations(): string[] {
  const violations: string[] = []
  const host = hostRows()
  const preset = presetRows()
  for (const row of host) {
    if (preset.has(row)) violations.push(`行 ${row} 同时登记在 host 与 preset 平面`)
  }
  for (const row of [...host, ...preset]) {
    if (FORBIDDEN_ROWS.includes(row)) violations.push(`行 ${row} 在禁止清单中却进入了目录`)
  }
  const seen = new Map<string, string>()
  for (const feature of CATALOG) {
    for (const row of [...feature.rows.host, ...feature.rows.preset]) {
      const owner = seen.get(row)
      if (owner !== undefined) violations.push(`行 ${row} 同时属于 ${owner} 与 ${feature.id}`)
      else seen.set(row, feature.id)
    }
  }
  return violations
}
