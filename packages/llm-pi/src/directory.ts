/**
 * 可配置 provider 目录注册：条目组装与冲突降级。
 *
 * 官方 `registerConfigurableProviders`/`replace` 的拒绝语义是原子的——任一条目
 * 与既有声明冲突（典型：route 名撞官方内置 provider 目录条目，如 anthropic）则
 * 整批不落盘。此处按 registerAdapter 同款降级模式：逐个剔除冲突条目重试，
 * 让其余 route 的目录条目照常生效。
 * @module llm-pi/directory
 */
import { hasBuiltinProvider } from './catalog/builtin.ts'
import type { ResolvedDeepseekRoute } from './profiles-deepseek.ts'
import type { DshKit } from './resolve-dsh.ts'

/** 一条可配置 provider 目录条目（registerConfigurableProviders 的入参形状）。 */
export interface DirectoryEntry {
  provider: string
  displayName: string
  settingsNs: string
  settingsPath: string[]
  declared: boolean
}

/** 组装当前全部 route 的目录条目（pi + deepseek 两族）。 */
export function buildDirectoryEntries(
  kit: DshKit,
  settingsNs: string,
  piProfiles: Map<string, { displayName: string }>,
  deepseekRoutes: Map<string, ResolvedDeepseekRoute>,
): DirectoryEntry[] {
  const piEntries = [...piProfiles.entries()].map(([provider, profile]) => ({
    provider,
    displayName: profile.displayName,
    settingsNs,
    settingsPath: ['providers', provider],
    declared: !hasBuiltinProvider(kit, provider),
  }))
  const deepseekEntries = [...deepseekRoutes.values()].map((built) => ({
    provider: built.route,
    displayName: built.displayName,
    settingsNs,
    settingsPath: ['providers', built.route],
    declared: true,
  }))
  return [...piEntries, ...deepseekEntries]
}

/**
 * 提交目录条目；整批被原子拒绝时逐个剔除冲突条目重试（每轮至多剔一个，
 * 轮数不超过条目数，必然终止）。非冲突错误原样上抛。
 */
export function commitDirectory(
  register: (entries: DirectoryEntry[]) => void,
  entries: DirectoryEntry[],
  warn: (message: string) => void,
): void {
  let rest = entries
  for (let attempts = 0; attempts <= entries.length; attempts++) {
    try {
      register(rest)
      return
    } catch (error) {
      const match = /configurable provider "([^"]+)" is already declared/.exec(
        error instanceof Error ? error.message : String(error),
      )
      const next = match === null ? [] : rest.filter((entry) => entry.provider !== match[1])
      if (match === null || next.length === rest.length) throw error
      warn(
        `llm-pi: 目录条目 "${match[1]}" 与既有声明冲突（通常为官方内置 provider 目录），已跳过该条目`,
      )
      rest = next
    }
  }
}
