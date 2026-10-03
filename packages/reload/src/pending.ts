/**
 * 「待重启」检测接线：启动时采集 profile 直接依赖的产物指纹基线，之后按需
 * 重新采集并给出差异，用于报告「位于 node_modules、只能重启生效」的包。
 * 采集/比对失败一律降级为空清单并上报日志——它是诊断能力，不能阻塞重载。
 * @module reload/pending
 */
import { readProfileManifest } from '@deepseek-ai/dsh-app-boot'

import {
  captureFingerprints,
  diffFingerprints,
  type Fingerprints,
  systemArtifacts,
} from './fingerprint.ts'
import { messageOf } from './inprocess.ts'

export interface PendingRestartDeps {
  /** 启动器名（profile manifest 读取与诊断前缀）。 */
  binName: string
  /** profile 根目录；缺席即关闭该能力（支持文件里显示为不可用）。 */
  profileDir: string | undefined
  /** 采集/比对开关（行级配置）。 */
  enabled: boolean
  /** 诊断出口（失败不抛出，只记一行）。 */
  onError: (message: string) => void
}

export interface PendingRestart {
  /** 启动后被改动、只能重启生效的包名（升序）；能力关闭或失败时为空数组。 */
  changed: () => Promise<string[]>
}

/** 读取 profile 直接依赖名（去重排序由 captureFingerprints 负责）。 */
function dependencyNames(binName: string, profileDir: string): string[] {
  const manifest = readProfileManifest(binName, profileDir)
  return Object.keys(manifest.dependencies ?? {})
}

/**
 * 建立待重启检测：基线采集在调用时立即发起（异步），后续比对复用同一基线。
 * @param deps - 注入的路径、开关与诊断出口。
 * @returns 仅含 `changed()` 的检测句柄。
 */
export function createPendingRestart(deps: PendingRestartDeps): PendingRestart {
  const { binName, profileDir, enabled, onError } = deps
  const baseline: Promise<Fingerprints | undefined> = (async () => {
    if (profileDir === undefined || !enabled) return undefined
    try {
      const names = dependencyNames(binName, profileDir)
      return names.length === 0
        ? undefined
        : await captureFingerprints(profileDir, names, systemArtifacts)
    } catch (error) {
      onError(`产物指纹基线采集失败（待重启检测关闭）: ${messageOf(error)}`)
      return undefined
    }
  })()

  return {
    changed: async () => {
      const before = await baseline
      if (before === undefined || profileDir === undefined) return []
      try {
        const after = await captureFingerprints(
          profileDir,
          dependencyNames(binName, profileDir),
          systemArtifacts,
        )
        return diffFingerprints(before, after)
      } catch (error) {
        onError(`产物指纹比对失败（本次不报告待重启清单）: ${messageOf(error)}`)
        return []
      }
    },
  }
}
