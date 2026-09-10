/**
 * 配置单一事实源：cordis 行级 Config（组合默认值）与 settings namespace
 * （用户层，$DSH_HOME/settings.yaml 热生效）共用同一 schemastery schema。
 * `secrets` 只是全局密钥的**元数据索引**（后缀/描述/创建时间），
 * 值永远走 dsh-credentials seam（$DSH_HOME/.credentials.yaml），不进本文件。
 * @module secret-env/config
 */
import z from '@deepseek-ai/schemastery'

import { SETTINGS_NS as NS_LITERAL } from './ns.ts'

/** settings 命名空间（字面量即合法命名空间，0.1.2-alpha.2 起编译期校验）。 */
export const SETTINGS_NS = NS_LITERAL

/** 一条全局密钥的元数据（值不在此处）。 */
export interface SecretMeta {
  name: string
  description: string
  createdAt: string
}

/** `secrets` 条目入参形态（schema 各字段均有 default，故调用方可省略）。 */
export interface SecretMetaInput {
  name?: string
  description?: string
  createdAt?: string
}

// 显式标注而非 `any`：z.object() 的推断类型含 cosmokit 的 `& Dict` 索引签名，
// 直接导出会触发 TS2883（inferred type cannot be named / not portable）并使
// tsdown 的 dts 生成失败。标注成具名契约后既保住类型、又让产物可移植。
const SecretMetaSchema: z<SecretMetaInput, SecretMeta> = z.object({
  name: z.string().min(1).description('变量名后缀（如 GITHUB_TOKEN）').default(''),
  description: z.string().description('用途描述（仅人读，不进提示词）').default(''),
  createdAt: z.string().description('创建时间 ISO').default(''),
})

export const Config = z.object({
  secrets: z.array(SecretMetaSchema).description('全局密钥元数据索引（值存凭据库）').default([]),
  masked: z
    .array(z.string())
    .description('全局屏蔽的变量名后缀（继承变量等；注入时跳过）')
    .default([]),
})

export type SecretEnvConfig = Schemastery.TypeT<typeof Config>
