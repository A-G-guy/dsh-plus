/**
 * 生图工作台表单（文生图/图生图共用，endpoint 区分）：
 * - 提供商预设选择 + 凭据状态徽标 + inline 覆盖（凭据沿用预设）；
 * - 提示词编辑 + 预设插入/另存；
 * - 目录驱动的参数表单 + 参数预设应用/另存；
 * - 图生图追加源图（≤16，画廊选择与本地文件上传混用）与可选遮罩；
 * - 提交 generate → 202 taskId 交由面板任务条轮询。
 * 预设另存走 settings RPC（scope/api 注入），成功后经 onPresetSaved 刷新快照。
 * @module image-studio/client/panel/generator
 */
import {
  IconLayers,
  IconPlusOutline16,
  type NamespaceSettingsApi,
  type Scope,
} from '@dsh-plus/shared/client'
import { type ReactElement, useEffect, useMemo, useRef, useState } from 'react'
import type {
  GenerateRequest,
  PresetsWire,
  ProvidersWire,
  SourceRef,
  UploadEntry,
} from '../../dto.ts'
import type { GalleryItem } from '../../gallery/store.ts'
import { MAX_SOURCE_IMAGES } from '../../limits.ts'
import type { ParamEntry } from '../../params/catalog.ts'
import { type ParamSpecMap, validateParamSpecs } from '../../params/spec.ts'
import type { ImageEndpoint } from '../../provider/types.ts'
import { fetchCredentialStatus, generate } from '../api.ts'
import type { Translate } from '../i18n.ts'
import type { EditSeed } from './controller.ts'
import {
  applyParams,
  applySpecs,
  emptyParamForm,
  formToSpecs,
  type ParamFormState,
} from './param-state.ts'
import { ParamsForm } from './params-form.tsx'
import { ImagePicker, refUrl } from './picker.tsx'
import { UploadButton, useUploads } from './uploads.tsx'

interface GeneratorProps {
  t: Translate
  endpoint: ImageEndpoint
  catalog: readonly ParamEntry[]
  protocols: ProvidersWire['protocols']
  presets: PresetsWire
  gallery: GalleryItem[]
  scope: Scope
  api: NamespaceSettingsApi
  /** 二次编辑种子（仅图生图实例消费）。 */
  editSeed: EditSeed | null
  onPresetSaved(): void
  onSubmitted(taskId: string): void
  hidden: boolean
}

interface InlineDraft {
  open: boolean
  protocol: string
  baseUrl: string
  model: string
}

type Status = { kind: 'idle' | 'ok' | 'error'; text: string }
const IDLE: Status = { kind: 'idle', text: '' }

/** 预设 id 生成（稳定唯一即可；provider 预设的 kebab 约束不适用此处）。 */
function presetId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

/** 单选上传结果 → 遮罩引用（无成功条目时保持原值）。 */
function uploadRef(entries: UploadEntry[]): SourceRef | null {
  const first = entries[0]
  return first === undefined ? null : { kind: 'upload', id: first.id }
}

