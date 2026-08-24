/**
 * 本地补充图标：primitives 图标集缺失的 upload / home。
 * 视觉语言对齐官方图标（16 视窗、currentColor 填充、相近线重）。
 * @module @dsh-plus/web-files/panel/icons
 */

export interface LocalIconProps {
  size?: number
  className?: string
}

/** 上传：托盘（沿用官方 download 托盘几何）+ 向上箭头。 */
export function IconUpload16({ size = 16, className }: LocalIconProps) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M8.7 10.5V4L11.3 6.6L12.3 5.6L8 1.3L3.7 5.6L4.7 6.6L7.3 4V10.5H8.7Z"
        fill="currentColor"
      />
      <path
        d="M15.3695 11.411L15.1234 12.8866C14.8869 14.3042 13.6603 15.3436 12.223 15.3436H3.77673C2.33958 15.3434 1.1128 14.3042 0.876343 12.8866L0.630249 11.411L2.05408 11.1747L2.29919 12.6493C2.41973 13.3713 3.04475 13.9001 3.77673 13.9003H12.223C12.9551 13.9002 13.58 13.3713 13.7006 12.6493L13.9457 11.1747L15.3695 11.411Z"
        fill="currentColor"
      />
    </svg>
  )
}

/** 主目录：房屋轮廓（含门洞）。 */
export function IconHome16({ size = 16, className }: LocalIconProps) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M8.87 1.57a1.25 1.25 0 0 0-1.74 0L1.6 6.6c-.44.46-.1 1.15.57 1.15h.36v5.7c0 .86.7 1.55 1.55 1.55h7.84c.86 0 1.55-.7 1.55-1.55v-5.7h.36c.67 0 1.01-.7.57-1.15L8.87 1.57ZM6.5 15v-3.8c0-.61.49-1.1 1.1-1.1h.8c.61 0 1.1.49 1.1 1.1V15h-3Z"
        fill="currentColor"
      />
    </svg>
  )
}

/** 排序：双向竖箭头。 */
export function IconSort16({ size = 16, className }: LocalIconProps) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M5 2.2L7.4 5.9H5.7V13.8H4.3V5.9H2.6L5 2.2ZM11 13.8L8.6 10.1H10.3V2.2H11.7V10.1H13.4L11 13.8Z"
        fill="currentColor"
      />
    </svg>
  )
}
