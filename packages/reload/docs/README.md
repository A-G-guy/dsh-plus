---
last_modified: "2026-10-04 00:42"
description: "@dsh-plus/reload 文档"
type: fact
---

# @dsh-plus/reload 文档

重新加载插件：设置页「重新加载 / 重启服务」行与 `/reload` 命令。

- **主动作＝进程内重载**：读盘重建 profile 组合层（bundle 层 + profile 补丁 +
  home 补丁 + 覆盖层）并对账进运行中的 Loader 树。行启停、行配置、组合包选择、
  settings、新装插件即时生效；零中断，**不需要刷新页面**（客户端插件图由官方
  `dsh-client-hmr` 同步）。
- **次级动作＝重启服务**：`systemd` 通道（Linux），供进程内无法覆盖的变更
  （插件本体替换、平台升级、`.env` 变更）使用。
- 与 pi 的 `/reload` 对齐的三点：无确认对话框、执行前拒绝在有会话运行时执行
  （可用 `force` 覆盖）、执行后逐项报告结果与失败原因。

## 覆盖范围（上游语义决定）

| 变更 | 生效方式 |
|---|---|
| 行启停 / 行配置 / `insert` 新行 | 进程内即时 |
| 组合包（bundle）选择、新装插件包（首次导入） | 进程内即时 |
| settings（`dsh-settings` 监听 `app-boot/config-reload` 失效缓存） | 进程内即时 |
| 技能（skills，`dsh-skill-filesystem` 自带监听） | 自动，无需操作 |
| **已安装包在 `node_modules` 内的代码替换** | **只能重启**：dsh-hmr 的依赖遍历遇 `/node_modules/` 直接返回空集，不做模块替换 |
| 指令文件（`AGENTS.md`） | 进程内不可刷新：首个请求注入基线，之后仅由文件操作触摸 / 新会话 / 恢复会话对账 |
| `.env`、平台包版本、TSX/Worker 场景 | 只能重启 |

插件在启动时记录 profile 直接依赖的产物指纹（`package.json` + `lib/`、`dist/` 全量
文件的内容哈希），`/reload` 时重新比对，把「只能重启」的包**点名报告**，避免
「看起来重载成功、其实新代码没生效」。

## 机制

- **host 半**（`src/`）：
  - `inprocess.ts` — 进程内重载核心：能力判定（缺 `profileContext` 即拒绝）→
    可选刷新 `pluginPackages` 解析表 → `readProfilePatches` 重建 patch 列表 →
    `reconcileProfilePatches` 对账进 Loader 树；全程在 `hmr.runExclusive()` 队列内
    串行（缺席则直接执行）。失败只回报诊断，不抛出。
  - `fingerprint.ts` — 产物指纹采集与差异比对（`node:crypto` + 注入的文件端口，零磁盘依赖可测）。
  - `report.ts` — 命令面与 HTTP 面共用的状态与文案（四态：applied / agents-running /
    unsupported / failed；另有 status 文本）。
  - `command.ts` — `/reload`（进程内）、`/reload force`、`/reload restart [force]`、
    `/reload cancel`、`/reload status`；结果直渲会话 UI、不进模型上下文（零 token）。
  - `routes.ts` — `/dsh-plus/reload` 五端点：`POST now`（进程内，无 token）、
    `GET health`（bootId + watchdog 间隔）、`POST prepare/confirm/cancel`
    （重启通道，一次性 token 两段确认）。
  - `scheduler.ts` / `preflight.ts` — 重启通道状态机与三级预检（ProfileContext 平台判定
    → MainPID 匹配 → 单元 active → `sudo -n` 可用），不通过即拒绝调度。
  - `agents.ts` — `ctx.agents.list()` 中 status=running 的计数；服务缺席降级为 0。
  - `config.ts` — 行级配置单一事实源（含 `binName`、`detectPendingRestart`）。
  - **能力位按请求时取值**：`hmr` 是行内服务，只能经 `ctx.inject(['hmr'], cb)` 捕获
    （属性访问要求 inject 声明；`ctx.get` 读不到同级行服务）；它的 fiber 要等模块监听
    ready，boot 后头几秒可能显示 `hmr ✗`——此时进程内重载照常执行，只是不与自动热重载
    共队列。`profile`（宿主 provide）与 `pluginPackages`（宿主挂根上下文）用 `ctx.get` 读。
- **client 半**（`src/client/`）：`settings.general.item` 插槽注册一行，主按钮
  「重新加载」→ `POST now` → 结果对话框（`white-space:pre-line` 原样呈现 host 文案，
  需重启时给出直达「重启服务」的按钮）；有会话运行时先弹「强制执行」询问。
  「重启服务」走 prepare → 可取消倒计时（有 running 会话时归零不自动确认）→
  confirm → 轮询 health 至 bootId 变化 → `location.reload()`；多标签页经
  localStorage 标记接力。桌面端只保留进程内重载（重启按钮置灰 + 平台说明）。
- **被动重启检测**（`src/client/watchdog.ts`）：`health` 建立 bootId 基线后低频轮询
  （间隔由 host 下发，见 `watchdogIntervalSeconds`）+ 可见性恢复即比对；bootId 变化
  即服务已被**任何来源**重启 → `location.reload()` 拉取新 bundle。

## 配置（行级，`dsh` 组合层可覆盖）

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关（按钮与命令同时生效/隐藏） |
| `binName` | `dsh` | 启动器名：组合层读取与诊断前缀 |
| `detectPendingRestart` | `true` | 是否采集/比对产物指纹（关闭即不报告待重启清单） |
| `unitName` | `dsh-web` | systemd 单元名（仅重启通道） |
| `clientCountdownSeconds` | `5` | 设置页「重启服务」倒计时秒数 |
| `confirmTokenTtlMs` | `60000` | 一次性 token 有效期 |
| `serverGraceMs` | `800` | confirm 后到执行重启的缓冲（响应落盘/取消窗口） |
| `clientPollTimeoutMs` | `30000` | 客户端等待服务恢复的轮询超时 |
| `watchdogIntervalSeconds` | `30` | 被动重启检测轮询间隔秒数（0 = 关闭） |

## 边界

- **非托管环境**：重启通道对非 systemd 托管 / 非主进程 / 无 `sudo -n` 的环境一律
  拒绝（dev 实例、服务内 shell 手动拉起的进程），提示改用 `dshctl restart-prod`；
  进程内重载不受此限。
- **桌面端与 Windows/macOS**：进程内重载可用（只需 `profileContext` + Loader），
  重启通道禁用；client 半按 `'dshDesktop' in globalThis` 置灰重启按钮。
- 命令路径的 `cancel`/进程内重载为本地可信面（无 token），HTTP 面的重启必须持 token。
- 与 lifeboat 的关系：无代码联动——重启后若兄弟插件加载失败，lifeboat 既有隔离
  机制自动止血；reload 自身亦在其 `dsh-plus-*` 守护范围内。
- 进程内重载会 dispose 并重建被改动的行：被重载插件内的运行期状态（含正在跑的
  会话上下文之外的内存状态）会重置，这是上游行级重载的既定语义。