export function GeneratorForm(props: GeneratorProps): ReactElement {
  const { t, endpoint, catalog, protocols, presets, gallery, scope, api } = props
  const [providerId, setProviderId] = useState('')
  const [inline, setInline] = useState<InlineDraft>({
    open: false,
    protocol: protocols[0]?.id ?? 'openai-images',
    baseUrl: '',
    model: '',
  })
  const [credentialOk, setCredentialOk] = useState<boolean | null>(null)
  const [prompt, setPrompt] = useState('')
  const [form, setForm] = useState<ParamFormState>({})
  const [sources, setSources] = useState<SourceRef[]>([])
  const [mask, setMask] = useState<SourceRef | null>(null)
  const [picker, setPicker] = useState<'sources' | 'mask' | null>(null)
  const [naming, setNaming] = useState<{ kind: 'prompt' | 'params'; name: string } | null>(null)
  const [status, setStatus] = useState<Status>(IDLE)
  const [submitting, setSubmitting] = useState(false)
  /** 目录就绪后初始化表单一次（catalog 会话内静态，重载不覆盖用户编辑）。 */
  const formReadyRef = useRef(false)
  /** 已消费的种子 nonce（防重复回填）。 */
  const seedRef = useRef(0)
  const uploads = useUploads()

  // 目录到达后初始化参数表单。
  useEffect(() => {
    if (formReadyRef.current || catalog.length === 0) return
    formReadyRef.current = true
    setForm(emptyParamForm(catalog, endpoint))
  }, [catalog, endpoint])

  // 二次编辑种子回填（等目录就绪，保证参数完整回放）。
  const seed = endpoint === 'edit' ? props.editSeed : null
  useEffect(() => {
    if (seed === null || seed.nonce === seedRef.current || !formReadyRef.current) return
    seedRef.current = seed.nonce
    setPrompt(seed.prompt)
    setSources(seed.sources)
    setForm(applyParams(catalog, endpoint, seed.params))
    if (seed.providerPresetId !== null) setProviderId(seed.providerPresetId)
    setStatus(IDLE)
  }, [seed, catalog, endpoint])

  // 选中预设变化 → 查询凭据状态。
  useEffect(() => {
    if (providerId === '') {
      setCredentialOk(null)
      return
    }
    let alive = true
    fetchCredentialStatus(providerId)
      .then((res) => {
        if (alive) setCredentialOk(res.configured)
      })
      .catch(() => {
        if (alive) setCredentialOk(null)
      })
    return () => {
      alive = false
    }
  }, [providerId])

  const paramPresets = useMemo(
    () => presets.paramPresets.filter((preset) => preset.endpoint === endpoint),
    [presets, endpoint],
  )

  const selectedProvider = presets.providerPresets.find((preset) => preset.id === providerId)

  const toggleInline = (open: boolean): void => {
    setInline((current) => ({
      ...current,
      open,
      baseUrl: open && current.baseUrl === '' ? (selectedProvider?.baseUrl ?? '') : current.baseUrl,
      model: open && current.model === '' ? (selectedProvider?.model ?? '') : current.model,
      protocol:
        open && current.protocol === ''
          ? (selectedProvider?.protocol ?? current.protocol)
          : current.protocol,
    }))
  }

  const applyParamPreset = (id: string): void => {
    if (id === '') return
    const preset = paramPresets.find((item) => item.id === id)
    if (preset === undefined) return
    try {
      const specs = validateParamSpecs(preset.paramSpecs)
      setForm(applySpecs(catalog, endpoint, specs))
      setStatus(IDLE)
    } catch (error) {
      setStatus({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
    }
  }

  /** 预设另存（settings RPC + revision fencing，成功后刷新快照）。 */
  const savePreset = (): void => {
    if (naming === null || naming.name.trim() === '') return
    const snapshot = scope.getSnapshot()
    const value = (snapshot.value ?? {}) as {
      promptPresets?: PresetsWire['promptPresets']
      paramPresets?: PresetsWire['paramPresets']
    }
    const patch =
      naming.kind === 'prompt'
        ? {
            promptPresets: [
              ...(value.promptPresets ?? []),
              { id: presetId('prompt'), name: naming.name.trim(), text: prompt },
            ],
          }
        : {
            paramPresets: [
              ...(value.paramPresets ?? []),
              {
                id: presetId('param'),
                name: naming.name.trim(),
                endpoint,
                paramSpecs: formToSpecs(catalog, endpoint, form) as unknown,
              },
            ],
          }
    api
      .update(patch, snapshot.revision)
      .then(() => scope.load())
      .then(() => {
        setNaming(null)
        setStatus({
          kind: 'ok',
          text: t(naming.kind === 'prompt' ? 'prompt.preset.saved' : 'params.preset.saved'),
        })
        props.onPresetSaved()
      })
      .catch((error: unknown) => {
        setStatus({
          kind: 'error',
          text: `${t('card.saveFailed')}${error instanceof Error ? error.message : String(error)}`,
        })
      })
  }

  const submit = (): void => {
    if (providerId === '') {
      setStatus({ kind: 'error', text: t('generate.needProvider') })
      return
    }
    if (prompt.trim() === '') {
      setStatus({ kind: 'error', text: t('generate.needPrompt') })
      return
    }
    if (endpoint === 'edit' && sources.length === 0) {
      setStatus({ kind: 'error', text: t('generate.needSources') })
      return
    }
    let paramSpecs: ParamSpecMap
    try {
      paramSpecs = validateParamSpecs(formToSpecs(catalog, endpoint, form))
    } catch (error) {
      setStatus({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
      return
    }
    const request: GenerateRequest = {
      providerPresetId: providerId,
      endpoint,
      prompt: prompt.trim(),
      paramSpecs,
    }
    if (inline.open) {
      request.inlineProvider = {
        protocol: inline.protocol,
        baseUrl: inline.baseUrl.trim(),
        model: inline.model.trim(),
      }
    }
    if (endpoint === 'edit') {
      request.sources = sources
      if (mask !== null) request.mask = mask
    }
    setSubmitting(true)
    setStatus(IDLE)
    generate(request)
      .then(({ taskId }) => {
        setStatus({ kind: 'ok', text: t('generate.submitted').replace('{id}', taskId) })
        props.onSubmitted(taskId)
      })
      .catch((error: unknown) => {
        setStatus({
          kind: 'error',
          text: `${t('generate.failed')}${error instanceof Error ? error.message : String(error)}`,
        })
      })
      .finally(() => setSubmitting(false))
  }

  return (
    <div className="ims-gen" hidden={props.hidden}>
      <div className="ims-genMain">
        <section className="ims-block">
          <h3 className="ims-blockTitle">{t('provider.label')}</h3>
          {presets.providerPresets.length === 0 ? (
            <p className="ims-hint">{t('provider.empty')}</p>
          ) : (
            <div className="ims-providerRow">
              <select
                className="ims-input"
                value={providerId}
                aria-label={t('provider.label')}
                onChange={(event) => setProviderId(event.target.value)}
              >
                <option value="">{t('provider.placeholder')}</option>
                {presets.providerPresets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name}（{preset.model}）
                  </option>
                ))}
              </select>
              {credentialOk !== null ? (
                <span className={`ims-badge ${credentialOk ? 'ims-badgeOn' : 'ims-badgeOff'}`}>
                  {t(
                    credentialOk ? 'provider.credential.configured' : 'provider.credential.missing',
                  )}
                </span>
              ) : null}
            </div>
          )}
          {providerId !== '' ? (
            <>
              <label className="ims-checkLine">
                <input
                  type="checkbox"
                  checked={inline.open}
                  onChange={(event) => toggleInline(event.target.checked)}
                />
                <span>{t('provider.inline.toggle')}</span>
              </label>
              {inline.open ? (
                <div className="ims-inlineGrid">
                  <label className="ims-mini">
                    <span>{t('provider.inline.protocol')}</span>
                    <select
                      className="ims-input"
                      value={inline.protocol}
                      onChange={(event) => setInline({ ...inline, protocol: event.target.value })}
                    >
                      {protocols.map((protocol) => (
                        <option key={protocol.id} value={protocol.id}>
                          {protocol.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="ims-mini">
                    <span>{t('provider.inline.baseUrl')}</span>
                    <input
                      className="ims-input"
                      value={inline.baseUrl}
                      placeholder="https://api.openai.com/v1"
                      onChange={(event) => setInline({ ...inline, baseUrl: event.target.value })}
                    />
                  </label>
                  <label className="ims-mini">
                    <span>{t('provider.inline.model')}</span>
                    <input
                      className="ims-input"
                      value={inline.model}
                      placeholder="gpt-image-1"
                      onChange={(event) => setInline({ ...inline, model: event.target.value })}
                    />
                  </label>
                  <p className="ims-hint">{t('provider.inline.hint')}</p>
                </div>
              ) : null}
            </>
          ) : null}
        </section>

        <section className="ims-block">
          <h3 className="ims-blockTitle">{t('prompt.label')}</h3>
          <textarea
            className="ims-input ims-prompt"
            rows={5}
            value={prompt}
            placeholder={t('prompt.placeholder')}
            onChange={(event) => setPrompt(event.target.value)}
          />
          <div className="ims-rowActions">
            <select
              className="ims-input ims-rowGrow"
              value=""
              aria-label={t('prompt.preset.insert')}
              onChange={(event) => {
                const preset = presets.promptPresets.find((item) => item.id === event.target.value)
                if (preset !== undefined) {
                  setPrompt((current) =>
                    current.trim() === '' ? preset.text : `${current}\n${preset.text}`,
                  )
                }
              }}
            >
              <option value="">{t('prompt.preset.insert')}</option>
              {presets.promptPresets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="ims-btn ims-btnGhost"
              disabled={prompt.trim() === ''}
              onClick={() => setNaming({ kind: 'prompt', name: '' })}
            >
              {t('prompt.preset.save')}
            </button>
          </div>
        </section>

        {endpoint === 'edit' ? (
          <section className="ims-block">
            <h3 className="ims-blockTitle">{t('sources.label')}</h3>
            <div className="ims-sources">
              {sources.map((ref) => (
                <span key={`${ref.kind}:${ref.id}`} className="ims-thumb">
                  <img src={refUrl(ref)} alt="" />
                  <button
                    type="button"
                    className="ims-thumbRemove"
                    aria-label={t('common.delete')}
                    onClick={() =>
                      setSources((current) =>
                        current.filter((item) => !(item.kind === ref.kind && item.id === ref.id)),
                      )
                    }
                  >
                    ×
                  </button>
                </span>
              ))}
              <button
                type="button"
                className="ims-thumbAdd"
                disabled={sources.length >= MAX_SOURCE_IMAGES}
                onClick={() => setPicker('sources')}
              >
                <IconLayers size={18} />
                <span>{t('sources.pick')}</span>
              </button>
              <UploadButton
                t={t}
                uploads={uploads}
                multiple
                disabled={sources.length >= MAX_SOURCE_IMAGES}
                className="ims-thumbAdd"
                onUploaded={(entries) =>
                  setSources((current) =>
                    [
                      ...current,
                      ...entries.map((entry) => ({ kind: 'upload' as const, id: entry.id })),
                    ].slice(0, MAX_SOURCE_IMAGES),
                  )
                }
              >
                <IconPlusOutline16 size={18} />
                <span>{t('upload.pick')}</span>
              </UploadButton>
            </div>
            <p className="ims-hint">{t('sources.count').replace('{n}', String(sources.length))}</p>
            <h3 className="ims-blockTitle">{t('sources.mask')}</h3>
            <div className="ims-sources">
              {mask !== null ? (
                <span className="ims-thumb">
                  <img src={refUrl(mask)} alt="" />
                  <button
                    type="button"
                    className="ims-thumbRemove"
                    aria-label={t('sources.maskClear')}
                    onClick={() => setMask(null)}
                  >
                    ×
                  </button>
                </span>
              ) : null}
              <button type="button" className="ims-thumbAdd" onClick={() => setPicker('mask')}>
                <IconLayers size={18} />
                <span>{t('sources.maskPick')}</span>
              </button>
              <UploadButton
                t={t}
                uploads={uploads}
                multiple={false}
                // 遮罩必须 PNG（官方要求带透明通道），文件选择器先行收窄。
                accept="image/png"
                className="ims-thumbAdd"
                onUploaded={(entries) => setMask(uploadRef(entries))}
              >
                <IconPlusOutline16 size={18} />
                <span>{t('upload.pick')}</span>
              </UploadButton>
            </div>
            <p className="ims-hint">{t('sources.maskHint')}</p>
            {uploads.error !== null ? (
              <p className="ims-status ims-statusError" role="alert">
                {t('upload.failed')}
                {uploads.error}
              </p>
            ) : null}
          </section>
        ) : null}
      </div>

      <div className="ims-genSide">
        <section className="ims-block">
          <div className="ims-rowActions ims-blockHead">
            <h3 className="ims-blockTitle">{t('params.basic')}</h3>
            <select
              className="ims-input ims-rowGrow"
              value=""
              aria-label={t('params.preset.placeholder')}
              onChange={(event) => applyParamPreset(event.target.value)}
            >
              <option value="">{t('params.preset.placeholder')}</option>
              {paramPresets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="ims-btn ims-btnGhost"
              onClick={() => setNaming({ kind: 'params', name: '' })}
            >
              {t('params.preset.save')}
            </button>
          </div>
          <ParamsForm t={t} catalog={catalog} endpoint={endpoint} form={form} onChange={setForm} />
        </section>
      </div>

      <div className="ims-genFoot">
        {naming !== null ? (
          <div className="ims-naming">
            <input
              className="ims-input ims-rowGrow"
              value={naming.name}
              placeholder={t('prompt.preset.name')}
              // biome-ignore lint/a11y/noAutofocus: 模态内命名输入聚焦是预期交互
              autoFocus
              onChange={(event) => setNaming({ ...naming, name: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === 'Enter') savePreset()
                if (event.key === 'Escape') setNaming(null)
              }}
            />
            <button
              type="button"
              className="ims-btn ims-btnPrimary"
              disabled={naming.name.trim() === ''}
              onClick={savePreset}
            >
              {t('common.save')}
            </button>
            <button type="button" className="ims-btn ims-btnGhost" onClick={() => setNaming(null)}>
              {t('common.cancel')}
            </button>
          </div>
        ) : null}
        {status.kind !== 'idle' ? (
          <p
            className={`ims-status${status.kind === 'error' ? ' ims-statusError' : ''}`}
            role="status"
          >
            {status.text}
          </p>
        ) : null}
        <button
          type="button"
          className="ims-btn ims-btnPrimary ims-submit"
          disabled={submitting}
          onClick={submit}
        >
          {t('generate.submit')}
        </button>
      </div>

      {picker !== null ? (
        <ImagePicker
          t={t}
          title={t(picker === 'sources' ? 'sources.label' : 'sources.mask')}
          items={gallery}
          uploads={uploads}
          multiple={picker === 'sources'}
          initial={picker === 'sources' ? sources : mask === null ? [] : [mask]}
          onConfirm={(refs) => {
            if (picker === 'sources') setSources(refs)
            else setMask(refs[0] ?? null)
            setPicker(null)
          }}
          onClose={() => setPicker(null)}
        />
      ) : null}
    </div>
  )
}
