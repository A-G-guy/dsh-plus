/**
 * 插件数据目录规范：缓存、日志、复杂文件等非配置数据的统一落点。
 *
 * 布局：`$DSH_HOME/dsh-plus/<plugin-id>/...`。
 * 纯用户配置一律走 dsh-settings 官方接口，密钥一律走 dsh-credentials
 * 官方接口；本模块仅承载非配置数据。不做旧数据兼容与自动迁移。
 * @module @dsh-plus/shared/plugin-data
 */

import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'

import { atomicWriteFile } from './atomic-write.ts'

/** dsh-plus 插件数据在 DSH HOME 下的顶层目录名。 */
export const PLUGIN_DATA_ROOT = 'dsh-plus'

/**
 * 解析插件数据目录下某文件的绝对路径。
 * @param pluginId - 插件标识，同时作为目录名，须为单段安全路径。
 * @param segments - 目录内相对路径段。
 * @returns 绝对路径。
 */
export function pluginDataPath(pluginId: string, ...segments: string[]): string {
  validatePluginId(pluginId)
  for (const seg of segments) {
    if (seg.includes('/') || seg.includes('\\') || seg === '.' || seg === '..') {
      throw new Error(`invalid plugin data path segment: ${JSON.stringify(seg)}`)
    }
  }
  return dshHomePath(PLUGIN_DATA_ROOT, pluginId, ...segments)
}

/** 解析插件数据目录本身（`$DSH_HOME/dsh-plus/<pluginId>`）。 */
export function pluginDataDir(pluginId: string): string {
  return dirname(pluginDataPath(pluginId, 'x'))
}

/** 确保插件数据目录存在（递归创建）。 */
export async function ensurePluginDataDir(pluginId: string): Promise<string> {
  const dir = pluginDataDir(pluginId)
  await mkdir(dir, { recursive: true })
  return dir
}

/**
 * 原子写文件（委托官方 dsh-atomic-write writeFileAtomic：Windows 瞬态重试 +
 * 0o600 权限收窄，父目录自动创建），避免中断产生半截文件。
 * @returns 最终文件绝对路径。
 */
export async function writePluginDataFile(
  pluginId: string,
  fileName: string,
  data: string,
): Promise<string> {
  const target = pluginDataPath(pluginId, fileName)
  await atomicWriteFile(target, data)
  return target
}

function validatePluginId(pluginId: string): void {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(pluginId)) {
    throw new Error(`invalid plugin id for data directory: ${JSON.stringify(pluginId)}`)
  }
}
