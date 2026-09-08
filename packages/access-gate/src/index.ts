/**
 * dsh 插件：访问围栏（access-gate）。
 *
 * 与官方 browser-auth 合并后的全量访问围栏：
 * - 访问凭据唯一化为官方 dsh-auth-* cookie（`?token=` 启动令牌交换签发，
 *   30 天、按 authority 分别持有）——凭据校验委托 connection.requestRejection()，
 *   本插件不再持有自有 token/cookie；
 * - 本机直连（loopback 且无 x-forwarded-for）gate 层永久放行——管理通道；
 * - allowedIps 为可选附加 IP 围栏（XFF 还原，精确 IP / CIDR，v4+v6）；
 * - autoLoginTrustedIps=true 时，白名单来源未认证请求自动铸造官方登录
 *   cookie（免启动 token，仅对白名单来源生效；密钥读取失败自动降级）；
 * - 未认证的浏览器导航 → token 输入页（粘贴启动令牌走官方交换，**PWA 内
 *   同路径可用**——恢复官方 start_url 无法携带 token 导致的 PWA 死结）；
 *   未认证的 API / WS / 静态资产 → 403 / 拒绝升级；
 * - 豁免：自有端点（/dsh-plus/gate/*）、PWA 安装资产、官方令牌交换请求。
 *
 * 自有端点：GET /dsh-plus/gate/status（卡片诊断）、GET /dsh-plus/gate/launch-url
 * （仅本机直连，返回当前进程认证链接——令牌跨 authority 有效，支持 host/scheme
 * 参数生成远程变体）。
 *
 * 配置：settings 命名空间 dsh-plus-access-gate（webui 配置卡片同一份，
 * 热生效）；enabled=false 时完全旁路（等价插件缺席）。
 * 安全边界：结构守卫 fail-loud（upstream 形状变化 → 启动失败 → lifeboat
 * 隔离止损，绝不静默 fail-open）；autoLogin 依赖官方签名密钥，读取失败
 * 自动降级为不自动登录（fail-safe）。
 * @module @dsh-plus/access-gate
 */

import type { IncomingMessage } from 'node:http'
import { type Context, Service } from '@deepseek-ai/cordis'
// HostConnectionHandle 的 Context 声明合并（connection 服务类型来源）。
import type {} from '@deepseek-ai/dsh-client-connection'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type {} from '@deepseek-ai/dsh-settings'

import { type AccessGateConfig, Config, SETTINGS_NS } from './config.ts'
import {
  credentialsPath,
  mintAutoLoginCookie,
  readSigningSecretFromFile,
  requestAuthority,
} from './cookie.ts'
import { type GateWebServer, installGateInterceptor } from './interceptor.ts'
import { registerGateRoutes } from './routes.ts'

export const name = 'dsh-plus-access-gate'

export const inject = ['webServer', 'connection'] as const

export { Config }

declare module '@deepseek-ai/cordis' {
  interface Context {
    accessGate: AccessGateService
  }
}

/** 围栏服务：持有当前配置读取器（settings 用户层热更新经 setSource 注入）。 */
export class AccessGateService extends Service {
  private current: () => AccessGateConfig
  /** 官方 browser-auth 签名密钥（惰性读取缓存；读取失败 = null，autoLogin fail-safe 降级）。 */
  private signingSecret: Buffer | null | undefined

  constructor(ctx: Context, config: AccessGateConfig) {
    super(ctx, 'accessGate')
    this.current = () => config
    // 官方 installSection 范式（0.1.2-alpha.2）：settings 提供方在时以行级 config 为
    // base 注册用户层命名空间，缺席/ detach 时回落行级 config。
    ctx.inject(['settings'], (settingsCtx) => {
      settingsCtx.settings.installSection(ctx, SETTINGS_NS, Config, config, {
        setSource: (source) => {
          this.current = source
        },
        onChange: () => {},
      })
    })
    const logger = ctx.logger('access-gate')

    // 官方凭据校验委托：undefined = 已通过（含官方 Host 信任围栏）。
    const officialAuth = (req: IncomingMessage): boolean =>
      ctx.connection.requestRejection({ headers: req.headers }) === undefined

    // 官方 browser-auth 签名密钥（.credentials.yaml）：与官方 cookie 同源，
    // 供 IP 信任自动登录铸造等价 cookie。惰性读取并缓存；失败记一次 warn 并
    // 降级（autoLogin 不生效），围栏本身不受影响。
    const secretOf = (): Buffer | null => this.readSigningSecret(logger)
    // IP 信任自动登录的 cookie 铸造器（判定 autologin 时调用；不可铸返回 null，
    // 拦截器据此回退 token 输入页/403，绝不 fail-open）。
    const autoLoginCookie = (req: IncomingMessage): string | null => {
      const secret = secretOf()
      const authority = requestAuthority(req.headers)
      if (secret === null || authority === undefined) return null
      try {
        return mintAutoLoginCookie(credentialsPath(dshHomePath()), authority, Date.now())
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.warn(`auto-login cookie mint failed: ${message}`)
        return null
      }
    }

    // 自有端点（/dsh-plus/gate/*，围栏豁免路径）。
    registerGateRoutes(ctx, {
      config: () => this.current(),
      officialAuth,
      authenticatedUrl: (baseUrl) => ctx.connection.authenticatedUrl(baseUrl),
      autoLoginReady: () => this.autoLoginSecretReady(logger),
      onError: (message) => logger.warn(message),
    })

    // 结构包装：全部 HTTP/WS 流量的围栏。
    const undo = installGateInterceptor(ctx, ctx.webServer as unknown as GateWebServer, {
      config: () => this.current(),
      officialAuth,
      autoLoginCookie,
      onBlock: (message) => logger.info(message),
    })
    ctx.effect(() => undo, 'access-gate: interceptor')
  }

  /** 当前生效配置（诊断用）。 */
  policy(): AccessGateConfig {
    return this.current()
  }

  /** 官方签名密钥（惰性缓存；失败返回 null 并记录，autoLogin 降级 fail-safe）。 */
  private readSigningSecret(logger: { warn(message: string): void }): Buffer | null {
    if (this.signingSecret !== undefined) return this.signingSecret
    try {
      this.signingSecret = readSigningSecretFromFile(credentialsPath(dshHomePath()))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.warn(`auto-login disabled: ${message}`)
      this.signingSecret = null
    }
    return this.signingSecret
  }

  /** IP 信任自动登录可用性（诊断用）：签名密钥可读即为可用。 */
  autoLoginSecretReady(logger: { warn(message: string): void }): boolean {
    return this.readSigningSecret(logger) !== null
  }
}

export function apply(ctx: Context, config: AccessGateConfig): void {
  ctx.plugin(AccessGateService, config)
}
