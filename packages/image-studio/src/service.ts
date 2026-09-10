/**
 * image-studio 服务主体：
 * - settings installSection（三组预设 + 并发/超时/代理/画廊上限/上传保留时长）；
 * - TaskRunner 并发生图：提交即排队，成功自动入画廊（元数据 + 图片落盘）；
 * - 提供商预设按 id 即时 resolve credentials（不缓存）；
 * - 上传暂存区：本地文件上传的源图/遮罩，孤儿按 TTL 回收；
 * - 端点：generate/tasks/gallery/images/uploads/credentials/providers（api.ts 注册）。
 * 红线：开发测试仅指向本地 mock，严禁真实调用产生费用。
 * @module image-studio/service
 */
import type { Context as ContextT } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-settings'
import { registerImageStudioApi } from './api.ts'
import {
  type ImageStudioConfig,
  type ParamPresetEntry,
  type PromptPresetEntry,
  type ProviderPresetEntry,
  SETTINGS_NS,
} from './config.ts'
import { credentialRefNameOf, isValidPresetId } from './credentials.ts'
import type { GenerateRequest, SourceRef, TaskWire } from './dto.ts'
import { ImageStudioError } from './errors.ts'
import type { GalleryItem } from './gallery/store.ts'
import {
  loadGallery,
  readImageBytes,
  deleteGalleryItem as removeGalleryItem,
  saveGalleryItem,
} from './gallery/store.ts'
import { isImageId } from './images/id.ts'
import { mimeOfExt } from './images/mime.ts'
import { MAX_SOURCE_IMAGES } from './limits.ts'
import type { ParamSpecMap } from './params/spec.ts'
import { normalizeParamSpecs, validateParamSpecs } from './params/spec.ts'
import { createProvider } from './provider/registry.ts'
import type { ImageEndpoint, InputImage, ProviderTarget } from './provider/types.ts'
import type { TaskRecord } from './task/runner.ts'
import { TaskRunner } from './task/runner.ts'
import type { UploadEntry } from './uploads/store.ts'
import {
  loadUploads,
  pruneUploads,
  readUploadBytes,
  saveUpload as saveUploadEntry,
} from './uploads/store.ts'

interface SettingsLike {
  installSection(
    ownerCtx: ContextT,
    ns: string,
    schema: unknown,
    base: unknown,
    hooks: { setSource(source: () => unknown): void; onChange(): void },
  ): void
}

/** credentials seam 最小面（真实服务经 inject 探测获取）。 */
interface CredentialsFace {
  resolve(ref: unknown): Promise<{ value: string; source: string } | undefined>
  describe(ref: unknown): Promise<{ configured: boolean }>
  set(ref: unknown, value: string): Promise<void>
  unset(ref: unknown): Promise<void>
}

/** 提交时的请求摘要（任务快照）。 */
interface TaskSnapshot {
  endpoint: ImageEndpoint
  model: string
  prompt: string
}

/** 单任务成功产物（TaskRunner result 槽）。 */
interface TaskOutcome {
  galleryItemId: string
}

export class ImageStudioService extends Service {
  // 普通 static inject：cordis 4.0.2 不存在 Context.inject 符号（computed key
  // 会失效为 'undefined' 使声明无效）；credentials 时序由该声明保证。
  static inject = ['credentials']

  private current: () => ImageStudioConfig
  private readonly runner: TaskRunner<TaskSnapshot>
  private readonly log: (message: string) => void
  /** 进行中的孤儿回收（串行化：索引重写不能并发）。 */
  private pruning: Promise<void> | null
  // settings 服务窄面（settingsCtx.inject 回调内落存）。declare：不参与类字段
  // 初始化 emit，保持实例运行期形状与既有产物一致（不因声明而多出 undefined 字段）。
  private declare settingsRef: SettingsLike | undefined

  constructor(ctx: ContextT, config: ImageStudioConfig) {
    super(ctx, 'imageStudio')
    this.current = () => config
    this.log = (message) => ctx.logger('image-studio').warn(message)
    this.pruning = null
    this.runner = new TaskRunner<TaskSnapshot>({ maxConcurrent: config.maxConcurrent })
    // 启动回收一次：上次进程遗留的孤儿上传（未被画廊引用且超 TTL）。
    this.schedulePrune()
    ctx.inject(['settings'], (settingsCtx) => {
      this.settingsRef = settingsCtx.settings as unknown as SettingsLike
      settingsCtx.settings.installSection(ctx, SETTINGS_NS, configSchemaRef, config, {
        setSource: (source) => {
          this.current = source as () => ImageStudioConfig
          this.applyConfig()
        },
        onChange: () => {},
      })
    })
    ctx.inject(['webServer'], (webCtx) => {
      registerImageStudioApi(webCtx as ContextT, this)
    })
  }

