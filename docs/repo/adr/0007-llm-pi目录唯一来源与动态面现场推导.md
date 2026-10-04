---
last_modified: "2026-10-04 14:10"
description: "ADR 0007：llm-pi 模型目录唯一来自 pi-ai 内置目录，协议/compat/字段集全部现场推导"
type: event
---

# ADR 0007：llm-pi 模型目录唯一来自 pi-ai 内置目录，动态面全部现场推导

- 状态：已采纳（2026-10-04）
- 背景：插件要"自动跟随已装 dsh 内部的 pi-ai"，而官方 pi-ai 每版都在改模型目录、
  改 compat 字段集；同时仓库里存在过第二份目录（models.dev 兜底快照），
  于是出现"测试跑的目录 ≠ 生产跑的目录"，以及"官方扩容字段而插件手抄表漏收 →
  官方可配字段被误拒"（0.1.5-rc.1 事故，见包文档）两类问题。

## 决定

1. **模型目录唯一来源 = 已装 dsh 树里的 pi-ai 内置目录**（找不到树才退 vendored
   副本）。删除 models.dev 兜底源：`models-dev.ts`、三个根配置字段
   （`catalogUrl`/`catalogRefreshHours`/`catalogProxy`）、缓存文件
   `$DSH_HOME/dsh-plus/llm-pi/models-dev.json`、`/catalog/refresh` 端点与
   `https-proxy-agent` 依赖一并移除。`adapter: deepseek` 路由不受影响——它继承官方
   `dsh-llm-deepseek` 自带目录，与本决定无关。
2. **动态面全部现场推导，不钉版本**：协议集合取官方包根 `supportedProtocols()`
   （工厂按 `pi-ai/dist/api/<api>.lazy.js` 动态加载）；compat 门控取官方 bundle 的
   `COMPAT_GATES`、取值约束取官方 `Config` schema；**模型条目字段集**取官方
   `providers.*.models` 键集，并按该集合把 pi-ai 目录的同名字段透传进条目。
   任一推导失败都逐项回退内置快照并记诊断，绝不阻断启动。
3. **回退快照放宽而非收紧**：compat 表回退（推导失败）时**未知键放行**，只拒绝快照
   中明确 `withhold` 的键，把最终裁决交给官方适配器自身校验——表落后时"误拒官方新
   字段"比"多放一个键"严重得多。
4. **peer 版本不设上界**：`@earendil-works/pi-ai` 声明为 `>=0.85.1`；能否工作由运行期
   形状自检（`assertKitShape`）与逐项降级决定。生效版本、安装树、目录数据时间与全部
   降级诊断在配置页状态行显示；超出 `VERIFIED_PI_AI_RANGE`（`>=0.85.1 <0.88.0`）
   只提示不阻断。
5. **目录浏览器放进配置卡，不做独立设置页**：一键 extend 直接改卡片草稿，保存语义
   仍是"草稿 → 保存"，避免两个页面同写一个 settings 命名空间互相覆盖（一份持久化
   数据只有一个写入方）。
6. **依赖对齐**：本包 devDependencies 的 `@deepseek-ai/*` 对齐本机安装的 dsh 线
   （0.2.1-alpha.1）、pi-ai 对齐 0.87.1，使构建/类型/单测面对的就是运行期那份套件。
   核对中发现**全仓都停在 0.2.0-rc.1**，导致 11 个包逐包 `tsc` 报
   `Property 'webServer'/'credentials' does not exist on type 'Context'`（平台包的
   类型增强与代码目标线错位，与本次功能改动无关，已用独立 worktree 在 HEAD 复现）。
   故一并执行 `dshctl platform-sync 0.2.1-alpha.1` + 基座包手工对齐
   （cordis `4.0.5-alpha.1` / schemastery `3.18.5-alpha.1`）：**24/24 包类型检查与
   公共契约转绿，零代码改动**——印证"devDeps 必须跟随运行期平台线"这条纪律。

## 后果

- 旧配置里的 models.dev provider 名做继承源会被写时拒绝（提示可用 provider 列表）；
  残留的目录端点键不再被 schema 声明，保存一次即不再写出。
- 官方新增协议/模型级字段/offer 字段时，本插件**无需发版**即可用；只有官方改打包
  形态或删除形状（如 `supportedProtocols`、`COMPAT_GATES` 命名）才需要跟进。
- 配置页多了一屏"参数事实"（生效版本、目录规模、数据生成时间、诊断），
  排查"插件是否落后"不再需要登录实例翻日志。
