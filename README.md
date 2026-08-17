<div align="center">

# agguy's DSH Plugins

**面向 [DSH（DeepSeek Harness）](https://www.npmjs.com/package/@deepseek-ai/dsh) 的自定义插件 monorepo**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-workspace-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![dsh](https://img.shields.io/badge/dsh-0.1.0--rc.6-blue)](https://www.npmjs.com/package/@deepseek-ai/dsh)

</div>

---

本仓库以 pnpm monorepo 形式维护一组 DSH 自定义插件。每个插件都是独立的 ESM npm 包
（cordis 约定导出），可单独 `pnpm pack` 分发安装，也可经 `@dsh-custom/bundle-main`
聚合为一层有序的 cordis patch 统一装配。

## 插件一览

| 包 | 版本 | 类型 | 说明 | 文档 |
|---|---|---|---|---|
| [`@dsh-custom/ui-mobile-fit`](packages/ui-mobile-fit) | 0.1.3 | UI | 纯 CSS 覆盖的移动端窄屏响应式适配，不 fork 上游、跟随升级 | [docs](packages/ui-mobile-fit/docs/README.md) |
| [`@dsh-custom/notify-email`](packages/notify-email) | 0.1.0 | service + UI | 任务完成 / 等待决策 / 出错停止时向指定邮箱发送邮件通知 | [docs](packages/notify-email/docs/README.md) |
| [`@dsh-custom/subagent-model`](packages/subagent-model) | 0.1.0 | service + UI | 为 `subagent` / `subagent_fork` 等子代理单独配置模型与思考程度 | [docs](packages/subagent-model/docs/README.md) |
| [`@dsh-custom/llm-pi`](packages/llm-pi) | 0.1.0 | service + UI | 基于 pi-ai 的自定义 LLM 路由：三协议 route、官方目录继承、全量 compat、models.dev 兜底 | [docs](packages/llm-pi/docs/README.md) |
| [`@dsh-custom/tool-text-transform`](packages/tool-text-transform) | 0.1.0 | tool | 纯函数演示工具（uppercase / lowercase / reverse / length），插件链路参考实现 | [docs](packages/tool-text-transform/docs/README.md) |
| [`@dsh-custom/bundle-main`](packages/bundle-main) | 0.1.0 | bundle | 聚合编排层：按序 insert 正式插件行，单插件脱离 bundle 亦可独立安装 | — |
| [`@dsh-custom/shared`](packages/shared) | 0.1.0 | library | 工作区共享纯函数库（非插件） | — |

## 快速开始

### 环境要求

- Node.js **≥ 22**（测试依赖 `node --test` 直接运行 TypeScript）
- pnpm（经 corepack 启用）
- 已安装 DSH（`@deepseek-ai/dsh`，基准版本 `0.1.0-rc.6`）

### 构建与测试

```bash
pnpm install      # 安装 workspace 依赖
pnpm build        # 构建全部插件（产物在 packages/*/lib）
pnpm test         # 运行全部单元测试（纯逻辑，无网络、零 API 费用）
```

### 安装到 DSH

```bash
# 打包单个插件（workspace:* 依赖会自动落成真实版本号）
pnpm --filter @dsh-custom/ui-mobile-fit pack

# 装进 dsh 的 web profile
dsh plugin --profile web add ./dsh-custom-ui-mobile-fit-0.1.3.tgz

# 本地开发可用 link 安装，配合 tsdown --watch 热更浏览器半
dsh plugin --profile web add link:packages/ui-mobile-fit
```

也可以直接安装聚合包 `@dsh-custom/bundle-main`：其 `cordis.patch.yml` 会把全部正式插件
按序装配进 profile 组合树，后续用户补丁层仍可按 id 覆盖配置或禁用单个插件。
安装后重启 dsh web 生效；带配置界面的插件在 webui「设置 → 插件 → 插件配置」中调整，
持久化到 `$DSH_HOME/settings.yaml` 并热生效。

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
