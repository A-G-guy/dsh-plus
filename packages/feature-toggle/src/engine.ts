/**
 * 调和引擎（cordis Service）。
 *
 * 职责：
 * 1. 监听期望态变化（settings ns watch）→ 规划 → 顺序执行写入
 *    （patch 文件 / 托管预设）→ 验证 → 健康监视窗口 → 异常自动回退备份。
 * 2. 托管预设生命周期：ensure（copy 源预设 + 重放期望态）/ teardown
 *    （清标记 + 还原 default 指针 + remove 目录）。
 * 3. 状态快照（state-api 与卡片经 HTTP 轮询）。
 *
 * 安全边界：
 * - 封闭目录校验在 patch-file / preset-file 写入前执行（非法 id 抛错）。
 * - 所有写入先备份（.feature-toggle.bak）后原子落盘；验证失败或健康窗口
 *   内出现非目标行 FAILED → 恢复备份热回滚。
 * - lifeboat 隔离的插件：启用请求拒绝（journal 记录）。
 * @module feature-toggle/engine
 */
import { copyFile } from 'node:fs/promises'
import { join } from 'node:path'

import { Context, Service } from '@deepseek-ai/cordis'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import z from '@deepseek-ai/schemastery'

import { findFeature, invalidFeatureKeys } from './catalog.ts'
import { type FeatureToggleConfig, SETTINGS_NS } from './config.ts'
import { Journal } from './journal.ts'
import { readQuarantined } from './lifeboat-bridge.ts'
import { MANAGED_PRESET_ID } from './ns.ts'
import type { PatchClassification } from './patch-file.ts'
import { backupPath, classifyPatchFile, syncManagedEntries } from './patch-file.ts'
import type { PresetFileState } from './preset-file.ts'
import { readPresetFile, syncPresetRows } from './preset-file.ts'
import { desiredRows, needsManagedPreset, plan } from './reconcile.ts'

/** Runtime mirror: FiberState.FAILED（cordis 跨包 const enum，官方 inventory 同款做法）。 */
const FIBER_FAILED = 3

/** settings ns 的 schema（features dict；键集合在引擎层经 catalog 封闭校验）。 */
const FeaturesSchema = z.object({
  features: z.dict(z.boolean()).description('功能开关期望态（键必须 ∈ 目录）').default({}),
})

/** agentPresets 服务最小面（官方 dsh-agent-presets 的窄投影）。 */
interface AgentPresetsLike {
  list(): Promise<Array<{ id: string; trust?: string; broken?: string; path?: string }>>
  copy(from: string, id: string, name?: string): Promise<void>
  remove(id: string): Promise<void>
  defaultId: string
}

/** settings 服务最小面。 */
interface SettingsLike {
  register(
    ns: unknown,
    schema: unknown,
    options?: unknown,
  ): {
    get(): unknown
    watch(listener: () => void): () => void
    update(patch: unknown): Promise<void>
  }
  get(ns: unknown): unknown
  mutate(
    ns: unknown,
    ops: Array<{ op: 'set' | 'unset'; path: string[]; value?: unknown }>,
  ): Promise<void>
}

/** 托管预设 default 指针状态。 */
export interface PresetPointerState {
  /** 托管预设是否存在。 */
  exists: boolean
  /** 当前 agent-presets default 指向的预设 id。 */
  defaultId: string | null
  /** default 是否指向托管预设。 */
  isDefault: boolean
  /** 托管预设是否 broken（agentPresets.list 的 reason）。 */
  broken: string | null
  /** 源预设 id。 */
  sourcePresetId: string
}

/** 对外状态快照（state-api GET / 卡片显示）。 */
export interface EngineState {
  /** 期望态（settings ns 解析值）。 */
  features: Record<string, boolean>
  /** 各功能生效状态。 */
  effects: Record<
    string,
    {
      /** 期望启用与否。 */
      desired: boolean
      /** 文件态是否已与期望一致。 */
      applied: boolean
      /** 生效方式。 */
      effect: 'immediate' | 'new-session'
      needsBrowserRefresh: boolean
    }
  >
  preset: PresetPointerState
  /** 是否存在待重启才生效的变更（热应用失败时置位）。 */
  pendingRestart: boolean
  /** 最近 journal（时间正序）。 */
  journal: ReadonlyArray<{ at: string; kind: string; detail: string }>
  /** lifeboat 当前隔离集合（诊断显示）。 */
  quarantined: string[]
}

/** 引擎可注入依赖（测试替身用）。 */
export interface EngineDeps {
  presetDir?: string
  now?: () => number
}

