---
description: "@dsh-plus/actual-reports：补上官方 API/CLI 缺失的自定义报表与仪表盘能力（伴侣 CLI），含运行期依赖解析、官方流程镜像、两族语义与错误模型"
type: fact
last_modified: "2026-10-06 00:35"
---

# @dsh-plus/actual-reports

官方 `@actual-app/api` 与 `@actual-app/cli` 都没有自定义报表与仪表盘的公开操作面：
报表只能在界面里改，仪表盘更是连 CLI 入口都没有（界面里那个「报告」入口点进去
就是仪表盘）。本包以**伴侣 CLI**的形态补上这块能力，并由 `@dsh-plus/actual-mcp`
把它的能力描述符合并进工具目录（官方 CLI 派生的 12 个族 + 本包声明的 2 个族）。

## 为什么是伴侣 CLI，而不是库或插件

- 报表/仪表盘 handler 只在 `api.init()` 返回的实例上可用（`lib.send('report/get')`
  这类内部方法），公开 API 不暴露；要在进程内直连，就得把 `@actual-app/api`
  （约 236MB 闭包，含 better-sqlite3 / sql.js / hyperformula）装进 profile。
- 官方 CLI 已经在本机（版本由部署方决定），因此本包**零依赖**：运行期从已检测到的
  官方 CLI 入口 `createRequire(...).resolve('@actual-app/api')` 解析 api 路径，
  不声明依赖、不校验、不钉死版本。
- 子进程形态天然与官方 CLI 共用同一份预算目录与锁协议，不会出现两个进程各自
  维护一份缓存文件。

## 运行期依赖解析与错误模型

- api 路径来源优先级：`--api-path`（或 `DSH_ACTUAL_API_PATH`）→ 官方 CLI 入口所在包的
  依赖解析；官方 CLI 入口来自 `--cli-entry` / `DSH_ACTUAL_CLI_ENTRY`，都没有则在 PATH
  里找 `actual`（与官方 CLI「自带一份 api」的用法一致）。全都没有 → 报错并说明怎么给
  （`@dsh-plus/actual-mcp` 调用时会自动下发官方 CLI 入口）。
- 解析不到 `@actual-app/api`、api 模块形状不符、`init` 未返回 `send`、服务端 handler
  报错：全部**显式报错**并带上原始原因，不做静默降级、不做默认值兜底。
- 退出码：`0` 成功 / `1` 运行期失败（服务端、预算、解析、未支持的能力）/ `2` 用法错误
  （未知族或动作、未知选项、缺必填、JSON 形态非法、`@-` stdin 形态）。
- 错误一律写 stderr，JSON 单行 `{"error":{"message":"…"}}`；数据一律写 stdout
  （默认 JSON，`--format table|csv` 给人看）。

## 官方流程镜像（`src/session.ts` / `src/lock.ts` / `src/cache.ts`）

每次调用都走官方 CLI 的同一条仪式，以免与官方 CLI、界面、桌面端互相踩踏：

1. 解析配置（serverURL / password|sessionToken / syncId / dataDir / cacheTtl / lockTimeout，
   均支持 `*_FILE` 变体）；
2. 取预算目录锁（`<dataDir>/.actual-cli/<syncId>/lock`，读者计数 + 30s 陈旧判定 +
   `kill(pid,0)` 清理死进程；读动作取共享锁，写动作取独占锁）；
3. 读缓存状态 `<meta>/state.json` 决定 `download` / `sync` / 直接 `load`（TTL 默认 60s，
   写动作与加密预算强制 sync）；
4. `api.init` → `downloadBudget` 或 `loadBudget` → 动作 → 写动作收尾 `sync` → `api.shutdown`。

## 报表族（`report`）

动作：`list`、`get`、`data`、`create`、`update`、`delete`（前三个只读）。

- 读取走官方 `report/get`（camelCase 定义数组，按名称排序）；写走 `report/create`、
  `report/update`（需要完整定义含 id）、`report/delete`。