  /** 配置热更：并发上限即时生效（进行中任务不受影响）。 */
  private applyConfig(): void {
    this.runner.reconfigure(this.current().maxConcurrent)
  }

  // ---------- 预设读取 ----------

  private promptPresets(): PromptPresetEntry[] {
    return this.current().promptPresets
  }

  private paramPresets(): ParamPresetEntry[] {
    return this.current().paramPresets as ParamPresetEntry[]
  }

  private providerPresets(): ProviderPresetEntry[] {
    return this.current().providerPresets as ProviderPresetEntry[]
  }

  /** 预设快照（端点投影）。 */
  presets(): {
    promptPresets: PromptPresetEntry[]
    paramPresets: ParamPresetEntry[]
    providerPresets: ProviderPresetEntry[]
  } {
    return {
      promptPresets: this.promptPresets(),
      paramPresets: this.paramPresets(),
      providerPresets: this.providerPresets(),
    }
  }

  // ---------- 凭据 ----------

  /** describe 单个提供商预设凭据（不回传值）。 */
  async credentialStatus(
    presetId: string,
  ): Promise<{ credentialRef: string; configured: boolean }> {
    const refName = credentialRefNameOf(presetId)
    const credentials = await this.credentialsSeam()
    if (credentials === null) return { credentialRef: refName, configured: false }
    const info = await credentials.describe(credentialRef(refName))
    return { credentialRef: refName, configured: info.configured }
  }

  /** set/unset 凭据（端点写通道）。 */
  async setCredential(presetId: string, value: string): Promise<void> {
    const credentials = await this.requireCredentials()
    await credentials.set(credentialRef(credentialRefNameOf(presetId)), value)
  }

  async unsetCredential(presetId: string): Promise<void> {
    const credentials = await this.requireCredentials()
    await credentials.unset(credentialRef(credentialRefNameOf(presetId)))
  }

  /** credentials seam（inject 硬声明保证时序，见类声明；缺席即组合缺服务）。 */
  private async credentialsSeam(): Promise<CredentialsFace | null> {
    const found = (this.ctx as unknown as { get?(key: 'credentials'): unknown }).get?.(
      'credentials',
    )
    return found === undefined || found === null ? null : (found as CredentialsFace)
  }

  private async requireCredentials(): Promise<CredentialsFace> {
    const seam = await this.credentialsSeam()
    if (seam === null) throw new ImageStudioError('credential-unavailable')
    return seam
  }

  // ---------- 生图任务 ----------

  /** 提交生图任务：校验 → 入队 → 返回 taskId。 */
  async submitGenerate(request: GenerateRequest): Promise<string> {
    const snapshot = await this.prepareTask(request)
    const summary: TaskSnapshot = {
      endpoint: snapshot.endpoint,
      model: snapshot.target.model,
      prompt: snapshot.prompt,
    }
    const record = this.runner.submit(summary, (signal) => this.executeTask(snapshot, signal))
    return record.id
  }

  /** 单任务查询（wire 投影）。 */
  taskWire(id: string): TaskWire | null {
    const record = this.runner.get(id)
    return record === null ? null : this.toTaskWire(record)
  }

  /** 任务列表（最新在前）。 */
  taskWires(): TaskWire[] {
    return this.runner
      .list()
      .reverse()
      .map((record) => this.toTaskWire(record))
  }

  /** 取消任务。 */
  cancelTask(id: string): boolean {
    return this.runner.cancel(id)
  }

  private toTaskWire(record: TaskRecord<TaskSnapshot>): TaskWire {
    const outcome = record.result as TaskOutcome | null
    return {
      id: record.id,
      state: record.state,
      endpoint: record.snapshot.endpoint,
      model: record.snapshot.model,
      promptPreview: record.snapshot.prompt.slice(0, 120),
      createdAt: record.createdAt,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
      error: record.error,
      galleryItemId:
        record.state === 'succeeded' && outcome !== null ? outcome.galleryItemId : null,
    }
  }

