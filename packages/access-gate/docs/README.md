---
last_modified: "2026-08-25 01:52"
---

# @dsh-plus/access-gate

dsh web 的全量访问围栏：为全部 HTTP / WebSocket 流量提供访问安全校验与访问控制。
service+ui 混合插件（node 半拦截判定，浏览器半提供配置卡片与登录页）。

## 放行规则（任一命中即放行）

| 通道 | 条件 | 说明 |
|---|---|---|
| 本机直连 | `remoteAddress` 为 loopback 且（XFF 不被信任或不存在） | 管理通道，永久放行——防锁死兜底；与 dsh 官方 `/api` 围栏的 loopback 信任边界一致 |
| 白名单 IP | 还原的客户端 IP 命中 `allowedIps`（精确 IP 或 CIDR，v4/v6） | 远程设备免 token 直达 |
| 访问令牌 | cookie `dsh_gate` 与 `token` 常时相等 | 登录页输入 token 换 HttpOnly cookie |

其余请求：浏览器导航（GET + accept 含 text/html）返回登录页（输入 token → 设 cookie → 刷新）；
API / WebSocket 升级一律 403 / 拒绝升级。`enabled=false` 时完全旁路（等价插件缺席）。

## 信任模型（决策记录）

- 生产链路 `tailscale serve (https:3080) → dsh-proxy(127.0.0.1:3081) → dsh(127.0.0.1:3080)`
  全程 loopback，dsh 看到的连接来源永远是 127.0.0.1——真实客户端 IP 只能经
  `x-forwarded-for` 还原。
- **已实测**（tailscale 1.102.2）：serve 注入 `x-forwarded-for`（真实 tailscale 源 IP）与
  `tailscale-user-login/name` 身份头，且会**覆盖**客户端伪造的同名头（spoof 1.2.3.4 被
  覆盖为真实 IP）。因此 `trustForwardedFor=true`（默认）时取 XFF 最左条目即真实客户端。
- XFF 被信任时：存在 XFF 即代表请求经代理——remoteAddress 是 loopback 也**不**放行，
  必须按 XFF 判定（否则 serve→proxy 链路下围栏完全失效）。
- XFF 不被信任时：来源就是 remoteAddress，loopback 即本机直连 → 放行
  （唯一入口是代理的部署在关闭 XFF 信任的瞬间也不会锁死）。
- 能直发 loopback 或伪造 XFF 的只有本机进程——与官方围栏的既有信任边界一致。
- token 比较使用 sha256 摘要 + `crypto.timingSafeEqual` 常时比较。

## 拦截机制

dsh-host-webserver 无中间件机制（官方 README 明示无 auth/origin 策略），本插件对
`ctx.webServer` 服务实例做**结构性包装**：

1. `match(pathname)`——HTTP 分发总咽喉：patch 为请求级围栏判定，放行返回浅拷贝 route
   （handler 外包 gate，原 route 对象不动，杜绝重复包装）；拒绝返回内联拒绝 route
   （连未知路径的探测面也收敛）。
2. `fallback` 字段 + `registerFallback`——SPA index/静态资源：在位包装已注册的
   fallback（frontend-static 先于本插件加载），并 patch 方法兜底后续注册。
3. `upgrades` Map + `registerUpgrade`——WS 升级（`/api/events.mux`、`/api/events.host`）
   双路径覆盖，先/后注册的条目都被拦截；拒绝时回官方同款 403 原始响应。

结构守卫：安装前校验字段形状，不符即 fail-loud 抛错——启动失败由 lifeboat 自动隔离
止损（部署回到无围栏现状），**绝不静默 fail-open**。所有 patch 与在位替换登记 undo，
dispose / HMR 时完全还原。`enabled=false` 时 match 直通原实现，零开销。

## 自有端点（围栏豁免路径 `/dsh-plus/gate/*`）

| 端点 | 方法 | 说明 |
|---|---|---|
| `/dsh-plus/gate/login` | POST | `{token}` → 正确返回 `Set-Cookie: dsh_gate=…; HttpOnly; SameSite=Strict`；错误 403；每 IP 失败 `loginFailLimit` 次进入 `loginCooldownMs` 冷却（429） |
| `/dsh-plus/gate/status` | GET | 当前客户端判定状态（verdict/clientIp/reason/白名单非法条目），卡片诊断与登录页共用 |

登录页为内联自包含 HTML+vanilla JS（无外部静态资源依赖），由围栏在拦截导航请求时
直接返回（200，`cache-control: no-store`）。

## 配置

cordis 行级 `Config`（组合默认值）与 settings namespace `dsh-plus-access-gate`
（用户层）共用同一 schemastery schema，经 dsh-settings-file 落
`$DSH_HOME/settings.yaml` 热生效。

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | false | 总开关（配置完成再开启，安全上线） |
| `token` | ''（secret） | 访问令牌；空 = token 通道关闭；卡片空提交 = 保持不变 |
| `allowedIps` | [] | 放行白名单：精确 IP 或 CIDR（v4/v6 皆可） |
| `trustForwardedFor` | true | 仅当入口代理强制覆盖 XFF 时开启（tailscale serve 满足） |
| `cookieMaxAgeHours` | 720 | 登录 cookie 有效期 |
| `loginFailLimit` | 10 | 每 IP 冷却窗口内失败阈值 |
| `loginCooldownMs` | 60000 | 失败节流冷却 |

fail-closed 语义：`enabled=true` 且 token 空且白名单空 → 拒绝一切远程
（卡片显示醒目警告）。

## WebUI 配置卡片

浏览器半注册进官方 `settings.plugin.item` keyed 插槽（设置 → 插件 → 插件配置），
配置读写走官方 settings RPC（notify-email 同款直连实现，非 loopback 页面一致可用），
token 为 secret 角色（describe secrets 探测已配置，空提交 = 保持）；卡片附
「当前页面诊断」（本页判定/客户端 IP/放行原因/白名单非法条目）与 fail-closed 警告。

## 防锁死与回滚

- 本机直连永久放行：远程全锁时 ssh 隧道访问 `127.0.0.1:3080` 即可改配置。
- 配错即时可逆：卡片写 settings.yaml 热生效，改坏白名单只影响远程，本机直连
  不受影响，可即时改回。
- 回滚：`dshctl uninstall-prod @dsh-plus/access-gate`（或临时在用户 patch 层
  `- id: dsh-plus-access-gate` + `disabled: true`）+ 重启。
- upstream 形状变化：apply 期 fail-loud，lifeboat 隔离，webui 回到无围栏可用状态。

## 与其他插件的关系

- **lifeboat**：本插件在其 `dsh-plus-*` 守护范围内，启动失败自动隔离止损。
- **feature-toggle**：已登记 host 平面开关条目（immediate + 需刷新浏览器）。
- **web-files**：其 `web-files/access` 事件接缝 v1 不重复实现——它的 HTTP 路由
  本就被本围栏全覆盖（远程未放行时根本进不了 handler）；路径级策略留作扩展点。

## 开发与验证

```bash
pnpm --filter @dsh-plus/access-gate build      # 双入口构建
node --test packages/access-gate/tests/*.test.ts # 单元测试（纯逻辑，无网络）
```

dev 实例验证（零费用）：`dshctl dev up` 后 curl 模拟链路——
`-H "X-Forwarded-For: …"` 即等效远程流量（dev 无 serve，手工注入 XFF）。
