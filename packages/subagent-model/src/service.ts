/**
 * SubagentModelService：子代理模型配置中枢（host 半）。
 * - 配置：0.1.7 volatile 活动引用（loader 解析层并入用户层，GUI 写入原位提交
 *   热生效）；写入经 internal/config waterfall 校验（validateEntries 规则
 *   （model 不能脱离 provider 等），非法即拒、不落盘）。
 * - 委托挂钩：包装 ctx.subagents.start/startContinuable，按 provider 名
 *   （未命中回落 default 条目）注入 agentOptions（provider/model/effort）。
 * - 自定义端点：ctx.webServer 仅注册模型目录路由（配置读写已走官方
 *   remote.settings 直连，配置卡片（三槽位注册）见 client 半）。
 * @module @dsh-plus/subagent-model
 */
import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { unwrapVolatile } from '@dsh-plus/shared'

import {
  Config,
  type SubagentModelConfig,
  type SubagentModelConfigFields,
  type SubagentModelConfigInput,
  validateEntries,
} from './config.ts'
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

  constructor(ctx: Context, config: SubagentModelConfig | SubagentModelConfigFields) {
    super(ctx, 'subagentModel')
    // 0.1.7 替代 installSection/setSource：活动引用原位提交——委托挂钩
    // 永远现取最新配置，热生效无竞态。
    this.current = () => unwrapVolatile(config)
    // 写入校验（原 installSection validate；官方 llm-pi-ai 同款 waterfall）：
    // configEditor.edit 落盘前先跑 internal/config，handler throw 即拒绝整笔写入。
    ctx.on('internal/config', function (_raw: unknown, next: () => unknown) {
      const candidate = next()
      if (this !== ctx.fiber) return candidate
      const error = validateEntries(
        unwrapVolatile(Config(candidate as SubagentModelConfigInput)).entries,
      )
      if (error !== null) throw new Error(`subagent-model: ${error}`)
      return candidate
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