export class FeatureToggleEngine extends Service {
  static [Context.inject] = ['settings', 'loader']

  private config: FeatureToggleConfig
  private journal = new Journal()
  private deps: EngineDeps
  private pendingRestartFlag = false
  private desired: Record<string, boolean> = {}
  private scope: { get(): unknown; watch(listener: () => void): () => void } | undefined
  private applying = false
  private disposed = false
  /** 健康窗口内观察到的非目标行 FAILED。 */
  private healthFailures = new Set<string>()
  private healthWatcherOff: (() => void) | undefined
  /** agentPresets 服务（可选注入：缺席时 preset 平面降级）。 */
  private presetsService: AgentPresetsLike | undefined

  constructor(ctx: Context, config: FeatureToggleConfig, deps: EngineDeps = {}) {
    super(ctx, 'featureToggle')
    this.config = config
    this.deps = deps
    this.install()
  }

  /** 装配（构造期，notify-email 同款模式）：settings ns 注册 + watch + 首轮调和。 */
  private install(): void {
    // agentPresets 可选注入：缺席时 preset 平面降级（host 平面不受影响）。
    this.ctx.inject(['agentPresets' as never], (presetCtx) => {
      this.presetsService = (
        presetCtx as unknown as { agentPresets: AgentPresetsLike }
      ).agentPresets
      return () => {
        this.presetsService = undefined
      }
    })
    const settings = this.settings()
    try {
      this.scope = settings.register(SETTINGS_NS, FeaturesSchema, {
        base: { features: {} },
      }) as {
        get(): unknown
        watch(listener: () => void): () => void
      }
      this.desired = this.readDesired()
      this.scope.watch(() => {
        if (this.disposed) return
        const next = this.readDesired()
        if (JSON.stringify(next) === JSON.stringify(this.desired)) return
        this.desired = next
        void this.apply()
      })
    } catch (error) {
      this.warn('settings 命名空间注册失败，功能开关退化为行级 config', error)
      this.desired = {}
    }
    // host 侧 fiber FAILED 监听（lifeboat 同款 internal/status）
    this.healthWatcherOff = this.ctx.root.on(
      'internal/status',
      (fiber: { state: number; name: string }) => {
        if (fiber.state !== FIBER_FAILED) return
        this.healthFailures.add(fiber.name)
      },
    ) as unknown as () => void
    this.ctx.effect(
      () => () => {
        this.disposed = true
        this.healthWatcherOff?.()
      },
      'feature-toggle: lifecycle',
    )
    void this.apply()
  }

  /** 托管预设目录。 */
  private presetDir(): string {
    return this.deps.presetDir ?? dshHomePath('.agent-presets', MANAGED_PRESET_ID)
  }

  private presetFile(): string {
    return join(this.presetDir(), 'agent.cordis.yml')
  }

  private patchFile(): string {
    return this.config.patchFile.length > 0
      ? this.config.patchFile
      : dshHomePath('profiles', 'web', 'cordis.patch.yml')
  }

  /** settings 服务最小面。 */
  private settings(): SettingsLike {
    return (this.ctx as unknown as { settings: SettingsLike }).settings
  }

  /** agentPresets 服务最小面（可选注入：缺席时 preset 平面降级）。 */
  private presets(): AgentPresetsLike | undefined {
    return this.presetsService
  }

  /** 读取期望态（settings 解析值；注册失败时空）。 */
  private readDesired(): Record<string, boolean> {
    if (this.scope === undefined) return {}
    try {
      const value = this.scope.get() as { features?: unknown } | undefined
      const features = value?.features
      if (features === null || typeof features !== 'object' || Array.isArray(features)) return {}
      const result: Record<string, boolean> = {}
      for (const [key, enabled] of Object.entries(features as Record<string, unknown>)) {
        if (typeof enabled === 'boolean') result[key] = enabled
      }
      return result
    } catch {
      return {}
    }
  }

  /** 当前期望态副本（外部只读访问）。 */
  currentDesired(): Record<string, boolean> {
    return { ...this.desired }
  }

