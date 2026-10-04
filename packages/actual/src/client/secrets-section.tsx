/**
 * 「凭据」小节：三行密钥（服务器口令 / 会话令牌 / 端到端加密口令），
 * 每行可写可清，右侧徽标显示「已配置 / 未配置」。
 *
 * 行内只做呈现与暂存：值一经保存即从输入框清空，不回显、不驻留 DOM；
 * 引用被进程环境遮蔽（`writable:false`）时禁用编辑并说明原因——这正是
 * 部署方把口令放进 systemd/shell 环境的场景，必须让用户看懂为什么改不了。
 * @module @dsh-plus/actual/client/secrets-section
 */
import { Button, TextField } from '@dsh-plus/shared/client'
import { type ReactElement, useState } from 'react'

import { REF_ENCRYPTION_PASSWORD, REF_PASSWORD, REF_SESSION_TOKEN } from '../refs.ts'
import type { DictKey, Translate } from './i18n.ts'
import {
  type CredentialsRemoteFace,
  type CredentialView,
  useCredentials,
  viewOf,
} from './secrets.ts'

/** 一行密钥的定义：引用名 + 文案键。 */
interface SecretRowSpec {
  ref: string
  labelKey: DictKey
  hintKey: DictKey
}

/** 三行密钥的固定顺序（口令 → 令牌 → 加密口令）。 */
export const SECRET_ROWS: readonly SecretRowSpec[] = [
  { ref: REF_PASSWORD, labelKey: 'secretPassword', hintKey: 'secretPasswordHint' },
  { ref: REF_SESSION_TOKEN, labelKey: 'secretToken', hintKey: 'secretTokenHint' },
  {
    ref: REF_ENCRYPTION_PASSWORD,
    labelKey: 'secretEncryption',
    hintKey: 'secretEncryptionHint',
  },
]

interface SecretRowProps {
  t: Translate
  row: SecretRowSpec
  view: CredentialView
  busy: boolean
  onSave(ref: string, value: string): Promise<boolean>
  onClear(ref: string): Promise<boolean>
}

/** 单行密钥：输入框 + 保存/清除，保存成功后清空输入。 */
function SecretRow(props: SecretRowProps): ReactElement {
  const { t, row, view, busy } = props
  const [text, setText] = useState('')
  const locked = busy || !view.writable

  return (
    <div className="act-secret">
      <TextField
        prefix="act"
        id={`act-secret-${row.ref}`}
        label={t(row.labelKey)}
        hint={t(row.hintKey)}
        password
        value={text}
        disabled={locked}
        badge={{ text: t(view.configured ? 'secretSet' : 'secretUnset'), set: view.configured }}
        onEdit={setText}
      />
      <div className="act-secretActions">
        <Button
          prefix="act"
          variant="primary"
          label={t('save')}
          disabled={locked || text === ''}
          onClick={() => {
            void props.onSave(row.ref, text).then((ok) => {
              if (ok) setText('')
            })
          }}
        />
        <Button
          prefix="act"
          variant="ghost"
          label={t('secretClear')}
          disabled={locked || !view.configured}
          onClick={() => {
            void props.onClear(row.ref)
          }}
        />
      </div>
      {view.writable ? null : <p className="act-warn">{t('secretShadowed')}</p>}
    </div>
  )
}

/** 凭据小节（读写经官方 `remote.credentials`）。 */
export function SecretsSection(props: { t: Translate; face: CredentialsRemoteFace }): ReactElement {
  const { t, face } = props
  const { views, busy, error, save, clear } = useCredentials(face)
  return (
    <div className="act-section">
      <div className="act-sectionHead">
        <h3 className="act-sectionTitle">{t('secretsTitle')}</h3>
      </div>
      <p className="act-sectionDesc">{t('secretsBody')}</p>
      <div className="act-sectionBody">
        {SECRET_ROWS.map((row) => (
          <SecretRow
            key={row.ref}
            t={t}
            row={row}
            view={viewOf(views, row.ref)}
            busy={busy}
            onSave={save}
            onClear={clear}
          />
        ))}
      </div>
      {error === '' ? null : (
        <p className="act-warn">
          {t('secretFailed')}
          {error}
        </p>
      )}
    </div>
  )
}
