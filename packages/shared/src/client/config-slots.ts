/**
 * 配置卡片的三槽位注册助手。
 *
 * 背景（0.1.6-alpha.2 官方迁移）：原「设置 → 插件 → 可配置」页整体迁入独立的
 * 侧边栏「插件」页（dsh-client-ui-plugin-manager），旧 `settings.plugin.item`
 * keyed 槽位被删除，第三方配置卡片须改挂新槽位才会重新出现：
 * - `plugins.row.config`（keyed，key = `<bundle 包名>#<row id>`）：bundle 详情页
 *   对应行出现「配置」入口，行配置页渲染 `view: 'summary'`（一行简介）与
 *   `view: 'page'`（带保存控件的表单）；
 * - `plugins.bundle.config`（keyed，key = 包名）：包详情页本体配置，
 *   仅渲染 `view: 'page'`（独立安装/非 bundle 行场景）。
 *
 * 兼容性：slots.inject 对未声明槽位挂起等待（声明生命周期内生效），故同一
 * 组件注册进三个槽位互不冲突——旧 dsh 只声明 settings.plugin.item，
 * 0.1.6-alpha.2 起只声明后两个，未命中槽位天然 no-op，无需版本探测。
 *
 * @module @dsh-plus/shared/client/config-slots
 */
import type { SlotsLike } from './plugin-context.ts'

/** dsh-plus 聚合 bundle 的包名（各插件 row 均经其补丁层插入 profile）。 */
export const DSH_PLUS_BUNDLE = '@dsh-plus/bundle-main'

/**
 * 卡片组件收到的 owner prop（插件页按视图分发渲染）。
 * `summary` 只渲染一行简介（纯文本或 inline 节点）；`page` 渲染带保存控件的表单。
 * 并上 undefined：旧 settings.plugin.item 槽位不分发 view，缺席与未传等价。
 */
export interface PluginConfigViewProps {
  readonly view?: 'summary' | 'page'
}

/** injectPluginConfigCard 的一次注册描述。 */
export interface PluginConfigCardReg {
  /** 卡片编辑的 settings 命名空间（兼作旧槽位 key 与注册 locale NS）。 */
  ns: string
  /** 本插件在聚合 bundle 补丁层中的 row id（plugins.row.config key 的组成部分）。 */
  rowId: string
  /** 本插件 npm 包名（plugins.bundle.config 的 key，独立安装场景）。 */
  pkg: string
  /** 卡片组件；须自行处理 {@link PluginConfigViewProps} 的 view 分发。 */
  component: unknown
  /** 注册 inject 面（t/scope/api 等），三个槽位共用同一份。 */
  inject(): Record<string, unknown>
}

/**
 * 把一张配置卡片同时注册进 legacy 与新版三个槽位。
 * 任一槽位在当前 dsh 版本未声明时对应 inject 挂起等待，版本不命中即 no-op。
 */
export function injectPluginConfigCard(slots: SlotsLike, reg: PluginConfigCardReg): void {
  const base = { locale: reg.ns, inject: reg.inject }
  slots.inject('settings.plugin.item', () =>
    slots.register({ name: 'settings.plugin.item', key: reg.ns, ...base }, reg.component),
  )
  slots.inject('plugins.row.config', () =>
    slots.register(
      { name: 'plugins.row.config', key: `${DSH_PLUS_BUNDLE}#${reg.rowId}`, ...base },
      reg.component,
    ),
  )
  slots.inject('plugins.bundle.config', () =>
    slots.register({ name: 'plugins.bundle.config', key: reg.pkg, ...base }, reg.component),
  )
}
