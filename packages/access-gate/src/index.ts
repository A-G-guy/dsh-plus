/**
 * dsh 插件：访问围栏（access-gate）。
 *
 * 为 dsh web 的全部 HTTP/WebSocket 流量提供访问安全校验与访问控制：
 * - 本机直连（loopback 且无 x-forwarded-for）永久放行——管理通道，防锁死；
 * - 远程流量按 tailscale serve 注入的 x-forwarded-for 还原真实客户端 IP，
 *   命中白名单（精确 IP / CIDR，v4+v6）即放行；
 * - 或持有效 token（登录页换取 HttpOnly cookie）放行；
 * - 其余：浏览器导航返回登录页，API / WS 一律 403 / 拒绝升级。
 *
 * 配置：settings 命名空间 dsh-plus-access-gate（webui 配置卡片同一份，
 * 热生效）；enabled=false 时完全旁路（等价插件缺席）。
 * 安全边界：结构守卫 fail-loud（upstream 形状变化 → 启动失败 → lifeboat
 * 隔离止损，绝不静默 fail-open）。
 * @module @dsh-plus/access-gate
 */
import { type Context, Service } from '@deepseek-ai/cordis'
import { installSettingsSection } from '@deepseek-ai/dsh-settings'

import { type AccessGateConfig, Config, SETTINGS_NS } from './config.ts'
import { type GateWebServer, installGateInterceptor } from './interceptor.ts'
import { registerGateRoutes } from './routes.ts'

export const name = 'dsh-plus-access-gate'

export const inject = ['webServer'] as const

export { Config }

declare module '@deepseek-ai/cordis' {
  interface Context {
    accessGate: AccessGateService
  }
}

/** 围栏服务：持有当前配置读取器（settings 用户层热更新经 setSource 注入）。 */
export class AccessGateService extends Service {
  private current: () => AccessGateConfig

  constructor(ctx: Context, config: AccessGateConfig) {
    super(ctx, 'accessGate')
    this.current = () => config
    installSettingsSection(ctx, SETTINGS_NS, Config, config, {
      setSource: (source) => {
        this.current = source
      },
      onChange: () => {},
    })
    const logger = ctx.logger('access-gate')

    // 自有端点（/dsh-plus/gate/*，围栏豁免路径）。
    registerGateRoutes(ctx, {
      config: () => this.current(),
      onError: (message) => logger.warn(message),
    })

    // 结构包装：全部 HTTP/WS 流量的围栏。
    const undo = installGateInterceptor(ctx, ctx.webServer as unknown as GateWebServer, {
      config: () => this.current(),
      onBlock: (message) => logger.info(message),
    })
    ctx.effect(() => undo, 'access-gate: interceptor')
  }

  /** 当前生效配置（诊断用）。 */
  policy(): AccessGateConfig {
    return this.current()
  }
}

export function apply(ctx: Context, config: AccessGateConfig): void {
  ctx.plugin(AccessGateService, config)
}
