/**
 * Provider 路由编辑：每个 route 一张**受控**折叠小节（展开态由卡片持有，
 * 以便「从内置目录添加」后自动展开目标 route、以及卡片级"全部收起"）。
 * 小节内容：基础字段 + 请求头 + 高级设置（其余字段 / retryPolicy / compat）
 * + 模型目录（行默认折叠，见 views/models.tsx）。
 * @module llm-pi/client/views/providers
 */

import { ChevronDownIcon } from '@dsh-plus/shared/client'
import { type ReactElement, useState } from 'react'

import type { ProviderDraft } from '../draft.ts'
import { extraOfJson } from '../draft.ts'
import { CollapseSection, JsonField, KeyValueEditor } from '../fields.tsx'
import type { Translate } from '../i18n.ts'
import { CompatEditor } from './compat.tsx'
import { ModelsTable } from './models.tsx'
import { ProviderScalarFields, ProviderSelectFields } from './provider-fields.tsx'

export interface ProvidersSectionProps {
  providers: Record<string, ProviderDraft>
  /** route → 展开态（卡片持有；缺失即收起）。 */
  openRoutes: Record<string, boolean>
  epoch: number
  disabled?: boolean
  t: Translate
  onAddRoute(key: string): void
  onRemoveRoute(route: string): void
  onPatchProvider(route: string, patch: Partial<ProviderDraft>): void
  onToggleRoute(route: string, open: boolean): void
  onCollapseAll(): void
  onExpandAll(): void
  /** 打开「内置模型目录」并把该 route 设为添加目标。 */
  onAddFromCatalog(route: string): void
}

export function ProvidersSection(props: ProvidersSectionProps): ReactElement {
  const [newRoute, setNewRoute] = useState('')
  const [routeError, setRouteError] = useState('')
  const routes = Object.keys(props.providers)
  const submitAdd = (): void => {
    const key = newRoute.trim()
    if (key === '') {
      setRouteError(props.t('routeEmpty'))
      return
    }
    if (props.providers[key] !== undefined) {
      setRouteError(props.t('routeDuplicate'))
      return
    }
    props.onAddRoute(key)
    setNewRoute('')
    setRouteError('')
  }
  return (
    <div className="lpc-section">
      <div className="lpc-modelHead">
        <span className="lpc-modelTitle">{props.t('providersGroup')}</span>
        {routes.length > 1 ? (
          <>
            <button
              type="button"
              className="lpc-btn lpc-btnGhost lpc-btnSmall"
              disabled={props.disabled === true}
              onClick={props.onCollapseAll}
            >
              {props.t('providersCollapseAll')}
            </button>
            <button
              type="button"
              className="lpc-btn lpc-btnGhost lpc-btnSmall"
              disabled={props.disabled === true}
              onClick={props.onExpandAll}
            >
              {props.t('providersExpandAll')}
            </button>
          </>
        ) : null}
      </div>
      <div className="lpc-addRoute">
        <input
          className={`lpc-input${routeError !== '' ? ' lpc-inputInvalid' : ''}`}
          value={newRoute}
          disabled={props.disabled === true}
          placeholder={props.t('addRoutePlaceholder')}
          onChange={(event) => {
            setNewRoute(event.target.value)
            setRouteError('')
          }}
        />
        <button
          type="button"
          className="lpc-btn lpc-btnGhost"
          disabled={props.disabled === true}
          onClick={submitAdd}
        >
          {props.t('addRoute')}
        </button>
      </div>
      {routeError !== '' ? <p className="lpc-invalid">{routeError}</p> : null}
      {Object.entries(props.providers).map(([route, draft]) => (
        <ProviderSection
          key={route}
          route={route}
          draft={draft}
          open={props.openRoutes[route] === true}
          epoch={props.epoch}
          disabled={props.disabled === true}
          t={props.t}
          onToggle={() => props.onToggleRoute(route, props.openRoutes[route] !== true)}
          onRemove={() => props.onRemoveRoute(route)}
          onPatch={(patch) => props.onPatchProvider(route, patch)}
          onAddFromCatalog={() => props.onAddFromCatalog(route)}
        />
      ))}
    </div>
  )
}

