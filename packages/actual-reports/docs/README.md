---
description: "@dsh-plus/actual-reports：补上官方 API/CLI 缺失的自定义报表与仪表盘能力（伴侣 CLI），含运行期依赖解析、官方流程镜像、report/dashboard/reference 三族语义与错误模型"
type: fact
last_modified: "2026-10-06 01:55"
---

# @dsh-plus/actual-reports

官方 `@actual-app/api` 与 `@actual-app/cli` 都没有自定义报表与仪表盘的公开操作面：
报表只能在界面里改，仪表盘更是连 CLI 入口都没有（界面里那个「报告」入口点进去
就是仪表盘）。本包以**伴侣 CLI**的形态补上这块能力，并由 `@dsh-plus/actual-mcp`
把它的能力描述符合并进工具目录（官方 CLI 派生的 12 个族 + 本包声明的 3 个族：
`report`、`dashboard`、`reference`）。

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
- 组件 `meta` 的形状随类型而变，本包不代为编造：字段名与类型用 `reference widgets`
  取（读的是本机官方模型源码，见下节），现场同类组件的实例用 `widgets` 读；
  只有报表组件的形状是固定的 `{"id":"<报表 id>"}`。

## 参考族（`reference`）

动作：`widgets`、`prefs`（只读，需打开预算读偏好表）、`source`、`report-options`
（只读，**不打开预算**——不加载官方 api、不取锁、不下载预算）。

界面里才有的语义（组件类型与 meta 字段、实验开关、报表字段取值、卡片渲染细节）
过去只能联网翻官方仓库。实际上这些都在本机：官方 CLI 自带 `@actual-app/core` 的
**源码**，服务端又静态托管整个 Web 客户端（含 source map 里的原始源码）。参考族把
这两处变成可查询的数据：

- `widgets`：从本机 `@actual-app/core` 的 `src/types/models/dashboard.ts` 现场解析出
  组件类型、每个类型 meta 的字段名/类型/可选性，以及同文件里的共享类型（`TimeFrame`、
  `SummaryContent` 等）。**不内置模型快照**：字段名写错不会报错，界面里只是渲染不出来，
  所以宁可每次现场解析，解析不出就报错（`--type <类型>` 可只取一个类型）。
- `prefs`：实验开关全集取自本机 core 的 `FeatureFlag` 声明，取值取自当前预算的
  `preferences` 表；未设置的开关按未开启处理（与界面一致）。实验类组件（公式卡等）
  开关没开时**写入会成功但界面什么都不渲染**，所以写之前先查。
- `source`：`--list` / `--grep` / `--file` 三选一，`--kind core`（本机官方源码）或
  `--kind client`（服务端托管的客户端源码）。客户端源码由「首页 → 入口 bundle →
  `__vite__mapDeps` 的 chunk 列表 → 各 chunk 的 `.map`」现场发现，按资产名（内嵌内容
  哈希）缓存在 `<dataDir>/client-source/<服务端>/`；默认最多读 8 份资产（`--max-assets`），
  首页 HTML 每次重读以便发现新版本。返回值里带覆盖率（读了几份、跳过了几份），
  读不全或没找到时显式报错并给出下一步。
- `report-options`：报表定义的合法取值（实时区间、粒度、分组、口径、排序、模式）与
  静态区间写法；`--verify` 额外用本机客户端源码逐字核对上表，返回 `found`/`missing`。

边界：参考族只读本机与服务端资产，不写预算、不发外网请求；`--kind client` 也只是读
`serverUrl` 指向的那台服务端。资产布局与预期不符（没有 chunk 清单、没有 source map、
连不上）时显式报错，并提示改用 `--kind core` 或 `--core-dir`。

## 动作表是唯一事实来源

各族定义在 `src/actions-report.ts` / `src/actions-dashboard.ts` / `src/actions-reference.ts`，
由 `src/actions.ts` 登记；同一张表驱动 argv 解析、帮助文本与暴露给模型/宿主的工具
schema（`src/capability.ts`），三者不可能漂移。`@dsh-plus/actual-mcp` 只做搬运与执行
（`entry.reports` 执行计划 → `[node, <本包 bin>] report|dashboard|reference …`，并下发
`DSH_ACTUAL_CLI_ENTRY`）。因此新增动作只需改动作表一处。

`needsBudget: false` 的动作（`widgets`、`source`、`report-options`）由 `cli.ts` 直接执行，
不加载官方 api、不取锁、不同步预算——查组件字段不该付一次同步的代价；这类动作拿到
的预算访问面是守卫对象，一旦被访问就报「本地动作接线错误」。

## 测试

`tests/` 全部零网络零时钟：日期/区间移植（`dates`）、计算口径（`compute`）、
模型白名单（`model`）、锁与缓存判定（`lock`、`env`）、api 定位优先级（`api-path`）、
能力描述符（`capability`）、CLI 端到端（`cli`，含退出码、错误文案与「本地动作不开预算」）、
仪表盘读写（`dashboard`）、参考族（`reference`：模型解析、偏好与实验开关、core/client
源码检索与缓存、报表词汇核对、各条失败路径）。
预算替身（`tests/fixtures/fake-budget.ts`）只按表返回已聚合行、记录查询与 handler
调用，并按官方语义复刻仪表盘写入；本地依赖替身（`tests/fixtures/local-deps.ts`）给
内存文件系统与可编程 HTTP，因此断言的是「怎么调、怎么读回」而不是替身自身。
