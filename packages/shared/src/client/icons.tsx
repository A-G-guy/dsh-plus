/**
 * 共享图标（所有 dsh-plus 插件统一入口）：
 * - 官方基元图标直接 re-export @deepseek-ai/dsh-client-ui-primitives——
 *   它是平台 seed 模块，插件构建时 external（neverBundle），运行时由外壳
 *   模块表供给单例，视觉与官方逐字一致；
 * - 官方缺失的语义（Eye/EyeOff）由 lucide-react 补齐（随插件 bundle 打入，
 *   react 保持 external 解析到外壳单例，无双实例风险）。
 *
 * 消费方 tsdown 约定：neverBundle 必须含 '@deepseek-ai/dsh-client-ui-primitives'。
 * @module @dsh-plus/shared/client/icons
 */
// 通配类型声明必须随本文件进程序：消费方经源码级打苞导入本文件时，
// 兄弟 .d.ts 不会自动成为 program 根，缺此引用则深路径导入退化为 any（TS7016）。
/// <reference path="./lucide-deep.d.ts" />
import type { LucideProps } from 'lucide-react'
// 深路径直连 ESM 单图标文件：主入口是 CJS barrel，经它导入会让打包器
// 纳入全部图标（约 1.8k 个）；深路径 + 本地通配类型声明保持 tree-shake 精确。
import Brush from 'lucide-react/dist/esm/icons/brush.mjs'
import Download from 'lucide-react/dist/esm/icons/download.mjs'
import Eye from 'lucide-react/dist/esm/icons/eye.mjs'
import EyeOff from 'lucide-react/dist/esm/icons/eye-off.mjs'
import Image from 'lucide-react/dist/esm/icons/image.mjs'
import Layers from 'lucide-react/dist/esm/icons/layers.mjs'
import Maximize from 'lucide-react/dist/esm/icons/maximize.mjs'
import Minimize from 'lucide-react/dist/esm/icons/minimize.mjs'
import Sparkles from 'lucide-react/dist/esm/icons/sparkles.mjs'
import type { ReactElement } from 'react'

export {
  IconApiOutline14,
  IconCheckOutline16,
  IconChevronDownOutline14,
  IconCloseOutline16,
  IconCopyOutline16,
  IconLoadingOutline16,
  IconPlusOutline16,
  IconRefreshOutline14,
  IconRefreshOutline16,
  IconTrashOutline16,
  IconWarningOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'

export interface IconProps {
  /** 边长（px），默认 14（对齐官方 Outline14 规格）。 */
  size?: number
  className?: string
}

/** 历史别名：官方 IconChevronDownOutline14（早期版本曾内联同 path，现直连官方）。 */
export { IconChevronDownOutline14 as ChevronDownIcon } from '@deepseek-ai/dsh-client-ui-primitives'

function lucideProps(props: IconProps): LucideProps {
  return { size: props.size ?? 14, className: props.className, 'aria-hidden': true }
}

/** 可见（注入生效）语义——官方基元无 Eye 系，lucide 补齐。 */
export function IconEye(props: IconProps): ReactElement {
  return <Eye {...lucideProps(props)} />
}

/** 已屏蔽（本会话/全局不注入）语义。 */
export function IconEyeOff(props: IconProps): ReactElement {
  return <EyeOff {...lucideProps(props)} />
}

/** 进入全屏语义——官方基元无全屏系，lucide 补齐（面板工具栏/头部通用）。 */
export function IconFullscreen(props: IconProps): ReactElement {
  return <Maximize {...lucideProps(props)} />
}

/** 退出全屏语义。 */
export function IconFullscreenExit(props: IconProps): ReactElement {
  return <Minimize {...lucideProps(props)} />
}

/** 单图语义（图像工作室入口/画廊标签）。 */
export function IconImage(props: IconProps): ReactElement {
  return <Image {...lucideProps(props)} />
}

/** 文生图（灵感/生成）语义。 */
export function IconSparkles(props: IconProps): ReactElement {
  return <Sparkles {...lucideProps(props)} />
}

/** 图生图（画笔编辑）语义。 */
export function IconBrush(props: IconProps): ReactElement {
  return <Brush {...lucideProps(props)} />
}

/** 下载语义（画廊条目导出）。 */
export function IconDownload(props: IconProps): ReactElement {
  return <Download {...lucideProps(props)} />
}

/** 叠加/源图语义（二次编辑、源图选择）。 */
export function IconLayers(props: IconProps): ReactElement {
  return <Layers {...lucideProps(props)} />
}