- `data` 按**官方口径**本地计算：范围解析（静态日期或 `Last 6 months` 这类活范围）、
  区间切分、按 series 过滤、堆叠与图例、区间裁剪与排序，全部照 `src/aggregate.ts`
  里的官方实现语义移植；`--today` 可固定「今天」以复现结果，`--overrides` 可做
  **不落盘**的试算。
- 输出金额一律整数分（`amountUnit: "cents"`），`table`/`csv` 才转成元。
- 白名单之外的旋钮**显式报错**：`groupBy=Tag`（标签分组）、`balanceType=Budgeted`
  （预算口径）、未知 `interval`/`sortBy`/`dateRange` 都会给出合法取值清单。
- 删除保护：报表可能被仪表盘组件引用（`dashboard.type='custom-report'` 且
  `meta.id` 指向它），不给 `--force` 就拒绝并列出组件；给了就先移除组件再删报表。

## 仪表盘族（`dashboard`）

动作：`list`、`widgets`（只读）、`create`、`rename`、`delete`、`reset`、`add-widget`、
`update-widget`、`remove-widget`、`copy-widget`、`layout`。

- 读取走 AQL 直查 `dashboard_pages` / `dashboard`，组件行字段与官方导入/导出格式
  一致（`id`/`dashboard_page_id`/`type`/`width`/`height`/`x`/`y`/`meta`），
  报表组件额外解析出被引用报表的名字与失效标记。
- **先读后写**：官方 `dashboard-add-widget`（必填字段缺失）与
  `dashboard-remove-widget`（删不存在的 id）都会静默成功，因此每个写动作都先读现场
  校验目标存在、写完再读回，把结果交给模型核对；`add-widget`/`copy-widget` 通过
  「写前 id 集合」的差集定位新组件（官方 handler 不回传新 id）。
- `update-widget` 是**补丁语义**：只给要改的字段，其余沿用已存行。官方 schema 要求
  `type`/`width`/`height`/`x`/`y` 必填，直接透传局部字段会被官方拒绝，因此必须先合并。
- `x`/`y` 同时省略时由官方自动排版到 12 列网格；只给一个会被官方 schema 拒绝，
  本包在写前就用显式错误拦下。`layout` 只改几何字段（多给字段即报错）。
- 官方语义如实透出：`reset` 是「恢复默认组件集」而不是清空；`delete` 会连带删除
  该页全部组件、且拒绝删除最后一个页面（官方英文错误原样上抛）。
- 组件 `meta` 的形状随类型而变（服务端认得 14 种类型，见工具描述），本包不代为编造：
  模型先用 `widgets` 读现场同类组件照抄 meta；只有报表组件的形状是固定的
  `{"id":"<报表 id>"}`。官方默认仪表盘里能读到的实例形状（实测）：`summary-card` 为
  `{name, content, timeFrame, conditions, conditionsOp}`、`spending-card` 为
  `{name, mode}`、`markdown-card` 为 `{content}`、`net-worth-card`/`cash-flow-card`
  可以是空对象。

## 动作表是唯一事实来源

`src/actions.ts` 同时驱动 argv 解析、帮助文本与暴露给模型/宿主的工具 schema
（`src/capability.ts`），三者不可能漂移；`@dsh-plus/actual-mcp` 只做搬运与执行
（`entry.reports` 执行计划 → `[node, <本包 bin>] report|dashboard …`，并下发
`DSH_ACTUAL_CLI_ENTRY`）。因此新增动作只需改动作表一处。

## 测试

`tests/` 全部零网络零时钟：日期/区间移植（`dates`）、计算口径（`compute`）、
模型白名单（`model`）、锁与缓存判定（`lock`、`env`）、能力描述符（`capability`）、
CLI 端到端（`cli`，含退出码与错误文案）、仪表盘读写（`dashboard`）。
预算替身（`tests/fixtures/fake-budget.ts`）只按表返回已聚合行、记录查询与 handler
调用，并按官方语义复刻仪表盘写入，因此断言的是「怎么调、怎么读回」而不是替身自身。