  /**
   * 任务准备（边界校验集中地）：提供商预设/inline → target；
   * 参数预设 + 覆盖 → 归一化参数表；sources/mask 引用 → 输入图字节。
   */
  private async prepareTask(request: GenerateRequest): Promise<{
    target: ProviderTarget
    endpoint: ImageEndpoint
    prompt: string
    n: number
    images: InputImage[]
    mask: InputImage | null
    params: Record<string, unknown>
    sourceIds: string[]
    sourceUploads: string[]
  }> {
    const target = await this.resolveTarget(request)
    const endpoint = request.endpoint
    if (endpoint !== 'generation' && endpoint !== 'edit') {
      throw new ImageStudioError('invalid-request', `未知端点：${String(endpoint)}`)
    }
    if (typeof request.prompt !== 'string' || request.prompt.trim().length === 0) {
      throw new ImageStudioError('invalid-request', 'prompt 不能为空')
    }
    const params = await this.resolveParams(request, endpoint)
    const nValue = params.n
    const n = typeof nValue === 'number' ? nValue : 1
    const refs = this.sourceRefsOf(request)
    const maskRef = this.maskRefOf(request)
    const sources = await this.loadSourceImages(refs, endpoint)
    const mask = maskRef === null ? null : await this.loadMaskImage(maskRef)
    return {
      target,
      endpoint,
      prompt: request.prompt,
      n,
      images: sources.images,
      mask,
      params: stripHostParams(params),
      sourceIds: sources.galleryIds,
      sourceUploads: sources.uploadIds,
    }
  }

  /** 源图引用规范化（sources 优先；旧 sourceIds 等价于全部 gallery 引用）。 */
  private sourceRefsOf(request: GenerateRequest): SourceRef[] {
    if (request.sources !== undefined) {
      if (!Array.isArray(request.sources)) {
        throw new ImageStudioError('invalid-request', 'sources 必须是数组')
      }
      return request.sources.map((ref) => this.assertRef(ref))
    }
    const legacy = request.sourceIds ?? []
    if (!Array.isArray(legacy)) {
      throw new ImageStudioError('invalid-request', 'sourceIds 必须是数组')
    }
    return legacy.map((id) => this.assertRef({ kind: 'gallery', id }))
  }

  /** 遮罩引用规范化（mask 优先；旧 maskId 等价于 gallery 引用）。 */
  private maskRefOf(request: GenerateRequest): SourceRef | null {
    if (request.mask !== undefined) return this.assertRef(request.mask)
    if (request.maskId === undefined) return null
    return this.assertRef({ kind: 'gallery', id: request.maskId })
  }

  /** 引用形态校验（请求体来自浏览器，kind 封闭集合 + id uuid 形态）。 */
  private assertRef(ref: SourceRef): SourceRef {
    if (ref === null || typeof ref !== 'object') {
      throw new ImageStudioError('invalid-request', '源图引用必须是 { kind, id }')
    }
    if (ref.kind !== 'gallery' && ref.kind !== 'upload') {
      throw new ImageStudioError('invalid-request', `未知源图类型：${String(ref.kind)}`)
    }
    if (!isImageId(ref.id)) {
      throw new ImageStudioError('invalid-request', `非法源图标识：${String(ref.id)}`)
    }
    return { kind: ref.kind, id: ref.id }
  }

  /** 提供商预设 / inline → ProviderTarget（凭据即时 resolve）。 */
  private async resolveTarget(request: GenerateRequest): Promise<ProviderTarget> {
    const config = this.current()
    const inline = request.inlineProvider
    let protocol: string
    let baseUrl: string
    let model: string
    let extraHeaders: Record<string, string> = {}
    let refName: string
    if (inline !== undefined) {
      protocol = inline.protocol
      baseUrl = inline.baseUrl
      model = inline.model
      // inline 无独立凭据：复用 providerPresetId 引用或拒绝。
      if (request.providerPresetId === undefined) {
        throw new ImageStudioError(
          'invalid-request',
          'inline 提供商必须同时给出 providerPresetId 以定位凭据',
        )
      }
      refName = credentialRefNameOf(request.providerPresetId)
    } else if (request.providerPresetId !== undefined) {
      const preset = this.providerPresets().find((item) => item.id === request.providerPresetId)
      if (preset === undefined) {
        throw new ImageStudioError('invalid-request', `未知提供商预设：${request.providerPresetId}`)
      }
      protocol = preset.protocol
      baseUrl = preset.baseUrl
      model = preset.model
      extraHeaders = preset.extraHeaders ?? {}
      refName = isValidPresetId(preset.id)
        ? credentialRefNameOf(preset.id)
        : credentialRefNameOf(preset.credentialRef)
    } else {
      throw new ImageStudioError('invalid-request', '必须提供 providerPresetId 或 inlineProvider')
    }
    const apiKey = await this.resolveApiKey(refName)
    const target: ProviderTarget & { presetId?: string } = {
      protocol,
      baseUrl,
      model,
      apiKey,
      extraHeaders,
      proxy: config.proxy,
      timeoutMs: config.requestTimeoutMs,
    }
    // 预设 id 旁路携带（executeTask 落画廊时补记 providerPresetId）。
    target.presetId =
      inline !== undefined ? (request.providerPresetId ?? null) : (request.providerPresetId ?? null)
    return target
  }

