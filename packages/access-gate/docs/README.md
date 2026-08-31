---
last_modified: "2026-08-31 15:30"
---

# @dsh-plus/access-gate

dsh web 的全量访问围栏：为全部 HTTP / WebSocket 流量提供访问控制，**与官方
browser-auth 合并**——官方 cookie 为唯一访问凭据，本插件补齐官方不覆盖的面
（静态资产、插件自有路由、可选 IP 附加围栏）并恢复 PWA 可用性。
service+ui 混合插件（node 半拦截判定，浏览器半提供配置卡片）。

## 与官方认证的关系（0.2.0 起，合并决策）

官方（dsh 0.1.2-alpha 线）browser-auth 的覆盖与缺口：

- 官方守护：index（`?token=` 启动令牌交换签发 cookie）、`/api`、connection WS；
- 官方缺口：**静态资产公开**、插件自有路由（如 web-terminal 的 WS）不在认证范围、
  PWA `start_url` 固定 `/` 无法携带 token（存储隔离平台上 PWA 永远无法登录）；
- 官方 cookie：`dsh-auth-<sha256(authority)>`，HttpOnly + SameSite=Strict，
  默认 30 天，**绑定具体 host:port**；启动令牌每进程随机生成，重启即换。

合并后语义：本插件不再持有自有 token/cookie/登录端点（旧 `dsh_gate` 通道删除——
它本就只能过 gate、换不来应用可用性，官方 `/api` 无 cookie 仍 401）。凭据校验
委托 `connection.requestRejection()`。

## 放行规则

| 通道 | 条件 | 说明 |
|---|---|---|
| 本机直连 | `remoteAddress` 为 loopback 且（XFF 不被信任或不存在） | 管理通道，gate 层永久放行——防锁死兜底 |
| 官方 cookie | `connection.requestRejection()` 通过（含官方 Host 信任围栏） | 唯一凭据；token 输入页粘贴启动令牌换取 |
| 附加 IP 围栏 | `allowedIps` 非空时，还原的客户端 IP 必须命中（精确 IP 或 CIDR，v4/v6） | **附加层**：不命中即拒，即使持有效官方 cookie；空 = 不限制来源 IP |

未认证请求：浏览器导航（GET + accept 含 text/html）→ **token 输入页**；
API / 静态资产 / WebSocket 升级 → 403 / 拒绝升级。`enabled=false` 时完全旁路。

## token 输入页（PWA 恢复机制）

未认证导航返回内联自包含页面（200，`cache-control: no-store`）：粘贴当前启动令牌
→ 客户端 `fetch('/?token=…')` 走官方交换（303 + Set-Cookie 落罐）→ 进入 `/`。
纯客户端跳转，无服务器端点、无节流面，令牌校验完全由官方 `authorizeIndex` 完成。

**PWA 恢复**：官方限制下 PWA 启动无法携带 `?token=`，存储隔离平台（iOS 等）
的 PWA cookie 罐与浏览器不共享——本页在 PWA 内同样渲染，粘贴一次令牌即在
PWA 自己的存储里完成官方交换，死结解除。PWA 安装资产（`/manifest.webmanifest`、
`/favicon.svg`）与令牌交换请求（`GET /?token=`）为围栏豁免路径。

启动令牌获取（随每次 dsh web 重启更新）：

- 服务器上 `dshctl url`（自签 cookie 或 journal 捞取，见 scripts 文档）；
- 本机直连访问 `GET /dsh-plus/gate/launch-url`（见下）；
- `journalctl -u dsh-web | grep "dsh web:"` 捞启动日志行。

## 信任模型（决策记录）

- 生产链路 `tailscale serve (https:3080) → dsh-proxy(127.0.0.1:3081) → dsh(127.0.0.1:3080)`
  全程 loopback，dsh 看到的连接来源永远是 127.0.0.1——真实客户端 IP 只能经
  `x-forwarded-for` 还原。
- **已实测**（tailscale 1.102.2）：serve 注入 `x-forwarded-for`（真实 tailscale 源 IP）
  且会**覆盖**客户端伪造的同名头。`trustForwardedFor=true`（默认）时取 XFF 最左条目。
- XFF 被信任时：存在 XFF 即代表请求经代理——remoteAddress 是 loopback 也**不**直通，
  必须按 XFF 判定。XFF 不被信任时：来源即 remoteAddress，loopback 直连 → 放行。
