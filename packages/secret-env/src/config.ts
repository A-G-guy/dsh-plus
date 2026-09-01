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
// biome-ignore lint/suspicious/noExplicitAny: dts 可移植性——嵌套 schema 的精确类型经 TypeT 消费，显式断掉 cosmokit 推断链
const SecretMetaSchema: any = z.object({
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

/** 一条元数据的运行时形态。 */
export interface SecretMeta {
  name: string
  description: string
  createdAt: string
}
