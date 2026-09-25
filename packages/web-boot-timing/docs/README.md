---
last_modified: "2026-09-25 13:09"
---

# @dsh-plus/web-boot-timing

弱网首屏计时观测：把「打开 Web UI → 可输入操作」拆成五相时钟（ttfb /
index 传输 / DCL / FCP / 遮罩移除 / 首次输入）加资源分桶（外壳、插件组合包、
字体、语言包、事件流、RPC），输出到控制台、`globalThis` 钩子与 localStorage
历史（最近 10 次，供优化前后对比）。**纯观测，零行为改动**。

## 要解决的问题

tailnet/弱网下首屏动辄几十秒，但没有量化手段区分瓶颈在传输、插件加载还是
挂载时序——优化只能猜。本插件给出可对比的分相数据（例如 web-cache-headers、
代理压缩启用前后的差异）。

## 机制

两半分工，均只在既有链路上挂监听，不改写任何请求/响应：

- **node 半**（`src/index.ts`）：惰性 `inject(['webServer'])`，每次渲染
  index.html 时经 `webserver/index-inject` 推一行 `kind:'global'` 配置
  （`enabled`/`settleMs`）。`enabled: false` 不推该行——浏览器半见不到
  配置行即零行为，等价插件未安装。
- **浏览器半**（`src/client.ts`，构建为 `__ModuleLoader__` factory）：
  - 五相时钟：navigation/paint Performance 条目 + 本插件 apply 时刻
    （≈ 插件全量加载完成点）+ `[data-dsh-boot]` 遮罩移除时刻
    （MutationObserver）+ 首次 pointerdown/keydown（capture+once，不
    preventDefault，不干预默认行为）；
  - 资源分桶：`PerformanceResourceTiming` 按 pathname 归桶（`report.ts`
    纯函数，段边界严格）；
  - 结算：`window load` 后延迟 `settleMs`（默认 1500ms，给首波 RPC 与
    绘制留落账时间）出一份报告——`console.info` 多行文本 +
    `globalThis.__DSH_PLUS_WEB_BOOT_TIMING_REPORT__` 机读钩子 +
    localStorage 历史（键 `dsh-plus-web-boot-timing/history`，cap 10）。

安全边界：报告采集/输出全程 try/catch 隔离（带 `[web-boot-timing]` 上下文
warn），观测故障绝不拖垮 boot；`ctx.effect` 兜底清理监听器与定时器；不注入
任何 DOM、不碰 RPC/SSE/插件加载器。

## 配置

| 位置 | 键 | 默认 | 说明 |
|---|---|---|---|
| settings.yaml | `dsh-plus-web-boot-timing.enabled` | `true` | 用户层，热生效（下一次页面加载生效） |
| settings.yaml | `dsh-plus-web-boot-timing.settleMs` | `1500` | load 后结算延迟（200–10000，步长 100） |
| cordis 行级 config | `enabled` / `settleMs` | 同上 | patch 层覆盖用，settings 缺席时生效 |

`enabled: false` 后配置行不再注入，浏览器半零行为（无残留监听/存储写入）。

## 读报告

1. 打开浏览器控制台 → `[web-boot-timing]` 多行报告；
2. 机读：`globalThis.__DSH_PLUS_WEB_BOOT_TIMING_REPORT__`；
3. 历史对比：`JSON.parse(localStorage.getItem('dsh-plus-web-boot-timing/history'))`
   ——数组[0] 是最新一次，逐条含 `phases` 与 `buckets`，可对照优化前后。

报告字段：`phases`（ttfb/indexDone/domInteractive/dcl/load/fcp/clientApply/
overlayRemoved/firstInput，均为相对 timeOrigin 的毫秒或 null）；`buckets`
（每桶 count/firstStart/lastEnd/transferBytes/decodedBytes——transferBytes
为线上字节，decodedBytes 为解码后字节，两者差即压缩收益）。

## 边界与不含

- 不改写请求/响应、不注册路由、不注入 DOM、不碰 RPC/SSE/加载器；
- 首次输入若发生在结算之后，不追补进已生成的报告（报告是一次性快照）；
- 跨源资源无 TAO 头时字节为 0（如实汇总，不猜）；
- headless 等无 webServer 的 profile：惰性 inject 不触发，等价插件缺席。
