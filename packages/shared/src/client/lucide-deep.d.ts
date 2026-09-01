/**
 * lucide-react 深路径图标的通配类型声明（包无 per-icon d.ts，见 icons.tsx 注释）。
 * @module @dsh-plus/shared/client
 */
declare module 'lucide-react/dist/esm/icons/*.mjs' {
  import type { LucideIcon } from 'lucide-react'

  const icon: LucideIcon
  export default icon
}
