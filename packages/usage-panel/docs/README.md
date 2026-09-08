---
last_modified: "2026-09-08 23:40"
---

# @dsh-plus/usage-panel

全量会话 token 用量统计面板：聚合所有会话日志的 LLM 用量（官方 token-meter
无聚合 UI），按日趋势 / 按模型明细出报表，可选配价目估算费用。
service+ui 混合插件（node 半折叠用量数据，浏览器半提供设置页与价目卡片）。

## 数据来源与会计口径

实时采集 + 历史自动增量同步，互为补充：

| 通道 | 触发 | 范围 | 成本 |
|---|---|---|---|
| 实时 | root ctx 订阅 `session/event` | 插件安装后的新事件 | 零（增量折叠） |
| 历史同步 | 后台自动（启动一轮 + `autoSyncMinutes` 周期） | `sessionPersistence.list` 快照规划 | revision/lastSeq 双重短路，未变会话零读取 |

无手动扫描入口：设置页只展示同步状态（进行中进度 / 最近完成时间 / 最近
错误），历史数据由后台自动补齐。

usage 折叠规则（对齐 0.1.3 dsh-session 官方 token-meter 会计口径，
`src/usage-fold.ts`）：

- 会计源是 assistant 结算事件（`assistant/message` / `assistant/attempt`）；
  usage 取结算事件的 `usage` 字段，缺席时回落 stream 记录内嵌的最后一个
  usage chunk——两者只取其一，绝不双计。
- 单一 `last` 替换槽：同一 (turn, step) 连续重结算按「替换」计入
  （回撤旧样本再加新样本，对齐官方 addReplacing）。
- `llm/retry-started` 关闭替换槽：重试的新尝试照常累加——失败尝试计入，
  与官方 token-meter「失败尝试计入」口径一致；attempt 结算无法关联
  provider 时归入「—」聚合行。
- provider/model 取自 assistant/message 的 `message.source`
  （AssistantProvenance）。
- 日期按服务器本地时区切分。

缓存：`$DSH_HOME/usage-panel/cache.json`（schema v2，按会话记
`revision?` + `lastSeq` + 折叠行；原子写；损坏/版本不符降级为空缓存由
同步自动重建，不做跨版本迁移）。同步进行中经 `/data` 端点回报进度。

## 设置页

浏览器半注册进官方 `settings.section` 插槽（设置导航独立页「用量统计」）：

- 同步状态行（进行中进度条 / 最近完成时间 + 最近错误）
- 筛选栏：快捷区间（近 7 天 / 近 30 天 / 本月 / 全部 / 自定义起止日期）+
  provider/model 下拉精确筛选 + 重置
- 概要卡：范围合计 tokens / 调用数 / 费用估算（全部表格列带表头与移动端
  堆叠行标注）
- 按日柱状图（纯 CSS，零用量日补零，窄屏标签抽稀，点击展开单日明细）
- 按模型表（calls 降序；≤767px 转纵向堆叠行，每格带字段标注）

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
| `autoSyncMinutes` | 30 | 历史会话自动增量同步间隔（分钟，0 = 仅启动时同步一次） |
| `catalogRefreshHours` | 24 | models.dev 目录自动刷新间隔（小时，0 = 仅启动时拉取一次） |

「从 models.dev 导入参考价」：点击后 host 半后台拉取 models.dev 公共 JSON
（可经代理，带超时与响应体上限，失败沿用磁盘缓存
`$DSH_HOME/usage-panel/models-dev.json`），浏览器轮询目录状态至完成后，
从 host 缓存文档折算价目写入 settings；导入是**整体替换**（models.dev 的
provider 键与本仓库 llm-pi 路由键不一致时需手工修正）。拉取全程不阻塞
浏览器请求线程。

## 端点

| 路由 | 方法 | 说明 |
|---|---|---|
| `/dsh-plus/usage-panel/data` | GET | 全量行（含行级费用）+ 同步进度 + 目录状态 + 会话数 |
| `/dsh-plus/usage-panel/catalog` | GET | models.dev 目录状态（fetchedAt/error/refreshing） |
| `/dsh-plus/usage-panel/catalog` | POST | 触发后台刷新（立即返回 202） |
| `/dsh-plus/usage-panel/prices-import` | POST | 价目导入：body.doc 可选（外部来源），缺省折算 host 缓存目录；settings/catalog 缺席返回 409 |

端点与 dsh web 同源（webServer 默认 loopback / 反代信任域），无独立鉴权
（与 notify-email 等插件自定义端点同一暴露面约定）。

## 边界

- `sessionPersistence` 缺席（如精简 headless 组合）：仅实时通道可用，
  同步状态记 `persistence-unavailable`。
- 历史同步串行逐会话 `open('read')` + 尾部增量读取（单批上限 2 万事件，
  异常膨胀下轮续传）；单会话损坏跳过并记入 `lastError`，不中断整轮。
- revision 由后端保证：一致 → 零读取跳过；缺失/变化 → lastSeq 起尾部增量。
- usage 行只增不删（模型换价目后历史行费用随之变化，估算按当前价目表重算）。
- models.dev 拉取失败只记目录状态，导入走最近一次成功缓存；两者都不影响
  用量统计主链路。

## 后续 patch 层可按 id 覆盖

`dsh-plus-usage-panel` 行可经用户 patch 层覆盖 config 或禁用。
