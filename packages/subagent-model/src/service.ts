/**
 * SubagentModelService：子代理模型配置中枢（host 半）。
 * - 配置：installSection 接入 settings 用户层（$DSH_HOME/settings.yaml，热生效），
 *   无 settings provider 时退化为 cordis 行级 config；写入经 validate 钩子
 *   走 validateEntries 规则（model 不能脱离 provider 等），非法即拒。
 * - 委托挂钩：包装 ctx.subagents.start/startContinuable，按 provider 名
 *   （未命中回落 default 条目）注入 agentOptions（provider/model/effort）。
 * - 自定义端点：ctx.webServer 仅注册模型目录路由（配置读写已走官方
 *   remote.settings 直连，settings.plugin.item 卡片见 client 半）。
 * @module @dsh-plus/subagent-model
 */
import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'

import { Config, SETTINGS_NS, type SubagentModelConfig, validateEntries } from './config.ts'
import { registerCatalogApi } from './config-api.ts'
import { installDelegationHook } from './delegation.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    subagentModel: SubagentModelService
  }
}

export class SubagentModelService extends Service {
  // 普通 static inject：cordis 4.0.2 不存在 Context.inject 符号（computed key
  // 会失效为 'undefined' 使声明无效）；delegation 挂钩依赖此时序声明。
  static inject = ['subagents', 'llm']

  private current: () => SubagentModelConfig

  constructor(ctx: Context, config: SubagentModelConfig) {
    super(ctx, 'subagentModel')
    this.current = () => config
    // 官方 installSection 范式（同 secret-env/usage-panel）：setSource 收到的是
    // () => scope.get() 活视图——委托挂钩永远现取最新配置，热生效无竞态。
    ctx.inject(['settings'], (settingsCtx) => {
      settingsCtx.settings.installSection(ctx, SETTINGS_NS, Config, config, {
        validate: (cfg: SubagentModelConfig) => {
          const error = validateEntries(cfg.entries)
          if (error !== null) throw new Error(`subagent-model: ${error}`)
        },
        setSource: (source: () => SubagentModelConfig) => {
          this.current = source
        },
        onChange: () => {},
      })
    })
    installDelegationHook(ctx, () => this.current())
    // 模型目录端点（卡片下拉数据源；仅监听 dsh web 同源）。
    ctx.inject(['webServer'], (webCtx) => {
      registerCatalogApi(webCtx)
    })
  }

  /** 当前生效配置（settings 用户层解析结果或 cordis 行级 config）。 */
  currentConfig(): SubagentModelConfig {
    return this.current()
  }
}
