# AGENTS.md

DSH（DeepSeek Harness）增强插件 pnpm monorepo：`packages/*` 各为独立 ESM 包，发布于 npm `@dsh-plus` scope，经 `@dsh-plus/bundle-main` 聚合装配。

## 快速导航

- `packages/<包>/`：`src/` 源码、`tests/` 单测、`docs/` 插件契约；产物 `lib/`（构建生成，不入库）
- `scripts/dshctl.py`：开发/测试/发版统一入口（下称 `dshctl`），用法见 `python3 scripts/dshctl.py --help`
- `scripts/dshctl/skills/dsh-dev-mock`：mock 调试与零费用护栏用法
- [docs/INDEX.md](docs/INDEX.md)：文档索引（由 `projects-go index` 生成）；插件与架构见[官方文档](https://deepseek-harness.github.io/deepseek-harness/develop/basic/)
- [docs/repo/仓库管理规范.md](docs/repo/仓库管理规范.md)：分支/提交/版本/依赖分层/门槛的权威细则
- [docs/plugin-dev/插件开发指南.md](docs/plugin-dev/插件开发指南.md)：四类插件骨架与 cordis 契约；[docs/repo/adr/](docs/repo/adr/)：架构决策与事故沉淀
- 本仓无 CI：守门靠 pre-commit 钩子与根脚本；平台包必须 peer 的依赖红线见 [ADR 0001](docs/repo/adr/0001-平台依赖必须-peer.md)

## 命令（根目录执行；Node ≥22，pnpm 经 corepack）

```bash
pnpm install    # 装依赖
pnpm build      # 构建全部包（产物 packages/*/lib）
pnpm lint       # biome 检查；pnpm lint:fix 自动修复
pnpm typecheck  # 逐包 tsc --noEmit + 公共契约检查
pnpm test       # 全量守门：lint + 类型 + 构建 + 单测（零网络、零 API 费用）
dshctl dev up   # 起 dev 实例（mock LLM，零费用）
```

- 单测由 `node --test` 直接运行 TS，测试位于各包 `tests/`。
- 完成前验证：`pnpm test` 全绿。
- 一次完整开发结束用 `dshctl finish` 收尾（test→bump→commit→push→publish→install）。

## 代码规范

### 架构

- 按业务领域分层，严禁循环依赖；面向接口编程，复杂服务经依赖注入传递。
- 默认最小访问权限，仅公开必要接口；外部入口与核心领域边界必须校验输入。
- 持久化实体与表现层用 DTO 解耦，禁止直接暴露内部结构。
- 运行期联动走 cordis 服务（`ctx.provide`/`ctx.inject`），禁止 import 其他包内部实现。

### 代码结构

- 函数/方法 ≤50 行，类/模块 ≤300 行（设计目标；硬门槛由 projects-go 的 lines 检查承载，数值见 `projects-go help lines`）。
- 卫语句尽早返回，`if-else` 嵌套 ≤3 层；复杂条件提取为独立函数。
- 统一 async/await，禁止回调与 Promise 链混用。
- 环境差异与可调参数必须外部化，严禁硬编码。
- 仅在系统边界做必要校验，内部模块基于契约信任。
- 仅捕获可处理的错误，禁止过度防御；错误必须带上下文日志，严禁静默丢弃。

### 测试

- 只测核心规则与复杂逻辑，禁止测简单属性、转发、配置。
- 用 Given-When-Then 业务语言，断言必须能捕获验收条件中的错误。
- 核心变更同步补测；即时清理脆弱、意图模糊或失效的测试。

### 提交

- Conventional Commits：`<type>: <简短描述>`，核心变更以 `- <具体变更>` 列出。
- 类型：`feat`、`fix`、`docs`、`style`、`refactor`、`test`、`chore`，回滚统一用 `revert`；门禁另允许 `perf`/`build`/`ci`。

### 文档

- 只写长生命周期文档（架构决策、数据字典、核心契约），置于 `docs/` 按模块分目录，中文、UTF-8。
- 核心代码变更同步更新文档，过时即更新或删除，索引始终反映真实状态。
- `last_modified` 与 `INDEX.md` 由 projects-go（`doc`/`index` 及 pre-commit 钩子）自动维护，禁止手动修改。

## 项目特化要求

- 开发测试、调试严禁产生真实 API 调用导致额外费用；调试走 `dshctl dev` / `dshctl mock`。
- `dshctl` 能力不足允许按规范加强，但仍严禁产生真实费用。
- 打断正在工作的 dsh 进程必须由用户确认（提示 `/reload` 即可）。
- 发现 dsh 原生能力已覆盖用户需求时，先向用户二次确认，避免重复开发。
- 大功能拆分为几个小插件，避免大量功能堆积在单一插件。

## AGENTS.md 维护

- 本文是活文档：构建/测试命令、关键目录、依赖、架构、契约或用户需求变化时更新；完成相关变更后发现过时，应更新或提议更新，不确定先询问。
- 涉及项目具体实现的内容随项目改动一同更新；与实现不符时以代码/配置为准，不为减少改动而保留旧内容。
- 改动方式：默认局部编辑，保留仍成立的结构与措辞；差异过大才整篇重写，重写前先备份原文件并说明原因。
- 内容按 `agents-md-writer` skill 与用户本次要求组织；只作项目了解、规范与避坑入口，细节指向 README、docs/、ADR、契约文档。
- 只写稳定信息：不写版本号、文件清单、代码行数、进度、指标、临时约定；此类信息改写为稳定规则或指向权威来源。
- 写入前自检：代理已会的不写；单次偶发问题优先代码层修复；上游工具文档只给链接；他处已覆盖的不重复；不写无判定标准的套话。
- 行数硬上限 150、目标 ≤120；超限先精简再重排，禁止把多要点塞进一行、合并长行等排版手段凑数。
- 精简要求：短句、列表、链接；同一信息只出现一次；能删就删，不写空话与通用最佳实践。