- 能直发 loopback 或伪造 XFF 的只有本机进程——与官方围栏的既有信任边界一致。

## 拦截机制

dsh-host-webserver 无中间件机制，本插件对 `ctx.webServer` 服务实例做**结构性包装**：

1. `match(pathname)`——HTTP 分发总咽喉：patch 为请求级围栏判定，放行返回浅拷贝 route
   （handler 外包 gate，原 route 对象不动）；拒绝返回内联拒绝 route。
2. `fallback` 字段 + `registerFallback`——SPA index/静态资源：在位包装已注册的
   fallback（frontend-static 先于本插件加载），并 patch 方法兜底后续注册。
3. `upgrades` Map + `registerUpgrade`——WS 升级双路径覆盖；拒绝时回官方同款 403。

结构守卫：安装前校验字段形状，不符即 fail-loud 抛错——启动失败由 lifeboat 自动隔离
止损，**绝不静默 fail-open**。所有 patch 登记 undo，dispose / HMR 时完全还原。
`enabled=false` 时 match 直通原实现，零开销。

## 自有端点（围栏豁免路径 `/dsh-plus/gate/*`）

| 端点 | 方法 | 说明 |
|---|---|---|
| `/dsh-plus/gate/status` | GET | 当前客户端判定状态（verdict/clientIp/reason/officialAuthed/ipFenceActive/白名单非法条目），卡片诊断用 |
| `/dsh-plus/gate/launch-url` | GET | **仅本机直连**（loopback 且无 XFF）：返回当前进程认证链接 `{url}`；令牌跨 authority 有效，支持 `?host=&scheme=` 生成远程变体（如 tailscale 域名 https） |

## 配置

cordis 行级 `Config`（组合默认值）与 settings namespace `dsh-plus-access-gate`
（用户层）共用同一 schemastery schema，经 dsh-settings-file 落
`$DSH_HOME/settings.yaml` 热生效。

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | false | 总开关（配置完成再开启，安全上线） |
| `allowedIps` | [] | 附加 IP 围栏：精确 IP 或 CIDR（v4/v6）；空 = 不限制来源 IP |
| `trustForwardedFor` | true | 仅当入口代理强制覆盖 XFF 时开启（tailscale serve 满足） |

**旧配置迁移**：0.1.x 的 `token`/`cookieMaxAgeHours`/`loginFailLimit`/`loginCooldownMs`
键已删除；schemastery 透传忽略未知键（有测试钉死），旧 settings.yaml 不阻断加载，
旧值自然失效。旧的 `dsh_gate` cookie 不再有任何效力。

## WebUI 配置卡片

浏览器半注册进官方 `settings.plugin.item` keyed 插槽（设置 → 插件 → 插件配置），
配置读写走官方 settings RPC；卡片附「当前页面诊断」（本页判定/客户端 IP/放行原因/
官方登录状态/白名单非法条目）。

## 防锁死与回滚

- 本机直连 gate 层永久放行：远程全锁时 ssh 隧道访问 `127.0.0.1:3080`，经
  `/dsh-plus/gate/launch-url` 取当前令牌完成官方登录后改配置。
- 配错即时可逆：卡片写 settings.yaml 热生效；白名单改坏只影响远程，本机不受影响。
- 回滚：`dshctl uninstall-prod @dsh-plus/access-gate`（或用户 patch 层
  `- id: dsh-plus-access-gate` + `disabled: true`）+ 重启。
- upstream 形状变化：apply 期 fail-loud，lifeboat 隔离，webui 回到无围栏可用状态。

## 与其他插件的关系

- **lifeboat**：本插件在其 `dsh-plus-*` 守护范围内，启动失败自动隔离止损。
- **web-files / web-terminal**：其 HTTP/WS 路由本就被本围栏全覆盖；路径级策略留作扩展点。

## 开发与验证

```bash
pnpm --filter @dsh-plus/access-gate build      # 双入口构建
node --test packages/access-gate/tests/*.test.ts # 单元测试（纯逻辑，无网络）
```

dev 实例验证（零费用）：`dshctl dev up` 后 curl 模拟链路——
`-H "X-Forwarded-For: …"` 即等效远程流量（dev 无 serve，手工注入 XFF）；
官方 cookie 侧用 `dshctl url --dev` 取令牌先完成一次交换。
