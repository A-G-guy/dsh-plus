/**
 * PiAiAdapter 认证注入的内联实现（官方 llm-pi-ai/src/auth.ts 的等价移植）。
 *
 * 官方 credentialStoreFrom/authContextFrom 仅在 @deepseek-ai/dsh-llm-pi-ai 的
 * src/auth.ts 子路径导出（包根只导出 recordKeyFor），而 npm 发布形态不携带
 * src/（lib/index.js 单 bundle）——dsh 树 dev 布局优先经 src 子路径走官方
 * 实现（见 resolve-dsh.ts 探测），本文件在其余形态（npm 布局的 dsh 树 /
 * vendored 兜底）下按官方语义逐行等价实现，并经 assertKitShape 自检兜底。
 * recordKeyFor 由调用方注入（与 PiAiAdapter 同源模块的包根导出，保证记录
 * 键格式与官方写入方一致）。
 * @module llm-pi/auth-inline
 */
import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve as resolvePath } from 'node:path'

import type { Context } from '@deepseek-ai/cordis'
import type {
  CredentialKey,
  CredentialProvider,
  CredentialRecord,
} from '@deepseek-ai/dsh-credentials'
import {
  credentialKeyId,
  credentialKeyScope,
  credentialRef,
  isCredentialKeySegment,
  isCredentialRefName,
} from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { LlmError } from '@deepseek-ai/dsh-llm'
import type {
  AuthContext,
  Credential,
  CredentialInfo,
  CredentialStore,
} from '@earendil-works/pi-ai'

/** 官方 RECORD_SCOPE 常量（llm-pi-ai/src/auth.ts）——读写作用域必须与官方一致。 */
export const INLINE_RECORD_SCOPE = 'llm-pi-ai'

/** 官方 jsonImage：pi-ai 凭据里显式 undefined 成员 JSON 序列化为缺省/数组 null。 */
function jsonImage(value: unknown): unknown {
  if (Array.isArray(value))
    return value.map((entry) => (entry === undefined ? null : jsonImage(entry)))
  if (
    typeof value === 'object' &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    const image: Record<string, unknown> = {}
    for (const [key, member] of Object.entries(value)) {
      if (member !== undefined) image[key] = jsonImage(member)
    }
    return image
  }
  return value
}

/** 官方 toPiCredential：api-key 记录按字段重建；grant 载荷原样透传。 */
function toPiCredential(record: CredentialRecord | undefined): Credential | undefined {
  if (record === undefined) return undefined
  if (record.kind === 'api-key') {
    return {
      type: 'api_key',
      ...(record.key === undefined ? {} : { key: record.key }),
      ...(record.env === undefined ? {} : { env: { ...record.env } }),
    }
  }
  return record.payload as Credential
}

/** 官方 toRecord：pi-ai 凭据 → 可存储的记录联合。 */
function toRecord(credential: Credential): CredentialRecord {
  if (credential.type === 'api_key') {
    return {
      kind: 'api-key',
      ...(credential.key === undefined ? {} : { key: credential.key }),
      ...(credential.env === undefined ? {} : { env: { ...credential.env } }),
    }
  }
  return { kind: 'grant', payload: jsonImage(credential) }
}

/** 官方 writableStore：写路径需要凭据服务，缺失时抛 NO_CREDENTIAL_STORE。 */
function writableStore(ctx: Context): CredentialProvider {
  const credentials = ctx.get('credentials')
  if (credentials === undefined) {
    throw new LlmError(
      'llm-pi: 当前组合未挂载凭据服务（dsh-credentials-local），登录产生的凭据无处存储',
      'NO_CREDENTIAL_STORE',
    )
  }
  return credentials
}

/**
 * pi-ai `CredentialStore`（官方 credentialStoreFrom 等价实现）。
 * 路由键任意而记录 id 受语法约束：语法外的 id 读答"未存储"、删除无事可做、
 * modify 拒绝（写不落地不能报成功）。
 */
export function credentialStoreFrom(
  ctx: Context,
  recordKeyFor: (providerId: string) => CredentialKey,
): CredentialStore {
  return {
    async read(providerId) {
      const credentials = ctx.get('credentials')
      if (credentials === undefined) return undefined
      if (!isCredentialKeySegment(providerId)) return undefined
      return toPiCredential(await credentials.readRecord(recordKeyFor(providerId)))
    },
    async list(): Promise<readonly CredentialInfo[]> {
      const stored = (await ctx.get('credentials')?.listRecords()) ?? []
      const mine: CredentialInfo[] = []
      for (const entry of stored) {
        if (credentialKeyScope(entry.key) !== INLINE_RECORD_SCOPE) continue
        mine.push({
          providerId: credentialKeyId(entry.key),
          type: entry.kind === 'api-key' ? 'api_key' : 'oauth',
        })
      }
      return mine
    },
    async modify(providerId, mutate) {
      if (!isCredentialKeySegment(providerId)) {
        throw new LlmError(
          `llm-pi: provider id "${providerId}" 无法寻址存储的凭据记录（记录 id 是小写连字符标识）；` +
            '该 route 请改用 apiKeyEnv 认证',
          'UNSTORABLE_PROVIDER_ID',
        )
      }
      const stored = await writableStore(ctx).modifyRecord(
        recordKeyFor(providerId),
        async (current) => {
          const next = await mutate(toPiCredential(current))
          return next === undefined ? undefined : toRecord(next)
        },
      )
      return toPiCredential(stored)
    },
    async delete(providerId) {
      if (!isCredentialKeySegment(providerId)) return
      await writableStore(ctx).deleteRecord(recordKeyFor(providerId))
    },
  }
}

/**
 * pi-ai `AuthContext`（官方 authContextFrom 等价实现）：
 * env() 先查凭据服务（存储的环境值对 provider 自发现可见），再回退启动环境；
 * fileExists() 问宿主进程文件系统（~/.aws/credentials 等是本进程所在机器的事实）。
 */
export function authContextFrom(ctx: Context): AuthContext {
  return {
    async env(name) {
      if (isCredentialRefName(name)) {
        const credentials = ctx.get('credentials')
        const hit = await credentials?.resolve(credentialRef(name))
        if (hit !== undefined) return hit.value
      }
      return launchEnvironmentOf(ctx).get(name)?.value
    },
    async fileExists(path) {
      const expanded =
        path.startsWith('~/') || path === '~'
          ? resolvePath(homedir(), path.slice(1).replace(/^\//, ''))
          : path
      try {
        await access(expanded)
        return true
      } catch {
        return false
      }
    },
  }
}
