/**
 * CodeMirror 主题：全部颜色引用 --dsw-* 设计令牌，深浅色主题切换零成本
 * （令牌值由 dsh 主题插件运行时注入）。
 * @module @dsh-plus/web-files/panel/cm-theme
 */
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { tags } from '@lezer/highlight'

/** 编辑器外观（背景、行号、光标、选区）。 */
export const dswEditorTheme = EditorView.theme({
  '&': {
    backgroundColor: 'transparent',
    color: 'var(--dsw-alias-label-primary, #1f2328)',
    height: '100%',
    fontSize: '13px',
  },
  '.cm-content': {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
    caretColor: 'var(--dsw-alias-brand-primary, #4d6bfe)',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--dsw-alias-label-primary, #1f2328)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--dsw-alias-bg-layer-1, #f6f8fa)',
    color: 'var(--dsw-alias-label-tertiary, #8b949e)',
    border: 'none',
    borderRight: '1px solid var(--dsw-alias-border-l1, #e5e7eb)',
  },
  '.cm-activeLine': {
    backgroundColor: 'var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.04))',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
    color: 'var(--dsw-alias-label-secondary, #57606a)',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'var(--dsw-alias-interactive-bg-active, rgba(77,107,254,0.18))',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-selectionMatch': {
    backgroundColor: 'var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.06))',
  },
})

/** 语法高亮：映射到语义状态令牌。 */
const dswHighlightStyle = HighlightStyle.define([
  {
    tag: [tags.keyword, tags.modifier, tags.controlKeyword],
    color: 'var(--dsw-alias-brand-primary, #4d6bfe)',
  },
  {
    tag: [tags.string, tags.special(tags.string), tags.regexp],
    color: 'var(--dsw-alias-state-success-primary, #1a7f37)',
  },
  {
    tag: [tags.comment, tags.blockComment],
    color: 'var(--dsw-alias-label-tertiary, #8b949e)',
    fontStyle: 'italic',
  },
  {
    tag: [tags.number, tags.bool, tags.null, tags.atom],
    color: 'var(--dsw-alias-state-warn-primary, #9a6700)',
  },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    color: 'var(--dsw-alias-state-business-primary, #8250df)',
  },
  {
    tag: [tags.typeName, tags.className, tags.tagName],
    color: 'var(--dsw-alias-state-error-primary, #cf222e)',
  },
  {
    tag: [tags.propertyName, tags.attributeName],
    color: 'var(--dsw-alias-label-secondary, #57606a)',
  },
  {
    tag: [tags.operator, tags.punctuation, tags.separator],
    color: 'var(--dsw-alias-label-secondary, #57606a)',
  },
  { tag: tags.heading, fontWeight: 'bold' },
  { tag: tags.link, textDecoration: 'underline' },
  { tag: tags.invalid, color: 'var(--dsw-alias-state-error-primary, #cf222e)' },
])

export const dswHighlight = syntaxHighlighting(dswHighlightStyle)
