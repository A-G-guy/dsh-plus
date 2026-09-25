---
last_modified: "2026-09-25 13:09"
---

# @dsh-plus/web-shell-sw

外壳 Service Worker：把内容寻址的静态资源（`/assets/*`、`/plugins/*` 组合包）
以 cache-first 存入本插件完全掌控的 Cache Storage，index 走 network-first
（仅网络失败时缓存兜底，断网可开外壳）。**不碰 RPC/SSE/认证流，settings
一键注销即恢复原生网络行为**。

## 要解决的问题

`web-cache-headers` 与官方 immutable 头解决了重复传输，但浏览器 HTTP 缓存
可被淘汰、由浏览器策略管辖；断网则完全打不开。Service Worker 提供一层由本
插件完全掌控、可一键拆除的缓存：首访照常回源（顺带填缓存），此后内容寻址
资源零网络往返；禁用开关 = 注销 + 清缓存 = 彻底回到原生。

## 机制

三半协作，均为纯增量：

- **node 半**（`src/index.ts` + `src/route.ts`）：惰性 `inject(['webServer'])`；
  每次渲染 index 推一行 `kind:'global'` 配置（**恒推，含 `enabled:false`**——
  浏览器半据此注销，「行缺席」会使它无法区分禁用与未安装）；精确路由
  `GET/HEAD /dsh-plus/shell-sw.js` 服务生成的 SW 脚本，响应头三件套：
  `content-type: text/javascript`、`service-worker-allowed: /`（脚本在
  `/dsh-plus/` 下而 scope 覆盖全站，缺此头注册即失败）、`cache-control: no-cache`。
- **浏览器半**（`src/client.ts`）：`window load` 后下一个宏任务执行
  `decideClientAction` 裁决——`enabled=true` 且安全上下文 → 幂等注册
  （scope `/`）；`enabled=false` → 注销 scriptURL 匹配的注册 + 删除本插件
  前缀全部缓存；无配置行/非安全上下文 → 零行为。
- **SW 脚本**（`src/sw-script.ts` 生成，`src/decision.ts` 为同一份决策纯函数）：
  - 不 `skipWaiting`、不 `clients.claim`：新版本等所有标签页关闭后才接管，
    绝不在会话中途换实现；首次注册从下一次导航开始接管，当页零影响。
  - fetch 处置三档：同源 GET + `/assets/*`、`/plugins/*`（查询串随键，
    rev 变则键变）→ cache-first；无查询串的 index → network-first；其余
    （`/api` RPC、`/plugins/events` SSE、带查询串的 `/?token=` 交换、
    `/dsh-plus/*`、跨源、Range、非 GET）→ **不调 `respondWith` = 浏览器
    原生行为，零干预**。
  - 入库门槛：仅 `status 200` + `type basic` + `cache-control` 不含
    `no-store/no-cache`——**token 页（no-store）与代理侧 no-store 的 index
    天然免疫，认证内容永不落 Cache Storage**；入库前剥离
    `content-encoding/content-length/transfer-encoding/vary`（fetch 的 body
    已解码，保留编码头会造成解码错配的经典 SW 缓存坑）。
  - 缓存名带版本（`dsh-shell-v1`），`activate` 清同前缀旧版、不碰他方缓存。

## 配置

| 位置 | 键 | 默认 | 说明 |
|---|---|---|---|
| settings.yaml | `dsh-plus-web-shell-sw.enabled` | `true` | 用户层，热生效（下一次页面加载执行注册/注销） |
| cordis 行级 config | `enabled` | `true` | patch 层覆盖用 |

## 演练

- **禁用（恢复原生）**：settings 关掉 → 刷新一次页面 → 控制台出现
  `已注销 SW 并清理缓存`，之后所有请求回到原生网络行为。
- **验证**：DevTools → Application → Service Workers（注册与 scope `/`）、
  Cache Storage（`dsh-shell-v1`）；第二次加载起 `/assets`、`/plugins` 命中
  时 Network 面板显示 `(ServiceWorker)`。
- **完全卸载插件后清理孤儿 SW**（插件卸载后浏览器半不再运行，需手动一次）：
  控制台执行
  `navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister()))`
  与 `caches.keys().then(ks => ks.filter(k => k.startsWith('dsh-shell-')).forEach(k => caches.delete(k)))`。

## 边界与不含

- **仅安全上下文可用**（https / localhost）：tailnet HTTPS 入口正常；裸 http
  的局域网直连降级为「无 SW」，其余插件不受影响。
- **不改 access-gate**：`/dsh-plus/shell-sw.js` 未豁免——注册发生在已认证
  页面（cookie 随请求携带）；会话过期后浏览器更新检查得 403 → 保留现有 SW，
  围栏语义不变，重新认证后自动恢复更新。
- 不碰 `/api`（RPC）、`/plugins/events`（SSE）、token 交换、非同源请求、
  Range 请求；不预缓存（首访照常回源，缓存由真实流量填充）；
  `no-store`/`no-cache`/非 200 响应永不入库。
- 在线时 index 恒走网络（network-first），外壳永不过期；缓存兜底只在
  网络失败时出现——不装壳、不重放旧会话数据。
- 源码逻辑变更需手动 `SW_CACHE_NAME` 版本 +1（`src/ns.ts`），activate 全量换血。