  /** 状态快照。 */
  async state(): Promise<EngineState> {
    const effects: EngineState['effects'] = {}
    let patchManaged = new Set<string>()
    let presetDisabled = new Set<string>()
    try {
      const classified = await classifyPatchFile(this.patchFile())
      patchManaged = new Set(classified.managed.map((e) => e.id as string))
    } catch {
      /* 文件不可读时按未知处理 */
    }
    try {
      const preset = await readPresetFile(this.presetFile())
      presetDisabled = new Set([...preset.disabled.entries()].filter(([, v]) => v).map(([k]) => k))
    } catch {
      /* 同上 */
    }
    for (const feature of Object.keys(this.desired)) {
      const def = findFeature(feature)
      if (def === undefined) continue
      const desiredEnabled = this.desired[feature] !== false
      const hostOk = def.rows.host.every((row) => desiredEnabled === !patchManaged.has(row))
      const presetOk = def.rows.preset.every((row) => desiredEnabled === !presetDisabled.has(row))
      effects[feature] = {
        desired: desiredEnabled,
        applied: hostOk && presetOk,
        effect: def.effect,
        needsBrowserRefresh: def.needsBrowserRefresh,
      }
    }
    return {
      features: this.currentDesired(),
      effects,
      preset: await this.presetState(),
      pendingRestart: this.pendingRestartFlag,
      journal: [...this.journal.recent()],
      quarantined: [...readQuarantined(this.ctx)],
    }
  }

  /** 托管预设指针状态。 */
  private async presetState(): Promise<PresetPointerState> {
    const presets = this.presets()
    if (presets === undefined) {
      return {
        exists: false,
        defaultId: null,
        isDefault: false,
        broken: null,
        sourcePresetId: this.config.sourcePresetId,
      }
    }
    try {
      const list = await presets.list()
      const managed = list.find((preset) => preset.id === MANAGED_PRESET_ID)
      const defaultId = await this.currentDefaultPreset()
      return {
        exists: managed !== undefined,
        defaultId,
        isDefault: defaultId === MANAGED_PRESET_ID,
        broken: managed?.broken ?? null,
        sourcePresetId: this.config.sourcePresetId,
      }
    } catch (error) {
      this.warn('agentPresets.list 失败', error)
      return {
        exists: false,
        defaultId: null,
        isDefault: false,
        broken: null,
        sourcePresetId: this.config.sourcePresetId,
      }
    }
  }

  /** 当前 agent-presets default（settings ns agent-presets 的 default 字段）。 */
  private async currentDefaultPreset(): Promise<string | null> {
    try {
      const doc = this.settings().get('agent-presets') as { default?: unknown } | undefined
      if (doc !== undefined && typeof doc.default === 'string') return doc.default
    } catch {
      /* fallthrough */
    }
    return this.presets()?.defaultId ?? null
  }

  /**
   * 执行一轮调和（串行化：上一轮未完成时跳过本轮，watch 会再触发）。
   */
  async apply(): Promise<void> {
    if (this.applying || this.disposed) return
    this.applying = true
    try {
      await this.applyInner()
    } finally {
      this.applying = false
    }
  }

  private async applyInner(): Promise<void> {
    const patchFile = this.patchFile()

    // 总开关关闭：清理全部管理痕迹并还原指针。
    if (!this.config.enabled) {
      await this.teardown(patchFile)
      return
    }

    const invalid = invalidFeatureKeys(this.desired)
    for (const key of invalid) {
      this.journal.record('reject', `未知功能键 ${key}（不在目录内，忽略）`)
    }

    const quarantined = readQuarantined(this.ctx)
    let patchClass: PatchClassification
    try {
      patchClass = await classifyPatchFile(patchFile)
    } catch (error) {
      this.warn(`patch 文件不可读，本轮跳过: ${error}`, error)
      return
    }
    let presetState: PresetFileState | undefined
    try {
      presetState = await readPresetFile(this.presetFile())
    } catch {
      presetState = undefined
    }
    const planResult = plan({
      desired: this.desired,
      patch: patchClass,
      preset: presetState,
      loader: new Map(),
      quarantined,
    })
    for (const rejection of planResult.rejected) {
      this.journal.record(
        'reject',
        `功能 ${rejection.feature} 的启用被拒绝：行 ${rejection.row} 已被 lifeboat 隔离，请先修复该插件`,
      )
    }

    // 执行动作
    let presetJustCreated = false
    for (const action of planResult.actions) {
      try {
        if (action.kind === 'ensure-managed-preset') {
          presetJustCreated = await this.ensureManagedPreset()
        } else if (action.kind === 'teardown-managed-preset') {
          await this.teardownManagedPreset()
        } else if (action.kind === 'patch-write') {
          await this.withRollback(patchFile, 'patch', async () => {
            const written = await syncManagedEntries(patchFile, action.disabledIds)
            if (written)
              this.journal.record(
                'apply',
                `patch 管理条目已更新（禁用 ${action.disabledIds.size} 行）`,
              )
          })
        } else if (action.kind === 'preset-write') {
          await this.withRollback(this.presetFile(), 'preset', async () => {
            const written = await syncPresetRows(this.presetFile(), action.disabledIds)
            if (written)
              this.journal.record(
                'apply',
                `托管预设行标记已更新（禁用 ${action.disabledIds.size} 行）`,
              )
          })
        }
      } catch (error) {
        this.warn(`动作 ${action.kind} 失败`, error)
      }
    }

    // ensure-managed-preset 新建/重建了预设：规划时预设文件尚不存在（或内容已
    // 变），preset-write 动作缺位或基于旧快照——用新文件态重放行同步。
    if (presetJustCreated) {
      const rows = desiredRows(this.desired)
      try {
        await this.withRollback(this.presetFile(), 'preset', async () => {
          const written = await syncPresetRows(this.presetFile(), rows.preset)
          if (written)
            this.journal.record('apply', `托管预设行标记已更新（禁用 ${rows.preset.size} 行）`)
        })
      } catch (error) {
        this.warn('托管预设行同步失败', error)
      }
    }

    // 验证：预设非 broken + default 指针正确
    if (needsManagedPreset(this.desired)) {
      await this.verifyPreset()
    }
  }

