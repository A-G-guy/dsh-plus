/**
 * primitives 图标集缺失的终端图标本地补齐（16 视窗、currentColor，
 * 描边风格对齐官方 outline 系）。
 * @module web-terminal/panel/icons
 */
import type { ReactElement } from 'react'

interface IconProps {
  size?: number
  className?: string
}

function base(props: IconProps): { width: number; height: number; className: string | undefined } {
  return { width: props.size ?? 16, height: props.size ?? 16, className: props.className }
}

/** 终端窗口（提示符 + 光标行）。 */
export function IconTerminalOutline16(props: IconProps): ReactElement {
  const { width, height, className } = base(props)
  return (
    <svg
      viewBox="0 0 16 16"
      width={width}
      height={height}
      className={className}
      fill="none"
      aria-hidden="true"
    >
      <rect x="1.5" y="2.5" width="13" height="11" rx="2" stroke="currentColor" />
      <path d="M4 6l2 2-2 2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 10h3.5" stroke="currentColor" strokeLinecap="round" />
    </svg>
  )
}

/** 左右分屏。 */
export function IconSplitHOutline16(props: IconProps): ReactElement {
  const { width, height, className } = base(props)
  return (
    <svg
      viewBox="0 0 16 16"
      width={width}
      height={height}
      className={className}
      fill="none"
      aria-hidden="true"
    >
      <rect x="1.5" y="2.5" width="13" height="11" rx="2" stroke="currentColor" />
      <path d="M8 2.5v11" stroke="currentColor" strokeDasharray="2 2" />
    </svg>
  )
}

/** 上下分屏。 */
export function IconSplitVOutline16(props: IconProps): ReactElement {
  const { width, height, className } = base(props)
  return (
    <svg
      viewBox="0 0 16 16"
      width={width}
      height={height}
      className={className}
      fill="none"
      aria-hidden="true"
    >
      <rect x="1.5" y="2.5" width="13" height="11" rx="2" stroke="currentColor" />
      <path d="M1.5 8h13" stroke="currentColor" strokeDasharray="2 2" />
    </svg>
  )
}

/** 单屏（聚焦当前叶）。 */
export function IconFocusOutline16(props: IconProps): ReactElement {
  const { width, height, className } = base(props)
  return (
    <svg
      viewBox="0 0 16 16"
      width={width}
      height={height}
      className={className}
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M2 5V3.5A1.5 1.5 0 0 1 3.5 2H5M11 2h1.5A1.5 1.5 0 0 1 14 3.5V5M14 11v1.5a1.5 1.5 0 0 1-1.5 1.5H11M5 14H3.5A1.5 1.5 0 0 1 2 12.5V11"
        stroke="currentColor"
        strokeLinecap="round"
      />
      <rect x="5.5" y="5.5" width="5" height="5" rx="1" stroke="currentColor" />
    </svg>
  )
}
