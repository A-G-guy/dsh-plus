<div align="center">

# DSH+

**面向 [DSH（DeepSeek Harness）](https://www.npmjs.com/package/@deepseek-ai/dsh) 的增强插件集，发布于 npm [`@dsh-plus`](https://www.npmjs.com/org/dsh-plus) scope**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![npm @dsh-plus](https://img.shields.io/badge/npm-%40dsh--plus-CB3837?logo=npm&logoColor=white)](https://www.npmjs.com/org/dsh-plus)
[![Node](https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-workspace-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![dsh](https://img.shields.io/badge/dsh-0.2.1--alpha.1-blue)](https://www.npmjs.com/package/@deepseek-ai/dsh)

</div>

---

DSH+ 以 pnpm monorepo 形式维护一组 DSH 增强插件。每个插件都是独立的 ESM npm 包
（cordis 约定导出），全部发布在 npm 的 [`@dsh-plus`](https://www.npmjs.com/org/dsh-plus)
scope 下，可单独安装，也可经 `@dsh-plus/bundle-main` 聚合为一层有序的 cordis patch 统一装配。

## 插件一览

| 包 | 类型 | 平台 | 说明 | 文档 |
|---|---|---|---|---|
| [`@dsh-plus/ui-mobile-fit`](packages/ui-mobile-fit) | UI | 通用 | 纯 CSS 覆盖的移动端窄屏响应式适配，不 fork 上游、跟随升级 | [docs](packages/ui-mobile-fit/docs/README.md) |
| [`@dsh-plus/remote-settings`](packages/remote-settings) | UI | 通用 | 修复非 loopback 访问（loopback-rewrite 反代）下设置→模型目录报错与插件配置卡片不渲染 | [docs](packages/remote-settings/docs/README.md) |
| [`@dsh-plus/notify-email`](packages/notify-email) | service + UI | 通用 | 任务完成 / 等待决策 / 出错停止时向指定邮箱发送邮件通知 | [docs](packages/notify-email/docs/README.md) |
| [`@dsh-plus/llm-pi`](packages/llm-pi) | service + UI | 通用 | 基于 pi-ai 的自定义 LLM 路由：协议集合现场推导、官方目录继承与字段级覆盖、全量 compat、内置模型目录浏览器 | [docs](packages/llm-pi/docs/README.md) |
| [`@dsh-plus/lifeboat`](packages/lifeboat) | service | 通用 | 故障救生艇：兄弟插件崩溃自动隔离（写 patch 层禁用）+ LLM 应急翻译 + 邮件告警 | [docs](packages/lifeboat/docs/README.md) |
| [`@dsh-plus/reload`](packages/reload) | service + UI | Linux | 设置页「重新加载」按钮与 `/reload` 命令：两段确认+倒计时后重启 dsh-web（systemd，桌面/Windows 下按钮禁用并提示） | [docs](packages/reload/docs/README.md) |
| [`@dsh-plus/usage-panel`](packages/usage-panel) | service + UI | 通用 | 全量会话 token 用量面板：实时+历史扫描双通道聚合，按日/模型报表，可选价目估算费用 | [docs](packages/usage-panel/docs/README.md) |
| [`@dsh-plus/access-gate`](packages/access-gate) | service + UI | 通用 | Web 访问围栏（已合并官方认证）：官方 cookie 为唯一凭据，未认证导航渲染 token 输入页（PWA 可恢复），可选 IP 附加围栏，loopback 管理通道取当前认证链接 | [docs](packages/access-gate/docs/README.md) |
| [`@dsh-plus/boot-retry`](packages/boot-retry) | service | 通用 | 弱网引导重试：经官方 `__DSH_TRANSPORT__.loadBundle` 缝注入零缓存重试加载器，消除一次抖动导致的「Failed to load plugins」；不改 URL/不缓存，HMR 语义不变 | [docs](packages/boot-retry/docs/README.md) |
| [`@dsh-plus/web-cache-headers`](packages/web-cache-headers) | service | 通用 | 给 GUI 静态资源补长缓存：内容哈希 `/assets/*` 200 响应增量加 `immutable`，消除每次刷新重复传输 ~1.4MB（gzip 后约 500KB） | [docs](packages/web-cache-headers/docs/README.md) |
| [`@dsh-plus/web-boot-timing`](packages/web-boot-timing) | service + UI | 通用 | 弱网首屏计时观测：五相时钟（ttfb/index/DCL/FCP/遮罩移除/首次输入）+ 资源分桶报告，输出 console/`globalThis` 钩子/localStorage 历史对比；纯观测零行为改动 | [docs](packages/web-boot-timing/docs/README.md) |
| [`@dsh-plus/web-shell-sw`](packages/web-shell-sw) | service + UI | 通用 | 外壳 Service Worker：内容寻址资源 cache-first、index network-first 离线兜底；不碰 RPC/SSE/token 交换，`no-store` 永不入库，settings 一键注销恢复原生 | [docs](packages/web-shell-sw/docs/README.md) |
| [`@dsh-plus/error-retry`](packages/error-retry) | service | 通用 | 特定报错纳入上游重试：模糊/正则匹配 `failure.message`（如 `content_filter` → `PI_AI_ERROR`）并改写载荷 `retryPolicy`，退避/持久事件/次数预算仍全由官方 `dsh-llm-retry` 执行，次数可配（默认 5） | [docs](packages/error-retry/docs/README.md) |
| [`@dsh-plus/subagent-model`](packages/subagent-model) | service | 通用 | 子代理独立模型配置：按 provider 为 subagent/subagent_fork 注入 agentOptions（provider/model/思考程度），`default` 条目共享单条路由；主代理显式选择仍优先 | [docs](packages/subagent-model/docs/README.md) |
| [`@dsh-plus/web-files`](packages/web-files) | service + UI | 通用 | Web 内嵌类 SFTP 文件浏览与编辑：目录导航/预览/编辑、图片直连预览、双分隔符路径判据 | [docs](packages/web-files/docs/README.md) |
| [`@dsh-plus/image-studio`](packages/image-studio) | service + UI | 通用 | 图像工作室：OpenAI Images 协议文生图/图生图、全参数开关化、预设体系与可二次编辑画廊 | [docs](packages/image-studio/docs/README.md) |
| [`@dsh-plus/secret-env`](packages/secret-env) | service + UI | 通用 | 密钥环境变量：以 `$DSH_VAR_*` 变量名向 agent 暴露密钥，执行期经 dsh-shell-env 注入，值不进消息流、不影响缓存率 | [docs](packages/secret-env/docs/README.md) |
| [`@dsh-plus/web-search-services`](packages/web-search-services) | service | 通用·py | web_search 免费后端聚合（Tavily/Exa/OpenAI Chat），官方 web_search 工具零修改；需本机 Python（自动发现，Windows 兜底 `py -3`） | [docs](packages/web-search-services/docs/README.md) |
| [`@dsh-plus/siyuan`](packages/siyuan) | service | 通用 | 思源笔记主插件：MCP tools/list × kernel CLI help 树自动派生能力清单（docker/native/http 连接与 token 自动发现、双源交叉校验、降级执行），注册 `siyuan` agent 预设（操作面仅思源工具 + web/提问/待办辅助行，精简版系统提示词不复述工具描述） | [docs](packages/siyuan/docs/README.md) |
| [`@dsh-plus/siyuan-tools`](packages/siyuan-tools) | tool | 通用 | 思源笔记子插件（仅 siyuan 预设挂载）：能力 1:1 包装为 agent 作用域 DSH 工具，写操作按 DSH 审批策略确认（完全权限自动通过、绝不静默拒绝），写前数据历史快照，`siyuan:env` 环境快照，MCP 优先 CLI 兜底 | [docs](packages/siyuan-tools/docs/README.md) |
| [`@dsh-plus/actual-mcp`](packages/actual-mcp) | lib + bin | 通用 | Actual Budget 能力的可移植封装（格式一）：把本机 `@actual-app/cli` 按 help 文本运行时派生为 MCP 服务，stdio 入口可被任意 MCP 宿主直接运行；零 DSH 依赖，同时是格式二的唯一能力来源 | [docs](packages/actual-mcp/docs/README.md) |
| [`@dsh-plus/actual`](packages/actual) | service + UI | 通用 | Actual Budget 主插件：进程内挂载格式一的 MCP 服务端并从 `tools/list` 派生能力清单（CLI help 树交叉校验、会话失败降级为 CLI 目录、CLI×服务端版本探针与 warn/strict 策略），注册 `actual` agent 预设（操作面仅 Actual 工具 + web/提问/待办辅助行，精简版系统提示词不复述工具描述），附插件页配置卡片（地址/Sync ID/CLI/策略可 GUI 直改，密钥走行级注入） | [docs](packages/actual/docs/README.md) |
| [`@dsh-plus/actual-tools`](packages/actual-tools) | tool | 通用 | Actual Budget 子插件（仅 actual 预设挂载）：能力 1:1 包装为 agent 作用域 DSH 工具，写操作按 DSH 审批策略确认（完全权限自动通过、绝不静默拒绝），`actual:env` 环境快照（含版本不匹配告警），MCP 优先 CLI 兜底 | [docs](packages/actual-tools/docs/README.md) |
| [`@dsh-plus/actual-reports`](packages/actual-reports) | lib + bin | 通用 | Actual Budget 伴侣 CLI（非插件）：补上官方 API/CLI 缺失的自定义报表与仪表盘能力——读报表定义、按官方口径复算数据、建改删报表，以及仪表盘页面与组件的增删改与排版（零依赖，运行期从已检测到的官方 CLI 解析 `@actual-app/api`，不钉版本） | [docs](packages/actual-reports/docs/README.md) |
| [`@dsh-plus/tool-text-transform`](packages/tool-text-transform) | tool | 通用 | 纯函数演示工具（uppercase / lowercase / reverse / length），插件链路参考实现 | [docs](packages/tool-text-transform/docs/README.md) |
| [`@dsh-plus/agent-preset-chat`](packages/agent-preset-chat) | persona | 通用 | 注册纯聊天模式 agent 预设（id=`chat`）：空工具目录 + complete persona 前缀，含遗留 `.agent-presets/chat` 迁移 | [docs](packages/agent-preset-chat/docs/README.md) |
| [`@dsh-plus/bundle-main`](packages/bundle-main) | bundle | 通用 | 聚合编排层：按序 insert 正式插件行，单插件脱离 bundle 亦可独立安装 | — |
| [`@dsh-plus/shared`](packages/shared) | library | 通用 | 工作区共享纯函数库（非插件；原子写委托官方 dsh-atomic-write） | — |
各包版本号见对应 `packages/*/package.json` 与 npm 页面，不在此复述（避免与发版脱节）。

平台列图例：**通用** = 无平台限制（web profile / 桌面端 / Windows 按设计接入，
未注明处不含平台特判）；**通用·py** = 需要本机 Python 解释器；**Linux** = 依赖
systemd，桌面端/Windows 下相关能力显式降级。桌面/Windows 的验证状态见
[docs/reference/官方机制参照.md](docs/reference/官方机制参照.md)「平台验证矩阵」。

## 快速开始

### 环境要求

- Node.js **≥ 22**（测试依赖 `node --test` 直接运行 TypeScript）
- pnpm（经 corepack 启用）
- 已安装 DSH（`@deepseek-ai/dsh`，兼容下限 `0.2.0`，当前基线 `0.2.1-alpha.1`）

### 安装到 DSH

所有包已发布到 npm，直接用 `dsh plugin` 安装即可（工作区内部依赖会正常解析）：

```bash
# 安装单个插件到 web profile
dsh plugin --profile web add @dsh-plus/ui-mobile-fit

# 或安装聚合包：cordis.patch.yml 会把全部正式插件按序装配进组合树
dsh plugin --profile web add @dsh-plus/bundle-main
```

安装后重启 dsh web 生效；带配置界面的插件在 webui 侧边栏「插件」页对应行的
「配置」入口调整，持久化到 profile 行级覆盖层（`cordis.patch.yml`）并热生效。

**桌面端（官方 DSH Desktop）**：插件不经 CLI 安装——在桌面端 GUI 内
「设置 → 插件 → 安装插件」搜索 `@dsh-plus/…` 安装（桌面端内置 pnpm 管理，
profile 为 `desktop`，配置落 `$DSH_HOME/profiles/desktop`；CLI 不接受
`--profile desktop`）。带配置卡片的插件在该页对应行的「配置」入口调整，与 web 端一致。

**Windows**：CLI 安装与开发在 Git Bash/WSL 下照常（`dsh plugin add` 同命令）；
插件运行时的平台适配见下方「平台与桌面端支持」。

### 平台与桌面端支持

- **桌面端 = 官方 DSH Desktop（Electron，`desktop` profile）**：插件由桌面端
  内置 pnpm 安装管理；`ctx.profileContext`（`installAnchor`/`patchPath`/`name`）
  是 CLI 与桌面端共用的运行时事实，本仓库的 dsh 树解析、patch 落点均优先取它。
- **Windows（范围 = 仅插件运行时）**：仓库工具链（`scripts/dshctl.py`、测试脚本）
  不做 Windows 化；插件运行时已适配——进程树终止走 `taskkill /PID <pid> /T /F`、
  解释器发现走 PATH + `py -3` 兜底、路径判据识别盘符与 UNC、双分隔符面包屑、
  桌面/非 Linux 的门控文案。官方上游本身就是 bash↔pwsh 双轨（`process.platform
  === 'win32'`），无 systemd/journalctl 依赖。
- **不做平台特判的部分**：桌面端 webServer 流量对插件的可见性（IPC bridge）、
  桌面端插件清单、Electron 是否暴露重启 API——均未实测，对应能力以降级形态
  提供（reload 按钮禁用、lifeboat 无 patchPath 时告警停用）。
- **官方机制与平台验证矩阵**：见
  [docs/reference/官方机制参照.md](docs/reference/官方机制参照.md) 的
  「桌面端与 profileContext」「客户端平台与热更」「Windows 运行时要点」「平台验证矩阵」。

### 从源码构建

```bash
pnpm install      # 安装 workspace 依赖
pnpm build        # 构建全部插件（产物在 packages/*/lib）
pnpm lint         # biome 静态检查（lint + format + import 整理）
pnpm lint:fix     # biome 自动修复并格式化
pnpm test         # 运行全部单元测试（纯逻辑，无网络、零 API 费用）

# 本地开发：link 安装，配合 tsdown --watch 热更浏览器半
dsh plugin --profile web add link:packages/ui-mobile-fit
```

## 仓库结构

```
packages/
  ui-mobile-fit/        移动端窄屏适配（UI 覆盖）
  remote-settings/      非 loopback 页面设置平面修复
  notify-email/         任务结束邮件通知
  llm-pi/               自定义 LLM 路由
  lifeboat/             故障救生艇（隔离/应急翻译/告警）
  reload/               设置按钮 + /reload 命令重载或重启 dsh-web
  usage-panel/          用量统计面板（token 聚合/报表/费用估算）
  access-gate/          Web 访问围栏（合并官方认证 / token 输入页恢复 PWA / IP 附加围栏）
  boot-retry/           弱网引导重试（零缓存重试加载器）
  web-cache-headers/    GUI 静态资源 immutable 缓存头
  web-boot-timing/      弱网首屏计时观测
  web-shell-sw/         外壳 Service Worker（离线兜底）
  error-retry/          特定报错纳入上游重试
  subagent-model/       子代理独立模型配置
  web-files/            Web 内嵌类 SFTP 文件浏览与编辑
  image-studio/         图像工作室（文生图/图生图/画廊）
  secret-env/           环境变量密钥注入（$DSH_VAR_*）
  web-search-services/  web_search 免费后端聚合（Python 桥接特例）
  siyuan/               思源笔记主插件（能力发现服务 + siyuan 预设注册）
  siyuan-tools/         思源笔记子插件（预设内工具包装 + 审批/写前快照安全网）
  actual-mcp/           Actual 能力封装（格式一：CLI help 树 → stdio MCP 服务）
  actual/               Actual 主插件（能力发现服务 + actual 预设注册 + 配置卡片）
  actual-tools/         Actual 子插件（预设内工具包装 + 审批/环境快照）
  actual-reports/       Actual 伴侣 CLI（报表与仪表盘：官方 API/CLI 未提供的能力）
  tool-text-transform/  演示工具（dev-only，不进生产 bundle）
  agent-preset-chat/    纯聊天 agent 预设（id=chat）
  bundle-main/          聚合编排层
  shared/               共享纯函数库
scripts/
  dshctl.py             开发/分发入口（测试、mock 调试、dev 实例、npm 发版）
  dshctl/               dshctl 实现与 dsh-dev-mock 技能
  mock_llm.py           本机 mock LLM（开发零真实 API 费用）
  tests/                dshctl 单元测试
```

## 开发

```bash
python3 scripts/dshctl.py --help        # 全部子命令与用法
python3 scripts/dshctl.py test          # 静态检查 + 构建 + 单测
python3 scripts/dshctl.py dev up        # 起 dev 实例（mock LLM，零费用）
```

本机差异经环境变量配置（`DSHCTL_DSH_BIN` / `DSHCTL_TOKEN_FILES`），
或写入 `scripts/dshctl/local_config.py`（不入库）；git 门禁统一由 projects-go
钩子承载（`python3 scripts/dshctl.py init-hooks` 安装，每人一次）。

## 许可证

[MIT](LICENSE) © 2026 agguy
