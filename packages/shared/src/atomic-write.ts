/**
 * 原子写助手：内容写委托官方 `@deepseek-ai/dsh-atomic-write` 的 `writeFileAtomic`
 * （Windows 下 EACCES/EBUSY/EPERM 瞬态 rename 有界重试、wx 独占临时文件、
 * symlink 防护、按显式 mode 收窄权限）——不重复实现官方已有能力。
 * {@link commitTmpFile} 覆盖官方不支持的「已有 tmp 提交」形态：流式落盘
 * （如上传字节）之后的 rename 提交，失败时回退复制确保数据落地。
 * @module @dsh-plus/shared/atomic-write
 */

import { copyFile, rename, rm } from 'node:fs/promises'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

/** 插件数据文件（journal/prefs/index 等）的替换模式：用户私有。 */
export const PLUGIN_DATA_FILE_MODE = 0o600

/** 用户内容文件（面板编辑产物等）的替换模式：等价 writeFile 默认 0o666。 */
export const USER_FILE_MODE = 0o666

/** {@link commitTmpFile} 的注入面（单测可替换失败路径）。 */
export interface AtomicWriteIo {
  rename: typeof rename
  copyFile: typeof copyFile
  rm: typeof rm
}

const realIo: AtomicWriteIo = { rename, copyFile, rm }

/**
 * 提交已落盘的 tmp 文件：先 rename，失败时回退复制再清理 tmp；
 * 双双失败时记录两条 errno 上下文后抛出【rename 错误】（errno 语义对
 * toFilesError / HTTP 映射保持不变）。
 */
export async function commitTmpFile(
  tmp: string,
  target: string,
  io: AtomicWriteIo = realIo,
): Promise<void> {
  try {
    await io.rename(tmp, target)
  } catch (renameError) {
    try {
      await io.copyFile(tmp, target)
      await io.rm(tmp, { force: true })
      const message = renameError instanceof Error ? renameError.message : String(renameError)
      console.warn(
        `[dsh-plus] 原子替换 rename 失败，已回退复制落地：${message}（target=${target}）`,
      )
    } catch (copyError) {
      const renameMessage = renameError instanceof Error ? renameError.message : String(renameError)
      const copyMessage = copyError instanceof Error ? copyError.message : String(copyError)
      console.warn(
        `[dsh-plus] 原子替换 rename 与复制均失败：rename=${renameMessage} copy=${copyMessage}（target=${target}）`,
      )
      // 保留 rename 的 errno（宿主注入文件系统期望按 EPERM/EXDEV 等分类）。
      throw renameError
    }
  }
}

/**
 * 内容原子写（委托官方实现）：创建父目录，读者只见旧或新完整内容。
 * @param target 目标文件路径。
 * @param data 完整内容（官方 API 仅接受字符串）。
 * @param mode 替换 inode 的权限位（默认 {@link PLUGIN_DATA_FILE_MODE}）。
 */
export async function atomicWriteFile(
  target: string,
  data: string,
  mode: number = PLUGIN_DATA_FILE_MODE,
): Promise<void> {
  await writeFileAtomic(target, data, { mode })
}
