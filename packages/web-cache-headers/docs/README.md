---
last_modified: "2026-09-23 01:06"
---

# @dsh-plus/web-cache-headers

给 GUI 静态资源补长缓存：对内容哈希命名的 `/assets/*` 200 响应增量加
`Cache-Control: public, max-age=31536000, immutable`，消除每次刷新重复传输
~1.4MB（gzip 后约 500KB）JS/CSS。`/plugins/*` 官方已自带同款缓存头，不在范围。

## 要解决的问题

dsh 前端 dist 由 `dsh-host-frontend-static` 经 webserver fallback 服务，响应只带
`content-type`，无 `Cache-Control`/`ETag`——浏览器每次刷新全量重下全部 JS/CSS。
而 dist 文件全部内容哈希命名（JS/CSS/字体/语言包），URL 即内容地址，
本可安全 immutable。

## 机制

进程级拦截 `http.ServerResponse.prototype.writeHead`（`src/patch.ts`）：

- 决策（`src/decision.ts` 纯函数）：GET/HEAD + 路径以 `/assets/` 前缀（段边界）+
  状态恰为 200 + 响应未带 `cache-control` → 补 immutable 头；
- 纯增量：已有 `cache-control` 一律优先（core 未来自带策略时自动共存）；
- 决策异常被隔离，绝不阻断响应写入；引用计数安装，dispose 还原原型。

选进程级拦截而非注册 `/assets` 前缀路由：零路由注册（不与 core 未来路由撞车）、
零文件服务/MIME/dist 路径知识（core 改动无需同步）。这是跟随 dsh 更新
维护成本最低的切面，详见仓库 ADR 0004。

## 配置

| 位置 | 键 | 默认 | 说明 |
|---|---|---|---|
| settings.yaml | `dsh-plus-web-cache-headers.enabled` | `true` | 用户层，热生效（无需 /reload） |
| cordis 行级 config | `enabled` | `true` | patch 层覆盖用，settings 缺席时生效 |

`enabled: false` 即时卸下补丁，响应头恢复 dsh 原生行为。
`NODE_ENV=development` 恒禁用（保护 dev/HMR 的 same-URL 热更新语义）。

## 明确不做

- 不缓存 index.html / favicon / manifest（保持每次最新，插件 rev 清单不走缓存）；
- 不触碰 `/plugins/*`（`dsh-client-modules` 已带 immutable）与任何插件 API 路由；
- 不改写既有响应头、状态码与响应体。

## 验收

1. `curl -sI http://127.0.0.1:3080/assets/index-*.js` → 出现
   `cache-control: public, max-age=31536000, immutable`；
2. `curl -sI http://127.0.0.1:3080/` → 与插件缺席时逐头一致；
3. 浏览器连续刷新两次 → 第二次 assets 全部 `from disk cache`；
4. 开关演练：settings 置 `enabled: false` → 头即时消失（无需 /reload）。

## 退役路径

若 dsh 上游为 `dsh-host-frontend-static` 原生支持哈希资源缓存头，本插件配置
`enabled: false` 即可退役，无需删代码。
