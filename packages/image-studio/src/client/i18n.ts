/**
 * i18n 字典（zh 为主，en 兜底）；NS 与 settings 命名空间分离，
 * 仅承载前端文案 key。本次只含占位文案。
 * @module image-studio/client/i18n
 */

/** locale 命名空间。 */
export const NS = 'dsh-plus-image-studio'

export const zh = {
  nav: '图像工作室',
  placeholder: '生图工作台与画廊将在后续版本提供',
  cardPlaceholder: '图像工作室配置（预设/凭据管理将在后续版本提供）',
}

export const en = {
  nav: 'Image Studio',
  placeholder: 'Image workspace and gallery arrive in a later release',
  cardPlaceholder: 'Image Studio settings (preset/credential management arrives later)',
}
