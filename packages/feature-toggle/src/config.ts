/**
 * 配置单一事实源：schemastery schema 同时充当 cordis 行级 Config（组合默认）
 * 与 settings namespace（用户层，$DSH_HOME/settings.yaml 热生效）。
 *
 * features dict 的键经 catalog 封闭校验（非法键在 validate 钩子拒绝），
 * 默认全空 dict = 全部功能启用（零配置零行为变化）。
 * @module feature-toggle/config
 */
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'

import { SETTINGS_NS as NS_LITERAL } from './ns.ts'

/** settings 命名空间；webui 配置卡片与插件运行期读取同一份。 */
export const SETTINGS_NS = settingsNamespace(NS_LITERAL)

/** 行级配置。 */
export const Config = z.object({
  /** 总开关：false 时清理全部管理条目与托管预设并还原默认预设指针。 */
  enabled: z
    .boolean()
    .description('功能开关管理器总开关（false 时清理全部管理痕迹）')
    .default(true),
  /** profile 用户 patch 文件绝对路径；留空自动取 $DSH_HOME/profiles/web/cordis.patch.yml。 */
  patchFile: z
    .string()
    .description('profile 用户 patch 文件绝对路径（留空自动探测 web profile）')
    .default(''),
  /** 托管预设的复制源（default 预设被替换前先复制它）。 */
  sourcePresetId: z.string().description('托管预设的复制源预设 id').default('standard'),
  /** 写入后的健康监视窗口毫秒数。 */
  healthWindowMs: z.natural().description('每次写入后的健康监视窗口毫秒数').default(10000),
})

export type FeatureToggleConfig = Schemastery.TypeT<typeof Config>