  /** 确保托管预设存在且 default 指向它；返回是否新建/重建（调用方需重放行同步）。 */
  private async ensureManagedPreset(): Promise<boolean> {
    const presets = this.presets()
    if (presets === undefined) {
      this.journal.record(
        'error',
        'agentPresets 服务缺席，preset 平面开关不可用（host 平面不受影响）',
      )
      return false
    }
    let list: Awaited<ReturnType<AgentPresetsLike['list']>>
    try {
      list = await presets.list()
    } catch (error) {
      this.warn('agentPresets.list 失败', error)
      return false
    }
    const managed = list.find((preset) => preset.id === MANAGED_PRESET_ID)
    let created = false
    if (managed === undefined) {
      const source = list.find((preset) => preset.id === this.config.sourcePresetId)
      if (source === undefined) {
        this.journal.record(
          'error',
          `源预设 ${this.config.sourcePresetId} 不存在（可用: ${list.map((p) => p.id).join(', ')}），preset 平面开关不可用`,
        )
        return false
      }
      await presets.copy(
        this.config.sourcePresetId,
        MANAGED_PRESET_ID,
        '标准模式（dsh-plus 功能开关）',
      )
      this.journal.record(
        'preset',
        `已从 ${this.config.sourcePresetId} 复制创建托管预设 ${MANAGED_PRESET_ID}`,
      )
      created = true
    } else if (managed.broken !== undefined) {
      // broken → 删除重建
      await presets.remove(MANAGED_PRESET_ID)
      await presets.copy(
        this.config.sourcePresetId,
        MANAGED_PRESET_ID,
        '标准模式（dsh-plus 功能开关）',
      )
      this.journal.record('preset', `托管预设 broken（${managed.broken}），已删除并从源预设重建`)
      created = true
    }
    // 指针检查放在重建之后：dsh 的 preset remove 会联动清除 default（回落 base），
    // 重建路径下先读后切会漏掉这次重置。
    const currentDefault = await this.currentDefaultPreset()
    if (currentDefault !== MANAGED_PRESET_ID) {
      await this.setDefaultPreset(MANAGED_PRESET_ID)
      this.journal.record(
        'preset',
        `默认预设已从 ${currentDefault ?? '(未设置)'} 切换为 ${MANAGED_PRESET_ID}（新会话生效）`,
      )
    }
    return created
  }

  /** 写 agent-presets settings ns 的 default 字段。 */
  private async setDefaultPreset(id: string): Promise<void> {
    try {
      await this.settings().mutate('agent-presets', [{ op: 'set', path: ['default'], value: id }])
    } catch (error) {
      this.warn(`切换默认预设失败（agent-presets ns）`, error)
    }
  }

  /** 清理托管预设 default 指针并删除目录。 */
  private async teardownManagedPreset(): Promise<void> {
    const presets = this.presets()
    if (presets === undefined) return
    try {
      const currentDefault = await this.currentDefaultPreset()
      if (currentDefault === MANAGED_PRESET_ID) {
        await this.setDefaultPreset(this.config.sourcePresetId)
        this.journal.record('preset', `默认预设已还原为 ${this.config.sourcePresetId}`)
      }
      const list = await presets.list()
      if (list.some((preset) => preset.id === MANAGED_PRESET_ID)) {
        await presets.remove(MANAGED_PRESET_ID)
        this.journal.record('preset', `托管预设 ${MANAGED_PRESET_ID} 已移除`)
      }
    } catch (error) {
      this.warn('teardown 托管预设失败', error)
    }
  }

