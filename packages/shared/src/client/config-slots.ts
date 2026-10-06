/**
 * 配置卡片的槽位注册助手（目标宿主：dsh 0.2.1-alpha.1）。
 *
 * 官方插件页（`dsh-client-ui-plugin-manager`）为第三方配置视图声明两个 keyed 槽位：
 * - `plugins.row.config`（key = `<bundle 包名>#<row id>`）：bundle 详情页对应行出现
 *   「配置」入口，行配置页渲染 `view: 'summary'`（一行简介）与 `view: 'page'`
 *   （带保存控件的表单）；
 * - `plugins.bundle.config`（key = 包名）：包详情页本体配置，仅渲染 `view: 'page'`。
 *
 * 页面自己画标题、图标、面包屑与页面级内边距（`detailSections` 内无边框容器），
 * 故 page 视图输出无边框分节（见 card.tsx），summary 视图只返回一行文本。
 * 旧 `settings.plugin.item` 槽位已随官方插件页迁移删除，不再注册。
 *
 * @module @dsh-plus/shared/client/config-slots
 */
import type { SlotsLike } from './plugin-context.ts'

/** dsh-plus 聚合 bundle 的包名（各插件 row 均经其补丁层插入 profile）。 */
export const DSH_PLUS_BUNDLE = '@dsh-plus/bundle-main'

/**
 * 卡片组件收到的 owner prop（插件页按视图分发渲染）。
 * `summary` 只渲染一行简介（纯文本或 inline 节点）；`page` 渲染带保存控件的表单。
 */
export interface PluginConfigViewProps {
  readonly view: 'summary' | 'page'
}

/** injectPluginConfigCard 的一次注册描述。 */
export interface PluginConfigCardReg {
  /** 卡片编辑的 settings 命名空间（兼作 locale 注册 NS）。 */
  ns: string
  /** 本插件在聚合 bundle 补丁层中的 row id（plugins.row.config key 的组成部分）。 */
  rowId: string
  /** 本插件 npm 包名（plugins.bundle.config 的 key）。 */
  pkg: string
  /** 卡片组件；须自行处理 {@link PluginConfigViewProps} 的 view 分发。 */
  component: unknown
  /** 注册 inject 面（t/scope/api 等），两个槽位共用同一份。 */
  inject(): Record<string, unknown>
}

/**
 * 把一张配置卡片注册进插件页的两个配置槽位。
 * 两个槽位都由 0.2.1-alpha.1 的插件页声明，任一缺席即报错——不做版本探测。
 */
export function injectPluginConfigCard(slots: SlotsLike, reg: PluginConfigCardReg): void {
  const base = { locale: reg.ns, inject: reg.inject }
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