  /** 凭据解析（每次操作即时 resolve，不缓存）。 */
  private async resolveApiKey(refName: string): Promise<string> {
    const credentials = await this.requireCredentials()
    const resolved = await credentials.resolve(credentialRef(refName))
    if (resolved === undefined) {
      throw new ImageStudioError('credential-unavailable', `凭据未配置：${refName}`)
    }
    return resolved.value
  }

  /** 参数预设 + 覆盖合并 → 端点归一化（model 由 target 承载）。 */
  private async resolveParams(
    request: GenerateRequest,
    endpoint: ImageEndpoint,
  ): Promise<Record<string, unknown>> {
    let specs: ParamSpecMap = {}
    if (request.paramPresetId !== undefined) {
      const preset = this.paramPresets().find((item) => item.id === request.paramPresetId)
      if (preset === undefined) {
        throw new ImageStudioError('invalid-request', `未知参数预设：${request.paramPresetId}`)
      }
      specs = validateParamSpecs(preset.paramSpecs)
    }
    if (request.paramSpecs !== undefined) {
      specs = { ...specs, ...validateParamSpecs(request.paramSpecs) }
    }
    const normalized = normalizeParamSpecs(specs, endpoint)
    return { model: this.modelOf(request), ...normalized }
  }

  /** 模型优先级：inline > 提供商预设（参数表中的 model 仅为展示，不参与）。 */
  private modelOf(request: GenerateRequest): string {
    return request.inlineProvider?.model ?? this.providerModelOf(request.providerPresetId)
  }

  private providerModelOf(presetId: string | undefined): string {
    if (presetId === undefined) return ''
    return this.providerPresets().find((item) => item.id === presetId)?.model ?? ''
  }

  /**
   * 源图字节加载（edit ≥1 张；单图上限 50MB 对齐官方）。
   * 按引用来源分流读取，并把两类 id 分开回传（画廊衍生链 / 上传暂存区）。
   */
  private async loadSourceImages(
    refs: SourceRef[],
    endpoint: ImageEndpoint,
  ): Promise<{ images: InputImage[]; galleryIds: string[]; uploadIds: string[] }> {
    if (endpoint === 'generation') return { images: [], galleryIds: [], uploadIds: [] }
    if (refs.length === 0) {
      throw new ImageStudioError('invalid-request', 'edit 端点必须提供至少一张源图（sources）')
    }
    if (refs.length > MAX_SOURCE_IMAGES) {
      throw new ImageStudioError(
        'invalid-request',
        `源图最多 ${MAX_SOURCE_IMAGES} 张（官方 GPT Image 限制）`,
      )
    }
    const images: InputImage[] = []
    const galleryIds: string[] = []
    const uploadIds: string[] = []
    for (const ref of refs) {
      images.push(await this.loadRefImage(ref))
      if (ref.kind === 'gallery') galleryIds.push(ref.id)
      else uploadIds.push(ref.id)
    }
    return { images, galleryIds, uploadIds }
  }

  /** 单个引用 → 输入图字节（两个 id 空间分别查，未知一律 unknown-source）。 */
  private async loadRefImage(ref: SourceRef): Promise<InputImage> {
    const found =
      ref.kind === 'gallery' ? await this.imageBytes(ref.id) : await this.uploadBytes(ref.id)
    if (found === null) {
      throw new ImageStudioError('unknown-source', `源图不存在：${ref.kind}:${ref.id}`)
    }
    return { data: found.data, mime: mimeOfExt(found.ext) }
  }

  /**
   * 遮罩加载：官方要求带透明通道的 PNG（其它格式上游必然拒绝），
   * 在边界提前给出可读原因，避免白跑一次计费请求。
   */
  private async loadMaskImage(ref: SourceRef): Promise<InputImage> {
    const image = await this.loadRefImage(ref)
    if (image.mime !== 'image/png') {
      throw new ImageStudioError(
        'unsupported-media',
        `遮罩必须是 PNG（当前 ${image.mime}）：请上传带透明区域的 PNG`,
      )
    }
    return image
  }