  /** 总开关关闭的清理：patch 管理条目清空 + 托管预设拆除。 */
  private async teardown(patchFile: string): Promise<void> {
    try {
      await this.withRollback(patchFile, 'patch', async () => {
        const written = await syncManagedEntries(patchFile, new Set())
        if (written) this.journal.record('apply', '总开关关闭：patch 管理条目已全部移除')
      })
    } catch (error) {
      this.warn('清理 patch 管理条目失败', error)
    }
    await this.teardownManagedPreset()
  }

  /** 验证托管预设健康（非 broken + default 指针）。 */
  private async verifyPreset(): Promise<void> {
    const presets = this.presets()
    if (presets === undefined) return
    try {
      const list = await presets.list()
      const managed = list.find((preset) => preset.id === MANAGED_PRESET_ID)
      if (managed !== undefined && managed.broken !== undefined) {
        this.journal.record('rollback', `托管预设验证失败（${managed.broken}），回滚预设文件`)
        await this.restoreBackup(this.presetFile())
        this.pendingRestartFlag = true
        return
      }
      const currentDefault = await this.currentDefaultPreset()
      if (currentDefault !== MANAGED_PRESET_ID) {
        this.journal.record(
          'verify',
          `默认预设当前指向 ${currentDefault ?? '(未设置)'} 而非托管预设——新会话将不受功能开关控制`,
        )
      }
    } catch (error) {
      this.warn('预设验证异常', error)
    }
  }

  /**
   * 写入包装：写前清健康失败集，写后开健康监视窗口；窗口内出现非目标行
   * FAILED 或验证异常 → 恢复备份（热回滚，watchUserPatches 会热应用回滚）。
   */
  private async withRollback(
    file: string,
    kind: 'patch' | 'preset',
    write: () => Promise<void>,
  ): Promise<void> {
    this.healthFailures.clear()
    await write()
    const windowMs = this.config.healthWindowMs
    if (windowMs <= 0) return
    const startedAt = this.deps.now?.() ?? Date.now()
    const check = (): void => {
      if (this.disposed) return
      const elapsed = (this.deps.now?.() ?? Date.now()) - startedAt
      if (elapsed < windowMs) {
        setTimeout(check, Math.min(500, windowMs - elapsed))
        return
      }
      if (this.healthFailures.size > 0) {
        const failed = [...this.healthFailures].join(', ')
        this.journal.record('rollback', `健康监视窗口发现失败行 ${failed}，回滚 ${kind} 文件`)
        void this.restoreBackup(file)
      }
    }
    setTimeout(check, Math.min(500, windowMs))
  }

  /** 恢复备份文件（备份存在时；热应用由 dsh 自身的 watchUserPatches 完成）。 */
  private async restoreBackup(file: string): Promise<void> {
    try {
      const backup = backupPath(file)
      await copyFile(backup, file)
      this.journal.record('rollback', `已从 ${backup} 恢复`)
    } catch (error) {
      this.warn(`恢复备份失败（${backupPath(file)}）`, error)
    }
  }

  /** 重建托管预设（卡片按钮 → POST rebuild；sourcePresetId 缺省用行级配置）。 */
  async rebuildManagedPreset(sourcePresetId?: string): Promise<void> {
    const presets = this.presets()
    if (presets === undefined) {
      this.journal.record('error', 'agentPresets 服务缺席，无法重建')
      return
    }
    const source = sourcePresetId ?? this.config.sourcePresetId
    try {
      const list = await presets.list()
      if (!list.some((preset) => preset.id === source)) {
        this.journal.record('reject', `源预设 ${source} 不存在，重建拒绝`)
        return
      }
      if (list.some((preset) => preset.id === MANAGED_PRESET_ID)) {
        await presets.remove(MANAGED_PRESET_ID)
      }
      await presets.copy(source, MANAGED_PRESET_ID, '标准模式（dsh-plus 功能开关）')
      this.journal.record('preset', `托管预设已从 ${source} 重建（期望态将在下轮调和重放）`)
      await this.apply()
    } catch (error) {
      this.warn('重建托管预设失败', error)
    }
  }

  private warn(message: string, error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error)
    this.ctx.logger.warn(`feature-toggle: ${message}: ${detail}`)
    this.journal.record('error', `${message}: ${detail}`)
  }
}
