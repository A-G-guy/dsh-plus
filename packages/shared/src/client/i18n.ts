/**
 * 卡片公共文案（zh/en）与合并助手。各插件 i18n 改为
 * mergeDict(common, own)：own 覆盖同键，公共键只维护一份。
 * @module @dsh-plus/shared/client/i18n
 */

export type Dict = Record<string, string>

/** 卡片通用文案（save/discard/unsaved/loading 等四插件共有键）。 */
export const commonZh: Dict = {
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
}

export const commonEn: Dict = {
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

/** own 覆盖同键合并（返回新对象，入参不可变）。 */
export function mergeDict(base: Dict, own: Dict): Dict {
  return { ...base, ...own }
}
