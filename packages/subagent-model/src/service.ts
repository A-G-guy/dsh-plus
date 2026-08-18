/**
 * SubagentModelService：子代理模型配置中枢。
 * - 配置：installSettingsSection 接入 settings 用户层（$DSH_HOME/settings.yaml，热生效），
 *   无 settings provider 时退化为 cordis 行级 config；写入经 validate 钩子
 *   走 validateEntries 规则（model 不能脱离 provider 等），非法即拒。
 * - 委托挂钩：包装 ctx.subagents.start/startContinuable，按 provider 名注入
 *   agentOptions（provider/model/effort 私有标记），未命中条目完全直通。
 * - 子代理路由：根 ctx 的 agent/request 瀑布监听，把条目 effort 应用到子代理请求。
 * - 自定义端点：ctx.webServer 仅注册模型目录路由（配置读写已走官方 settings RPC）。
 * @module @dsh-plus/subagent-model
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { installSettingsSection } from '@deepseek-ai/dsh-settings'

import { registerCatalogApi } from './config-api.ts'
import { Config, SETTINGS_NS, validateEntries, type SubagentModelConfig } from './config.ts'
import { installChildRoute, installDelegationHook } from './delegation.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    subagentModel: SubagentModelService
  }
}

export class SubagentModelService extends Service {
  static [Context.inject] = ['subagents', 'llm']

  private current: () => SubagentModelConfig

  constructor(ctx: Context, config: SubagentModelConfig) {
    super(ctx, 'subagentModel')
    this.current = () => config
    installSettingsSection(ctx, SETTINGS_NS, Config, config, {
      validate: (cfg: SubagentModelConfig) => {
        const error = validateEntries(cfg.entries)
        if (error !== null) throw new Error(`subagent-model: ${error}`)
      },
      setSource: (source) => {
        this.current = source
      },
      onChange: () => {},
    })
    installDelegationHook(ctx, () => this.current())
    installChildRoute(ctx)
    ctx.inject(['webServer'], (webCtx) => {
      registerCatalogApi(webCtx)
    })
  }

  /** 当前生效配置（settings 用户层解析结果或 cordis 行级 config）。 */
  currentConfig(): SubagentModelConfig {
    return this.current()
  }

  /** 已注册的子代理 provider 名（配置卡片据此合成行）。 */
  subagentProviders(): string[] {
    const subagents = this.ctx.get('subagents')
    return subagents === undefined ? [] : [...subagents.list()]
  }
}
