/**
 * 卡片草稿的纯转换与校验（无 JSX，`node --test` 可直接测）。
 *
 * `cliCommand` 在配置里是 `string[]`（argv 前缀），在卡片里是空格分隔的文本——
 * 这层转换是卡片唯一容易出错的地方，因此单独成模块并逐例钉住：**不做 shell
 * 解析**，引号按字面字符处理并直接判非法，避免"看起来支持引号、实际把引号当
 * 参数一部分"的静默错配。
 * @module @dsh-plus/actual/client/draft
 */

/** CLI 与服务端版本不一致时的处置（与宿主 schema 的 union 一致）。 */
export type CliVersionPolicy = 'warn' | 'strict'

/** settings 命名空间里本卡片负责的字段（其余字段不出现在卡片中）。 */
export interface ConfigValue {
  enabled: boolean
  serverUrl: string
  syncId: string
  cliCommand: string[]
  cliVersionPolicy: CliVersionPolicy
  confirmWrites: boolean
  auxTools: boolean
  namePrefix: string
}

/** 编辑草稿：`cliCommand` 以文本承载（空格分隔的 argv）。 */
export interface Draft {
  enabled: boolean
  serverUrl: string
  syncId: string
  cliCommand: string
  cliVersionPolicy: CliVersionPolicy
  confirmWrites: boolean
  auxTools: boolean
  namePrefix: string
}

/** 校验失败的字段与文案键。 */
export interface DraftViolation {
  field: 'serverUrl' | 'cliCommand' | 'namePrefix'
  messageKey: 'serverUrlInvalid' | 'cliCommandInvalid' | 'namePrefixInvalid'
}

/** argv → 卡片文本（空格分隔）。 */
export function argvToText(argv: readonly string[]): string {
  return argv.join(' ')
}

/** 卡片文本 → argv；纯空白视为「自动探测」（空数组）。 */
export function textToArgv(text: string): string[] {
  const trimmed = text.trim()
  return trimmed === '' ? [] : trimmed.split(/\s+/)
}

/** 命名空间解析值 → 草稿。 */
export function draftFromValue(value: ConfigValue): Draft {
  return {
    enabled: value.enabled,
    serverUrl: value.serverUrl,
    syncId: value.syncId,
    cliCommand: argvToText(value.cliCommand),
    cliVersionPolicy: value.cliVersionPolicy,
    confirmWrites: value.confirmWrites,
    auxTools: value.auxTools,
    namePrefix: value.namePrefix,
  }
}

/** 草稿 → 命名空间补丁（仅本卡片负责的字段）。 */
export function patchFromDraft(draft: Draft): Record<string, unknown> {
  return {
    enabled: draft.enabled,
    serverUrl: draft.serverUrl.trim(),
    syncId: draft.syncId.trim(),
    cliCommand: textToArgv(draft.cliCommand),
    cliVersionPolicy: draft.cliVersionPolicy,
    confirmWrites: draft.confirmWrites,
    auxTools: draft.auxTools,
    namePrefix: draft.namePrefix.trim(),
  }
}

/** 首个校验问题；全部合法返回 undefined（调用方据此禁用保存）。 */
export function validateDraft(draft: Draft): DraftViolation | undefined {
  if (!/^https?:\/\/\S+$/.test(draft.serverUrl.trim())) {
    return { field: 'serverUrl', messageKey: 'serverUrlInvalid' }
  }
  if (/["']/.test(draft.cliCommand)) {
    return { field: 'cliCommand', messageKey: 'cliCommandInvalid' }
  }
  if (!/^[A-Za-z0-9_-]*$/.test(draft.namePrefix.trim())) {
    return { field: 'namePrefix', messageKey: 'namePrefixInvalid' }
  }
  return undefined
}
