<div align="center">

# DSH+

**面向 [DSH（DeepSeek Harness）](https://www.npmjs.com/package/@deepseek-ai/dsh) 的增强插件集，发布于 npm [`@dsh-plus`](https://www.npmjs.com/org/dsh-plus) scope**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![npm @dsh-plus](https://img.shields.io/badge/npm-%40dsh--plus-CB3837?logo=npm&logoColor=white)](https://www.npmjs.com/org/dsh-plus)
[![Node](https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-workspace-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![dsh](https://img.shields.io/badge/dsh-0.1.0--rc.6-blue)](https://www.npmjs.com/package/@deepseek-ai/dsh)

</div>

---

DSH+ 以 pnpm monorepo 形式维护一组 DSH 增强插件。每个插件都是独立的 ESM npm 包
（cordis 约定导出），全部发布在 npm 的 [`@dsh-plus`](https://www.npmjs.com/org/dsh-plus)
scope 下，可单独安装，也可经 `@dsh-plus/bundle-main` 聚合为一层有序的 cordis patch 统一装配。

## 插件一览

| 包 | 版本 | 类型 | 说明 | 文档 |
|---|---|---|---|---|
| [`@dsh-plus/ui-mobile-fit`](packages/ui-mobile-fit) | 0.1.3 | UI | 纯 CSS 覆盖的移动端窄屏响应式适配，不 fork 上游、跟随升级 | [docs](packages/ui-mobile-fit/docs/README.md) |
| [`@dsh-plus/notify-email`](packages/notify-email) | 0.1.0 | service + UI | 任务完成 / 等待决策 / 出错停止时向指定邮箱发送邮件通知 | [docs](packages/notify-email/docs/README.md) |
| [`@dsh-plus/subagent-model`](packages/subagent-model) | 0.1.0 | service + UI | 为 `subagent` / `subagent_fork` 等子代理单独配置模型与思考程度 | [docs](packages/subagent-model/docs/README.md) |
| [`@dsh-plus/llm-pi`](packages/llm-pi) | 0.1.0 | service + UI | 基于 pi-ai 的自定义 LLM 路由：三协议 route、官方目录继承、全量 compat、models.dev 兜底 | [docs](packages/llm-pi/docs/README.md) |
| [`@dsh-plus/skill-manual`](packages/skill-manual) | 0.1.0 | skill provider | 手动触发技能独立目录（`$DSH_HOME/skills-manual`）：不进模型 catalog，斜杠发现 + `/name` 注入 | [docs](packages/skill-manual/docs/README.md) |
| [`@dsh-plus/tool-text-transform`](packages/tool-text-transform) | 0.1.0 | tool | 纯函数演示工具（uppercase / lowercase / reverse / length），插件链路参考实现 | [docs](packages/tool-text-transform/docs/README.md) |
| [`@dsh-plus/bundle-main`](packages/bundle-main) | 0.1.0 | bundle | 聚合编排层：按序 insert 正式插件行，单插件脱离 bundle 亦可独立安装 | — |
| [`@dsh-plus/shared`](packages/shared) | 0.1.0 | library | 工作区共享纯函数库（非插件） | — |

## 快速开始

### 环境要求

- Node.js **≥ 22**（测试依赖 `node --test` 直接运行 TypeScript）
- pnpm（经 corepack 启用）
- 已安装 DSH（`@deepseek-ai/dsh`，基准版本 `0.1.0-rc.6`）

### 安装到 DSH

所有包已发布到 npm，直接用 `dsh plugin` 安装即可（工作区内部依赖会正常解析）：

```bash
# 安装单个插件到 web profile
dsh plugin --profile web add @dsh-plus/ui-mobile-fit

# 或安装聚合包：cordis.patch.yml 会把全部正式插件按序装配进组合树
dsh plugin --profile web add @dsh-plus/bundle-main
```

安装后重启 dsh web 生效；带配置界面的插件在 webui「设置 → 插件 → 插件配置」中调整，
持久化到 `$DSH_HOME/settings.yaml` 并热生效。

### 从源码构建

```bash
pnpm install      # 安装 workspace 依赖
pnpm build        # 构建全部插件（产物在 packages/*/lib）
pnpm test         # 运行全部单元测试（纯逻辑，无网络、零 API 费用）

# 本地开发：link 安装，配合 tsdown --watch 热更浏览器半
dsh plugin --profile web add link:packages/ui-mobile-fit
```

## 仓库结构

```
packages/
  ui-mobile-fit/        移动端窄屏适配（UI 覆盖）
  notify-email/         任务结束邮件通知
  subagent-model/       子代理独立模型配置
  llm-pi/               自定义 LLM 路由
  tool-text-transform/  演示工具（dev-only，不进生产 bundle）
  bundle-main/          聚合编排层
  shared/               共享纯函数库
```

## 许可证

[MIT](LICENSE) © 2026 agguy
