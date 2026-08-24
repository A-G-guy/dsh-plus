---
last_modified: "2026-08-25 03:46"
---

# @dsh-plus/usage-panel

全量会话 token 用量统计面板：聚合所有会话日志的 LLM 用量（官方 token-meter
无聚合 UI），按日趋势 / 按模型明细出报表，可选配价目估算费用。
service+ui 混合插件（node 半折叠用量数据，浏览器半提供设置页与价目卡片）。

## 数据来源与会计口径

双通道采集，互为补充：

| 通道 | 触发 | 范围 | 成本 |
|---|---|---|---|
| 实时 | root ctx 订阅 `session/event` | 插件安装后的新事件 | 零（增量折叠） |
| 历史扫描 | 设置页「扫描历史会话」按钮（手动） | `sessionPersistence.list` 全量会话 | lastSeq 短路，已扫部分免重扫 |

usage 折叠规则（对齐 dsh-session 官方会计口径，`src/usage-fold.ts`）：

- `assistant/chunk { chunk.type: 'usage' }` 优先；同一 (turn, step) 的
  `assistant/message.usage` 不再重复计（不双计）。
- 无 usage chunk 的 committed step 以 `assistant/message.usage` 兜底。
- provider/model 取自 assistant/message 的 `message.source`（AssistantProvenance）。
- 失败尝试的 usage chunk（重试前的 error finish）也计数——与官方
  token-meter「失败尝试计入」口径一致；该类行无法关联 provider 时归入
  「—」聚合行。
- 日期按服务器本地时区切分。

缓存：`$DSH_HOME/usage-panel/cache.json`（schema v1，按会话记 `lastSeq` +
折叠行；原子写；损坏自动降级全量重建）。扫描进行中经 `/data` 端点回报进度。

## 设置页

浏览器半注册进官方 `settings.section` 插槽（设置导航独立页「用量统计」）：

- 概要卡：范围合计 tokens / 调用数 / 费用估算
- 范围切换（近 7 天 / 近 30 天 / 本月 / 全部，客户端切片）
- 按日柱状图（纯 CSS，零用量日补零，窄屏标签抽稀）
- 按模型表（calls 降序；≤767px 转纵向堆叠行）
- 历史扫描入口 + 进度条

## 费用估算（可选）

价目为用户手工维护的参考值（或从 models.dev 一键导入），**估算仅供参考**：
token-meter 的启发式与 provider 实际计费口径有差异（CJK 文本与 JSON schema
低估明显）。未配置价目的模型费用列显示「—」（对齐官方 NO_COST 语义，
不臆造价格）。

配置（settings namespace `dsh-plus-usage-panel`，插件配置页卡片编辑）：

| 字段 | 默认 | 说明 |
|---|---|---|
| `prices[]` | [] | `provider/model` 维度的 per-Mtok 单价（input/output/cacheRead/cacheWrite） |
| `currency` | CNY | 费用展示货币码 |
| `catalogProxy` | '' | models.dev 拉取代理（如 http://127.0.0.1:7890） |

「从 models.dev 导入参考价」：浏览器直连 models.dev 公共 JSON（可经代理），
POST 给 host 折算为价目条目写入 settings；导入是**整体替换**（models.dev 的
provider 键与本仓库 llm-pi 路由键不一致时需手工修正）。

## 端点

| 路由 | 方法 | 说明 |
|---|---|---|
| `/dsh-plus/usage-panel/data` | GET | 全量行（含行级费用）+ 扫描进度 + 会话数 |
| `/dsh-plus/usage-panel/scan` | POST | 触发历史扫描（persistence 缺席返回 409 `persistence-unavailable`） |
| `/dsh-plus/usage-panel/prices-import` | POST | models.dev 文档折算为价目并写入 settings |

端点与 dsh web 同源（webServer 默认 loopback / 反代信任域），无独立鉴权
（与 notify-email 等插件自定义端点同一暴露面约定）。

## 边界

- `sessionPersistence` 缺席（如精简 headless 组合）：仅实时通道可用，扫描
  端点结构化拒绝。
- 历史扫描串行逐会话 `load()`，单会话损坏跳过不中断；扫描可被插件卸载中止。
- usage 行只增不删（模型换价目后历史行费用随之变化，估算按当前价目表重算）。

## 后续 patch 层可按 id 覆盖

`dsh-plus-usage-panel` 行可经用户 patch 层覆盖 config 或禁用。
