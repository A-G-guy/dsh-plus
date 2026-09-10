/**
 * 卡片公共文案（zh/en）与合并助手。各插件 i18n 改为
 * mergeDict(common, own)：own 覆盖同键，公共键只维护一份。
 *
 * 键类型保真：字典用 `as const` 声明（而非 `: Dict` 标注），键因此是字面量而非
 * 宽 string；mergeDict 保留两侧键集合，各插件据此派生 `DictKey`，使 `t('...')`
 * 的键名拼写在编译期即可校验，且 `en: Record<DictKey, string>` 能强制中英键对齐。
 * @module @dsh-plus/shared/client/i18n
 */

/** 宽松字典形态（仅供泛型约束用，勿用作变量标注——会把键宽化成 string）。 */
export type Dict = Record<string, string>

/** 卡片通用文案（save/discard/unsaved/loading 等四插件共有键）。 */
export const commonZh = {
  save: '保存',
  saving: '保存中…',
  discard: '放弃',
  unsaved: '未保存',
  loading: '加载中…',
  unavailable: '配置服务不可用。',
  readOnly: '当前部署无 settings provider，配置为只读；请编辑 settings.yaml。',
  invalidNumber: '请输入正整数。',
  collapse: '收起',
  expand: '展开',
  enabledOn: '已启用',
  enabledOff: '未启用',
  saveFailed: '保存失败，请检查填写内容。',
  confirm: '确认',
  cancel: '取消',
} as const

/** 公共键集合（中英必须一致，由下方 en 的 Record 标注强制）。 */
export type CommonDictKey = keyof typeof commonZh

export const commonEn: Record<CommonDictKey, string> = {
  save: 'Save',
  saving: 'Saving…',
  discard: 'Discard',
  unsaved: 'Unsaved',
  loading: 'Loading…',
  unavailable: 'Settings service unavailable.',
  readOnly: 'No settings provider in this deployment; config is read-only. Edit settings.yaml.',
  invalidNumber: 'Enter a positive integer.',
  collapse: 'Collapse',
  expand: 'Expand',
  enabledOn: 'On',
  enabledOff: 'Off',
  saveFailed: 'Save failed; check the fields.',
  confirm: 'Confirm',
  cancel: 'Cancel',
}

/**
 * own 覆盖同键合并（返回新对象，入参不可变）。
 * 返回类型保留两侧键集合，调用方据此派生 DictKey。
 */
export function mergeDict<B extends Dict, O extends Dict>(base: B, own: O): B & O {
  return { ...base, ...own }
}
