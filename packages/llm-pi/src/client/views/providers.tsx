/**
 * Provider 路由编辑：每个 route 一张可折叠小节（键名 + 标量字段 +
 * headers 键值对 + retryPolicy JSON + compat + 模型目录）。
 * 支持新增 route（输入键名）与删除 route。
 * @module llm-pi/client/views/providers
 */

import { ChevronDownIcon } from '@dsh-plus/shared/client'
import { type ReactElement, useState } from 'react'

import type { ProviderDraft } from '../draft.ts'
import { CollapseSection, JsonField, KeyValueEditor } from '../fields.tsx'
import { CompatEditor } from './compat.tsx'
import { ModelsTable } from './models.tsx'
import { ProviderScalarFields, ProviderSelectFields } from './provider-fields.tsx'

export interface ProvidersSectionProps {
  providers: Record<string, ProviderDraft>
  epoch: number
  disabled?: boolean
  t(key: string): string
  onAddRoute(key: string): void
  onRemoveRoute(route: string): void
  onPatchProvider(route: string, patch: Partial<ProviderDraft>): void
}

export function ProvidersSection(props: ProvidersSectionProps): ReactElement {
  const [newRoute, setNewRoute] = useState('')
  const [routeError, setRouteError] = useState('')
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
      <p className="lpc-groupLabel">{props.t('providersGroup')}</p>
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
          epoch={props.epoch}
          disabled={props.disabled === true}
          t={props.t}
          onRemove={() => props.onRemoveRoute(route)}
          onPatch={(patch) => props.onPatchProvider(route, patch)}
        />
      ))}
    </div>
  )
}

export interface ProviderSectionProps {
  route: string
  draft: ProviderDraft
  epoch: number
  disabled?: boolean
  t(key: string): string
  onRemove(): void
  onPatch(patch: Partial<ProviderDraft>): void
}

export function ProviderSection(props: ProviderSectionProps): ReactElement {
  const [open, setOpen] = useState(false)
  const { route, draft, t } = props
  const id = route.replace(/[^a-zA-Z0-9_-]/g, '_')
  const summary =
    draft.api !== '' ? draft.api : draft.extends !== '' ? `extends ${draft.extends}` : ''
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
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <ChevronDownIcon className={`lpc-chevron${open ? ' lpc-chevronOpen' : ''}`} />
          <span className="lpc-routeKey">{route}</span>
          {summary !== '' ? <span className="lpc-routeApi">{summary}</span> : null}
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
      {open ? (
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
            defaultProvider={draft.extends}
            models={draft.models}
            epoch={props.epoch}
            disabled={props.disabled === true}
            t={t}
            onModels={(models) => props.onPatch({ models })}
          />
        </div>
      ) : null}
    </div>
  )
}
