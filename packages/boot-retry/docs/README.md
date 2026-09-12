---
last_modified: "2026-09-12 23:08"
---

# @dsh-plus/boot-retry

弱网下的引导重试：经官方 `globalThis.__DSH_TRANSPORT__.loadBundle` 缝注入一个
「原 URL 重试」的插件包加载器，消除一次 TCP 抖动就停在 **Failed to load plugins**
的问题。**零缓存**——不读取、不存储、不重放任何响应体。

## 要解决的问题

官方 `dsh-client-web` 的默认加载器（`dsh-client-modules` 的 `defaultLoadBundle`）
对每个插件包只尝试一次：

```js
const el = document.createElement('script')
el.src = url
el.addEventListener('error', () => reject(new Error(...)), { once: true })
```

一次失败即 reject，`arriveGraphRow` 抛错，boot 结束时 `assertEntriesActive`
汇总为 `web boot: N entries did not activate`，页面停在 "Failed to load plugins"。
浏览器对 `<script>` 加载失败**自身不会重试**，弱网下（例如 tailnet 走 DERP 中继）
这条路径很容易命中。

## 机制

宿主渲染 index.html 时，本插件经官方事件 `webserver/index-inject` 推入一行
`head` 内联 classic 脚本，内容由 `src/boot-script.ts` 生成：

1. **包装官方缝**：`globalThis.__DSH_TRANSPORT__ ??= {}`，若
   `transport.loadBundle === undefined` 则赋值为重试版本。官方外壳执行时正是读这个
   字段（`transport?.loadBundle === undefined ? {} : { loadBundle }`）。
   **已存在则不接管**——尊重官方未来实现或他方插件。
2. **原 URL 重试**：失败时移除 `<script>` 元素，按 `backoffMs` 退避后用**同一个
   URL** 新建元素重试，直到 `maxAttempts`；用尽后以明确错误 reject。
3. **外壳兜底**：`<script type="module">` 失败不自动重试，故在 window 捕获阶段
   监听 `error`，对 `/assets/index-*.js` 追加 `__dsh_retry=N` 查询参数重建元素
   （module 脚本同 src 只执行一次，必须换 URL 才能重跑）。

### 时序：为什么一定被读到

index.html 的 head 顺序（实测于 dsh 0.1.5-rc.2）：
模块表引导队列 → application 批次 `<link rel=preload>` → bootstrap 批次
`<script src=/plugins/...>` → `__DSH_BOOT__` → **本插件注入行** → 外壳
`<script type="module" src=assets/index-*.js>`。

外壳是 `type=module`，按规范**默认 defer**（解析完才执行）；本行是 classic inline
（解析到即执行）。故无论注入行落在 head 哪一段，都必然早于外壳执行。
`<link rel=preload>` 只是提示，预取失败静默、不致命；真正的执行路径始终是
`loadBundle(url)` 新建的 `<script>`（client-modules 的 `arrive` → `loadBundle`），
因此 application 批次的加载全部落在包装内。

### 覆盖边界

bootstrap 脚本（`@deepseek-ai/dsh-client-modules` 单模块 combo，实测 gzip ≈6.4 KB）
是 parser-blocking 且位置早于注入行，**本插件兜不住**；官方在该处也没有重试。
不为此增加复杂度：它体积小、失败概率远低于 62 模块的 application 批次，
要覆盖它只能改 index 渲染顺序或另加路由，收益与风险不成比例。

## 为什么不会影响功能与 UI 生效（无陈旧风险）

- **不做任何缓存**：不读 `response.body`、不落 Cache Storage、不存内存表；
  每次尝试都是一次全新的同 URL 请求。
- **不改写 URL / rev**：实测断言 `el.src === 官方给定 url` 逐字节相同。
  故 HMR 的 `invalidate(id, rev) → prefetch(id)` 语义完全不变：rev 变则 URL 变，
  必然取新字节；同 URL 请求也始终直达服务端。
- **不解释插件包格式**：只依赖「`<script>` load/error」这一个 DOM 事实。
- **结构守卫（fail-safe）**：`enabled=false` 时或宿主无 `webServer`（如 headless
  profile）时不注册任何行（等价插件缺席），绝不使 boot 失败；重复注入幂等
  （哨兵 `__DSH_PLUS_BOOT_RETRY__`）。

### 为什么不声明模块级 `inject = ['webServer']`

初版这么写，被 `dshctl smoke-prod` 实测捕获：headless profile 里没有 `webServer`
服务，硬 inject 使本行**永久 pending**，`assertEntriesActivated` 判定
`1 entry did not activate`，**整个 boot 失败**——即本插件会让一个本来正常的
headless profile 起不来。现改为 `apply` 内 `ctx.inject(['webServer'], ...)`
惰性等待：服务缺席时本行照常 active，只是什么都不注册。
（`tests/` 有对应回归用例，`inject` 必须为空数组。）

## 配置

cordis 行级 `config`（注意：patch 层是整体替换，覆盖时须写全字段）。

| 键 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关 |
| `maxAttempts` | `3` | 单包加载尝试总次数（含首次）；1 = 不重试 |
| `backoffMs` | `[250, 750]` | 退避毫秒表，按序取用、末项重复 |
| `retryShellScript` | `true` | 是否兜底外壳 `assets/index-*.js` |
| `shellMaxAttempts` | `2` | 外壳脚本最大重试次数（不含首次） |

## 验证（已实测，非推断）

- 单测 11/11：注入行形状、`</script` 文本约束、幂等哨兵、不覆盖他方实现、
  `maxAttempts=1` 等价官方、空退避表不崩、退避末项重复、未知配置键忽略、
  无 `webServer` 时静默空转（headless 回归）。
- 真实产物 + 模拟 DOM：连续失败 2 次后第 3 次成功 → resolved；持续失败 →
  用尽后明确 reject（不永久挂起）；首次成功 → 仅 1 次请求。
- 守卫：已存在 `loadBundle` 不被覆盖；保留 `__DSH_TRANSPORT__` 其它字段；
  重复注入幂等。
- 真实 dev 实例（`dshctl dev up`）：注入行出现在 served HTML，与单测产物一致；
  以真实插件 URL 模拟首次请求 abort → 自动重试并 RESOLVED。
