/**
 * shared 的浏览器半（client）套件：settings 卡片基础件收编。
 * 各插件经 `@dsh-plus/shared/client` 子路径源码级消费（构建时打苞进各插件
 * client bundle；react 由各插件 tsdown external 保持外壳 ModuleLoader 提供）。
 * 主入口（`.`）仍是 node 半纯函数库，互不影响。
 * @module @dsh-plus/shared/client
 */

export {
  type CardAction,
  CardChrome,
  type CardChromeProps,
  type CardStatusState,
  IDLE_STATUS,
} from './card.tsx'
export { getJson, postJson } from './fetch.ts'
export { CheckRow, SelectField, type SelectOption, TextField } from './fields.tsx'
export { commonEn, commonZh, type Dict, mergeDict } from './i18n.ts'
export { ChevronDownIcon, type IconProps } from './icons.tsx'
export {
  createNamespaceApi,
  createSettingsScope,
  type NamespaceSettingsApi,
  type Scope,
  type ScopeHostContext,
  type ScopeSnapshot,
  type SettingsDescribeViewLike,
  type SettingsRemoteFace,
} from './scope.ts'
export { cardCss, injectCardStyle } from './styles.ts'
