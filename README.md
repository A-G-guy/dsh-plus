<div align="center">

# DSH+

**面向 [DSH（DeepSeek Harness）](https://www.npmjs.com/package/@deepseek-ai/dsh) 的增强插件集，发布于 npm [`@dsh-plus`](https://www.npmjs.com/org/dsh-plus) scope**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![npm @dsh-plus](https://img.shields.io/badge/npm-%40dsh--plus-CB3837?logo=npm&logoColor=white)](https://www.npmjs.com/org/dsh-plus)
[![Node](https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-workspace-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![dsh](https://img.shields.io/badge/dsh-0.1.2--alpha.1-blue)](https://www.npmjs.com/package/@deepseek-ai/dsh)

</div>

---

DSH+ 以 pnpm monorepo 形式维护一组 DSH 增强插件。每个插件都是独立的 ESM npm 包
（cordis 约定导出），全部发布在 npm 的 [`@dsh-plus`](https://www.npmjs.com/org/dsh-plus)
scope 下，可单独安装，也可经 `@dsh-plus/bundle-main` 聚合为一层有序的 cordis patch 统一装配。

## 插件一览

| 包 | 版本 | 类型 | 说明 | 文档 |
|---|---|---|---|---|
| [`@dsh-plus/ui-mobile-fit`](packages/ui-mobile-fit) | 0.1.3 | UI | 纯 CSS 覆盖的移动端窄屏响应式适配，不 fork 上游、跟随升级 | [docs](packages/ui-mobile-fit/docs/README.md) |
| [`@dsh-plus/remote-settings`](packages/remote-settings) | 0.1.0 | UI | 修复非 loopback 访问（loopback-rewrite 反代）下设置→模型目录报错与插件配置卡片不渲染 | [docs](packages/remote-settings/docs/README.md) |
| [`@dsh-plus/notify-email`](packages/notify-email) | 0.1.0 | service + UI | 任务完成 / 等待决策 / 出错停止时向指定邮箱发送邮件通知 | [docs](packages/notify-email/docs/README.md) |
| [`@dsh-plus/llm-pi`](packages/llm-pi) | 0.1.0 | service + UI | 基于 pi-ai 的自定义 LLM 路由：三协议 route、官方目录继承、全量 compat、models.dev 兜底 | [docs](packages/llm-pi/docs/README.md) |
| [`@dsh-plus/lifeboat`](packages/lifeboat) | 0.1.0 | service | 故障救生艇：兄弟插件崩溃自动隔离（写 patch 层禁用）+ LLM 应急翻译 + 邮件告警 | [docs](packages/lifeboat/docs/README.md) |
| [`@dsh-plus/reload`](packages/reload) | 0.1.0 | service + UI | 设置页「重新加载」按钮与 `/reload` 命令：两段确认+倒计时后重启 dsh-web，恢复后自动刷新 | [docs](packages/reload/docs/README.md) |
| [`@dsh-plus/usage-panel`](packages/usage-panel) | 0.1.0 | service + UI | 全量会话 token 用量面板：实时+历史扫描双通道聚合，按日/模型报表，可选价目估算费用 | [docs](packages/usage-panel/docs/README.md) |
| [`@dsh-plus/access-gate`](packages/access-gate) | 0.1.0 | service + UI | Web 访问围栏：本机直连放行；远程按白名单 IP（XFF 还原，v4/v6 CIDR）或令牌（登录页+cookie）放行，其余 403/登录页 | [docs](packages/access-gate/docs/README.md) |
| [`@dsh-plus/web-terminal`](packages/web-terminal) | 0.1.0 | service + UI | Web 终端工作台：多会话标签 + 桌面分屏（拖拽调宽）+ scrollback 回放，dsh 运行期间会话保活（类 tmux detach/attach） | [docs](packages/web-terminal/docs/README.md) |
| [`@dsh-plus/tool-text-transform`](packages/tool-text-transform) | 0.1.0 | tool | 纯函数演示工具（uppercase / lowercase / reverse / length），插件链路参考实现 | [docs](packages/tool-text-transform/docs/README.md) |
| [`@dsh-plus/bundle-main`](packages/bundle-main) | 0.1.0 | bundle | 聚合编排层：按序 insert 正式插件行，单插件脱离 bundle 亦可独立安装 | — |
| [`@dsh-plus/shared`](packages/shared) | 0.1.0 | library | 工作区共享纯函数库（非插件） | — |

## 快速开始

### 环境要求

- Node.js **≥ 22**（测试依赖 `node --test` 直接运行 TypeScript）
- pnpm（经 corepack 启用）
- 已安装 DSH（`@deepseek-ai/dsh`，基准版本 `0.1.2-alpha.1`）

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
  notify-email/         任务结束邮件通知
  llm-pi/               自定义 LLM 路由
  lifeboat/             故障救生艇（隔离/应急翻译/告警）
  reload/               设置按钮 + /reload 命令重启 dsh-web
  usage-panel/          用量统计面板（token 聚合/报表/费用估算）
  access-gate/          Web 访问围栏（白名单 IP / token）
  web-files/            Web 内嵌类 SFTP 文件浏览与编辑
  web-terminal/         Web 终端工作台（多会话/分屏/保活）
  tool-text-transform/  演示工具（dev-only，不进生产 bundle）
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

本机差异经环境变量配置（`DSHCTL_DSH_BIN` / `DSHCTL_TS_HOOK_REPO` /
`DSHCTL_TOKEN_FILES`），或写入 `scripts/dshctl/local_config.py`（不入库）。

## 许可证

[MIT](LICENSE) © 2026 agguy
