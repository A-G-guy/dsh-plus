---
description: ADR 0005：架构门禁采用 biome 内置规则，不引入依赖图工具
type: event
last_modified: "2026-10-07 00:39"
---

# ADR 0005：架构门禁采用 biome 内置规则，不引入依赖图工具

- 状态：已采纳（2026-10-03）
- 背景：AGENTS.md 要求「禁止反向、循环、跨层依赖」并由架构检查工具强制。本仓此前
  没有任何依赖/架构检查：projects-go 只做文档、行数、密钥、测试分离等结构检查，
  其 `hook.checks` 是固定词表、不支持外挂脚本；仓库内也无 dependency-cruiser / madge /
  ESLint 等依赖图工具。

## 候选方案与实测结论

实测均在真仓执行（2026-10-03）。

| 方案 | 实测结论 |
|---|---|
| biome 2.5.11 内置规则（仓库已装） | 覆盖循环、未声明依赖、私有入口、受限导入四类；语义与预期一致 |
| dependency-cruiser 18.5.0 | 能力更强但三处与本仓约定冲突，见下 |
| 自研 `dshctl arch` 图检查 | 约 300 行 + 单测，且大部分规则 biome 已内置，收益不成立 |

关键实测数据：

- biome `suspicious/noImportCycles`：运行期环（a↔b）正控制命中；`import type` 环不命中；
  真仓 0 命中。跨包解析、workspace 与 `.ts` 后缀导入均可解析。
- biome `correctness/noUndeclaredDependencies`：真仓 14 处 error **全部**落在
  `packages/*/tsdown.config.ts` 引根 devDependency `tsdown`，源码 0 命中。
- biome `style/noRestrictedImports`：`group` 支持 `!` 取反；包级分层矩阵、`@dsh-plus/*/src/*`
  深路径、`@dsh-plus/bundle-main` 三类规则均按预期命中（逐条正负控制已验证）。
- 隐去全部 `packages/*/lib`（干净克隆）复跑，biome 四条规则结果与带产物一致：规则不依赖构建产物。
- dependency-cruiser：配 `exportsFields`/`conditionNames` 后 380 模块 / 461 依赖 / 0 解析失败，
  `to.reachable: true` 的项目内可达性有效（10 处命中）；但
  (1) 默认把 `import type` 边判为运行期边，真仓报 14 处假循环，按文档带上包级 tsconfig 仍误报；
  (2) `no-non-package-json` 报 21 处假阳性（`@dsh-plus/shared/client` 经 exports 解析到源码后
  被判为非 package.json 依赖）；
  (3) `reachable` 规则对 node_modules 目标（react 等）不生效——npm 包不进模块列表。

## 决定

1. 架构门禁由 biome 内置规则承载，配置在 `biome.json`，随 `pnpm lint`、`dshctl test` /
   `finish` 执行：
   - `suspicious/noImportCycles`——禁止运行期循环（跨包 + 包内文件级）。
   - `style/noRestrictedImports`——包级分层矩阵、禁止 `@dsh-plus/*/src/*` 深路径、
     禁止 import `@dsh-plus/bundle-main`。
   - `correctness/noUndeclaredDependencies`——经 overrides 限定 `packages/*/src` 与
     `packages/*/tests`，避免与根 devDependency（tsdown）的既有约定冲突。
   - `correctness/noPrivateImports`——禁止导入目标包未导出的私有入口。
2. 分层模型（内 → 外）：`shared` → 功能插件（互不依赖，联动只经 cordis 服务）→
   `bundle-main`。唯一例外 `siyuan-tools → siyuan` 在 `biome.json` 白名单显式登记。
3. 不引入 dependency-cruiser，不自研检查器；传递可达性类规则暂缓（见「后果与边界」）。
4. 架构例外只能改 `biome.json` 登记，并在本 ADR 或仓库管理规范说明理由；
   禁止用 `biome-ignore` 逐行绕过架构规则。
5. ~~文档 append_only 检查降为 warn 级~~——该条已由 [adr/0006](0006-提交门禁执行文档规则.md)
   取代并从本 ADR 移除（append_only 现为 error 级，判定已豁免工具自维护字段）。

## 后果与边界

- **传递可达性无守门**：如「宿主半不得经任意跳转触达浏览器半」。原型实测该维度现状 0 违规
  （忽略 `import type` 边后，2 处疑似均为 type-only），属预防性规则。真出现越界时再评估
  dependency-cruiser（只需 reachable 规则，不接管循环与声明检查）或一段 40 行脚本。
- node_modules 级别的半隔离（如 client 半依赖 react）由 biome 语句级规则与 overrides 覆盖，
  不做传递判定。
- pre-commit 无法外挂脚本，架构规则不在提交时即时拦截；与 [adr/0002](0002-类型检查纳入守门.md)
  的类型闸门覆盖面相同——提交前必须自行跑 `pnpm test`。
