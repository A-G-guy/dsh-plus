/**
 * 进程内重载核心：把磁盘上的 profile 组合层重新读出，对账进运行中的 Loader 树。
 * 上游语义下的覆盖范围：行启停与行配置、组合包（bundle）选择、settings
 * （经 `app-boot/config-reload` 失效缓存）、新增条目的首次导入。
 * 不覆盖：已安装包位于 `node_modules` 内的代码替换——dsh-hmr 的依赖遍历对
 * `/node_modules/` 路径直接返回空集，模块替换被跳过；那类变更由 fingerprint
 * 报告为「需重启」，本模块不尝试绕过。
 * 依赖全部注入，测试零副作用；cordis 接线见 index.ts。
 * @module reload/inprocess
 */

/** 进程内重载的能力位（逐项决定可用性与降级方式）。 */
export interface InProcessCapabilities {
  /** dsh 启动器提供的 profile 上下文；缺席即无从重放组合层。 */
  profile: boolean
  /** dsh-hmr 服务：提供与自动热重载共用的串行队列。 */
  hmr: boolean
  /** pluginPackages 服务：安装/移除插件后刷新运行时包解析表。 */
  pluginPackages: boolean
}

export type InProcessOutcome =
  | { kind: 'unsupported'; reasons: string[] }
  | { kind: 'applied'; warnings: string[] }
  | { kind: 'failed'; message: string }

export interface InProcessDeps<Patches> {
  capabilities: InProcessCapabilities
  /** 刷新包解析表；缺席表示无该能力，失败只降级为 warning。 */
  refreshPackages: (() => Promise<void>) | undefined
  /** 从磁盘重建完整 patch 列表（组合包层 + profile 补丁 + home 补丁 + 覆盖层）。 */
  readPatches: () => Patches
  /** 把 patch 列表对账进 Loader 树；resolve 为既有 inactive 诊断，reject 为致命诊断。 */
  reconcile: (patches: Patches) => Promise<string[]>
  /** 与模块替换/配置变更共用的串行队列（`hmr.runExclusive`）；缺席时直接执行。 */
  exclusive: (<T>(operation: () => Promise<T>) => Promise<T>) | undefined
}

/** 错误值的可读文本（诊断面统一口径）。 */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 能力判定：缺 profile 上下文时无从重放组合层，直接拒绝并给替代路径。 */
export function unsupportedReasons(capabilities: InProcessCapabilities): string[] {
  if (capabilities.profile) return []
  return [
    '当前进程没有 profile 上下文（非 dsh profile 启动），无法重放 profile 组合层',
    '请改用 /reload restart（systemd 通道）或人工重启宿主进程',
  ]
}

/**
 * 执行一次进程内重载。
 * @param deps - 注入的能力位与读写端口。
 * @returns applied（附既有 inactive 诊断）/ unsupported / failed 三态。
 */
export async function runInProcessReload<Patches>(
  deps: InProcessDeps<Patches>,
): Promise<InProcessOutcome> {
  const reasons = unsupportedReasons(deps.capabilities)
  if (reasons.length > 0) return { kind: 'unsupported', reasons }

  const apply = async (): Promise<string[]> => {
    const warnings: string[] = []
    if (deps.refreshPackages !== undefined) {
      try {
        await deps.refreshPackages()
      } catch (error) {
        // 包解析表刷新失败只影响新装包的解析，不阻塞已装行的对账。
        warnings.push(`包解析表刷新失败：${messageOf(error)}`)
      }
    }
    return [...warnings, ...(await deps.reconcile(deps.readPatches()))]
  }

  try {
    const warnings = deps.exclusive === undefined ? await apply() : await deps.exclusive(apply)
    return { kind: 'applied', warnings }
  } catch (error) {
    return { kind: 'failed', message: messageOf(error) }
  }
}