export interface ProviderSectionProps {
  route: string
  draft: ProviderDraft
  open: boolean
  epoch: number
  disabled?: boolean
  t: Translate
  onToggle(): void
  onRemove(): void
  onPatch(patch: Partial<ProviderDraft>): void
  onAddFromCatalog(): void
}

export function ProviderSection(props: ProviderSectionProps): ReactElement {
  const { route, draft, t } = props
  const id = route.replace(/[^a-zA-Z0-9_-]/g, '_')
  const adapter = typeof draft.extra['adapter'] === 'string' ? draft.extra['adapter'] : 'pi'
  const summary =
    draft.api !== '' ? draft.api : draft.extends !== '' ? `extends ${draft.extends}` : adapter
  const modelCount = draft.models.length
  const meta = modelCount > 0 ? `${modelCount}` : ''
  const fieldProps = {
    id,
    draft,
    disabled: props.disabled === true,
    t,
    onPatch: props.onPatch,
  }
  return (
    <div className="lpc-route">
      <div className="lpc-routeHead">
        <button
          type="button"
          className="lpc-routeToggle"
          aria-expanded={props.open}
          onClick={props.onToggle}
        >
          <ChevronDownIcon className={`lpc-chevron${props.open ? ' lpc-chevronOpen' : ''}`} />
          <span className="lpc-routeKey">{route}</span>
          {summary !== '' ? <span className="lpc-routeApi">{summary}</span> : null}
          {meta !== '' ? <span className="lpc-collapseMeta">{meta}</span> : null}
        </button>
        <button
          type="button"
          className="lpc-btn lpc-btnGhost lpc-btnSmall"
          disabled={props.disabled === true}
          onClick={props.onRemove}
        >
          {t('deleteRoute')}
        </button>
      </div>
      {props.open ? (
        <div className="lpc-routeBody">
          <p className="lpc-groupLabel">{t('providerFields')}</p>
          <ProviderScalarFields {...fieldProps} />
          <ProviderSelectFields {...fieldProps} />
          <KeyValueEditor
            id={`${id}-headers`}
            label={t('headers')}
            hint={t('headersHint')}
            pairs={draft.headers}
            disabled={props.disabled === true}
            keyPlaceholder={t('key')}
            valuePlaceholder={t('value')}
            addLabel={t('add')}
            removeLabel={t('remove')}
            onEdit={(headers) => props.onPatch({ headers })}
          />
          <CollapseSection id={`${id}-advanced`} title={t('advancedGroup')} defaultOpen={false}>
            <JsonField
              id={`${id}-extra`}
              label={t('extraFields')}
              hint={t('extraFieldsHint')}
              invalidText={t('invalidJson')}
              value={Object.keys(draft.extra).length === 0 ? undefined : draft.extra}
              epoch={props.epoch}
              disabled={props.disabled === true}
              wide
              onEdit={(extra) => {
                const next = extraOfJson(extra)
                // 合法但非对象的 JSON（数组/标量）忽略这次编辑，不静默清空已配置字段。
                if (next !== undefined) props.onPatch({ extra: next })
              }}
            />
            <JsonField
              id={`${id}-retry`}
              label={t('retryPolicy')}
              hint={t('retryPolicyHint')}
              invalidText={t('invalidJson')}
              value={draft.retryPolicy}
              epoch={props.epoch}
              disabled={props.disabled === true}
              wide
              onEdit={(retryPolicy) => props.onPatch({ retryPolicy })}
            />
            <CompatEditor
              idPrefix={`${id}-compat`}
              api={draft.api}
              compat={draft.compat}
              epoch={props.epoch}
              disabled={props.disabled === true}
              wide
              t={t}
              onEdit={(compat) => props.onPatch({ compat })}
            />
          </CollapseSection>
          <ModelsTable
            route={route}
            api={draft.api}
            models={draft.models}
            epoch={props.epoch}
            disabled={props.disabled === true}
            t={t}
            onModels={(models) => props.onPatch({ models })}
            onAddFromCatalog={props.onAddFromCatalog}
          />
        </div>
      ) : null}
    </div>
  )
}