  /** 任务体：调协议适配器 → 成功入画廊。失败向上抛给 TaskRunner 记录。 */
  private async executeTask(
    snapshot: Awaited<ReturnType<ImageStudioService['prepareTask']>>,
    signal: AbortSignal,
  ): Promise<TaskOutcome> {
    const provider = createProvider(snapshot.target.protocol)
    if (!provider.endpoints.includes(snapshot.endpoint)) {
      throw new ImageStudioError(
        'unknown-endpoint',
        `协议 ${provider.id} 不支持端点 ${snapshot.endpoint}`,
      )
    }
    const result = await provider.generate(
      {
        target: snapshot.target,
        endpoint: snapshot.endpoint,
        prompt: snapshot.prompt,
        n: snapshot.n,
        images: snapshot.images,
        mask: snapshot.mask,
        params: snapshot.params,
      },
      signal,
    )
    const item = await saveGalleryItem({
      item: {
        providerPresetId: this.presetIdOf(snapshot),
        protocol: snapshot.target.protocol,
        endpoint: snapshot.endpoint,
        model: snapshot.target.model,
        prompt: snapshot.prompt,
        params: snapshot.params,
        sourceIds: snapshot.sourceIds,
        sourceUploads: snapshot.sourceUploads,
      },
      images: result.images.map((image) => ({
        data: image.data,
        mime: image.mime,
        revisedPrompt: image.revisedPrompt,
      })),
    })
    // 入库后回收一次：本次引用的上传已被条目引用（保留），其余过期孤儿清理。
    this.schedulePrune()
    return { galleryItemId: item.id }
  }

  /** 提交时上下文里的预设 id（executeTask 无原请求，经 target 旁路携带）。 */
  private presetIdOf(snapshot: { target: ProviderTarget }): string | null {
    return (snapshot.target as ProviderTarget & { presetId?: string }).presetId ?? null
  }

  // ---------- 画廊 ----------

  /** 画廊列表（全量；分页/过滤由端点层做）。 */
  async gallery(): Promise<GalleryItem[]> {
    return loadGallery(this.log)
  }

  /** 删除画廊条目（图片 + 元数据）。 */
  async deleteGalleryItem(itemId: string): Promise<boolean> {
    return removeGalleryItem(itemId)
  }

  /** 读取图片字节（端点直投流）。 */
  async imageBytes(imageId: string): Promise<{ data: Uint8Array; ext: string } | null> {
    try {
      return await readImageBytes(imageId)
    } catch {
      return null
    }
  }

  // ---------- 上传暂存区 ----------

  /** 保存上传原图（端点边界已完成 MIME 嗅探与限额）。 */
  async saveUpload(input: { name: string; mime: string; data: Uint8Array }): Promise<UploadEntry> {
    const entry = await saveUploadEntry(input)
    this.schedulePrune()
    return entry
  }

  /** 上传列表（索引序，最新在后；前端自行倒序展示）。 */
  async listUploads(): Promise<UploadEntry[]> {
    return loadUploads(this.log)
  }

  /** 读取上传图片字节（缩略图端点；未知 id 返回 null）。 */
  async uploadBytes(uploadId: string): Promise<{ data: Uint8Array; ext: string } | null> {
    try {
      return await readUploadBytes(uploadId)
    } catch {
      return null
    }
  }

  /** 触发一次孤儿回收（并发调用合并为一次，失败不影响主流程）。 */
  private schedulePrune(): void {
    if (this.pruning !== null) return
    this.pruning = this.pruneOrphans()
      .catch((error: unknown) => {
        this.log(`上传回收失败（忽略）：${error instanceof Error ? error.message : String(error)}`)
      })
      .finally(() => {
        this.pruning = null
      })
  }

  /** 保留被画廊条目引用的上传；其余超过 TTL 的回收（暂存区不无界增长）。 */
  private async pruneOrphans(): Promise<void> {
    const keepIds = new Set<string>()
    for (const item of await this.gallery()) {
      for (const id of item.sourceUploads) keepIds.add(id)
    }
    const removed = await pruneUploads({
      keepIds,
      ttlMs: this.current().uploadTtlHours * 3_600_000,
      log: this.log,
    })
    if (removed > 0) this.log(`回收孤儿上传 ${removed} 个`)
  }

  dispose(): void {
    // 进行中任务随进程终止（AbortController 无需逐一 abort——进程退出即断）。
  }
}

/** 静态 schema 引用（installSection 用；避免循环 import config → service）。 */
import { Config as configSchemaRef } from './config.ts'

/** 剔除 host 承载参数（model 不进协议参数表——openai-images 请求体单独拼）。 */
function stripHostParams(params: Record<string, unknown>): Record<string, unknown> {
  const { model: _model, ...rest } = params
  return rest
}
