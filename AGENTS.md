## 项目简介

- 定位：DSH（DeepSeek Harness）增强插件 pnpm monorepo：`packages/*` 各为独立 ESM 包，发布于 npm `@dsh-plus` scope，经 `@dsh-plus/bundle-main` 聚合装配。
- 技术栈：TS（cordis 插件；`node --test` 直跑 TS，不经编译；tsdown 出产物）
- 入口与关键目录：源码 `packages/*/src`、测试 `packages/*/tests`；配置 `projects.go.toml`、`biome.json`、`tsconfig.base.json`、`pnpm-workspace.yaml`；开发入口 `python3 scripts/dshctl.py`（下称 `dshctl`，实现在 `scripts/dshctl/`）；文档 `docs/`（repo/ops/plugin-dev/reference）+ 各包 `packages/*/docs/`。

## 命令与门槛

```bash
pnpm install    # 依赖（Node ≥22，pnpm 经 corepack）
pnpm build      # 各包 tsdown → packages/*/lib（不入库）
pnpm lint       # biome：lint + format + import 整理 + 架构规则
pnpm typecheck  # 逐包 tsc --noEmit + 公共契约检查
pnpm test       # 全量守门：lint → 构建 → 类型 → 单测（零网络、零费用）
dshctl dev up   # dev 实例（mock LLM，零费用）
dshctl finish   # 收尾：test → bump → commit → push → publish → install
```

- 本仓无 CI：守门靠根脚本、各包测试、projects-go 钩子（pre-commit / commit-msg / pre-push）。
- 提交前跑 `pnpm test`：projects-go 的 pre-commit 按索引执行全部门禁（含 required_fields、append_only、scope、language），error 级直接拦提交；只想预演提交判定用 `projects-go check --staged`，全仓视角用 `projects-go check`。
- 发布、回滚、改权限与 CI、打断运行中的 dsh 进程前先确认。
- 细则见[仓库管理规范](docs/repo/仓库管理规范.md)、[插件开发指南](docs/plugin-dev/插件开发指南.md)、[文档索引](docs/INDEX.md)。

## 开发规范

- 依赖方向：外层依赖内层（`shared` → 功能插件 → `bundle-main`）；领域层不依赖框架、DB、UI、外部服务；禁止反向、循环、跨层依赖；插件间联动只走 cordis 服务（`ctx.provide`/`ctx.inject`），不得 import 对方实现；由 biome 内置规则（`noImportCycles`/`noUndeclaredDependencies`/`noPrivateImports`/`noRestrictedImports`）强制，配置见 `biome.json`。
- 仅公开必要接口；跨模块只经公开接口，不访问内部实现、数据表、私有文件；对外接口不返回持久化实体或内部模型。
- 每份持久化数据仅一个模块可写，其他模块只读或经其接口写。
- 禁止全局可变状态；模块间不靠执行顺序传数据，显式传参或经接口。
- 不建 `utils/common` 汇总目录；共享代码须被至少两个模块使用，不依赖业务概念且稳定。
- 如项目采用分层架构，核心业务规则集中在领域层，不散落在 controller、job、CLI。
- 不为单一使用方创建抽象；出现第二个真实使用方再提取。
- 外部资源（DB、HTTP、文件、时钟、随机数）经依赖注入传递。
- 改公共接口前检查所有调用方并同步更新，不留未要求的兼容层。
- 校验系统边界输入，失败返回明确错误，不用默认值兜底；内部模块间基于契约信任。
- 只捕获能恢复或转为用户可读错误的异常；其余向上抛并携带上下文。
- 避免过度防御：不重复校验已校验输入，不为不可能状态兜底，不用默认值掩盖错误，不加无意义 try/catch；契约不可信先修契约。
- 卫语句尽早返回；条件嵌套超过 3 层提取为独立函数。
- 可调参数外部化（环境变量/参数），严禁硬编码；仅限面向用户或环境的参数，重试次数、缓冲区大小等内部常量不外部化。
- 限制行数：TS 函数 60/150、类型 250/1500、文件 500/1500；Python 函数 50/120、类型 80/1500、文件 500/1500；包/模块 10000（仅警告）。超限即拆分，不改阈值；改动 baseline 已放行的超限函数会立即激活拦截，须先拆分。
- 命名遵循语言生态惯例；导出/非导出按语言机制区分。
- 异步统一使用 async/await，不混用回调与 Promise 链。
- 提交信息使用 Conventional Commits（类型与正文逐条 `- ` 条目由 commit-msg 钩子强制）。
- 无法修复或需用户决策时，停止并报告，不猜测、不绕过。
- 本文件与用户当前指令冲突时，暂停并说明冲突点，由用户裁决。
- 不以“先能跑再重构”写代码；不绕过架构约束；不为当前需求写临时方案，确需时先向用户确认并标注移除条件。
- 不留 TODO、FIXME、注释代码、死代码；必须保留时标注原因与移除条件。
- 修改前评估对现有模块的影响，不局部打补丁。

## 操作边界

- 不可逆、生产环境、数据库迁移、部署/发布/回滚前，先向用户确认。
- 修改 secrets、权限、云资源、CI 配置前，先向用户确认。
- 涉及兼容时主动询问用户，不擅自兼容或破坏。
- 禁止将 secrets、个人信息写入代码、日志、测试夹具。

## 测试规范

- 测试文件不得与生产代码同文件。
- 按被测业务行为命名，一个文件对应一个行为域。
- 只测业务规则、边界与回归；不测简单转发、getter/setter、第三方库。
- 修复 bug 附带能复现该 bug 的回归测试。
- 核心变更同步补测，即时清理失效测试。
- 测试不依赖执行顺序，不 sleep，不访问真实网络与时钟。
- 复杂输出用整段固定期望断言；期望值过长时外置为 `tests/` 下的夹具文件。
- 不写为覆盖率服务的测试。
- 不通过禁用规则、跳过测试来“通过”。

## 文档规范

- 不写营销语、寒暄、重复内容、无信息量总结段；文档语言为中文。
- 统一置于 `docs/`（插件契约文档在 `packages/*/docs/`），按内容类型分目录。
- 每篇文档加 YAML 头部：

  - `last_modified`：脚本自动维护，禁止手动修改。
  - `description`：一句话描述文档内容和作用。
  - `type`：`fact`（长期事实）或 `event`（事件型）。
- `fact` 只记当前有效结论，不出现事件、过程、历史；更新时覆盖。
- `event` 只增不改；满足任一即记录：影响用户或数据、根因非显然、再次出现、决策影响架构或外部接口。
- `fact` 与 `event` 可互相引用，但不得重复内容。
- 核心代码变更同步更新文档，过时即更新或删除。

## 特殊要求

- 每次开发结束后执行 dshctl finish 全流程，不用向用户确认
- 开发测试、调试严禁产生真实 API 调用导致额外费用。
- `dshctl` 能力不足允许按规范加强。
- 打断正在工作的 dsh 进程必须由用户确认（提示 `/reload` 即可）。
- 发现 dsh 原生能力已覆盖用户需求时，先向用户二次确认，避免重复开发。
- 大功能拆分为几个小插件，避免大量功能堆积在单一插件。
- 本文件是活文档：命令、目录、门禁、契约变化时同步更新；与实现不符处以代码与配置为准。
