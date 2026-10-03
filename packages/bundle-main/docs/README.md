---
description: "@dsh-plus/bundle-main"
type: fact
last_modified: "2026-10-03 03:23"
---

# @dsh-plus/bundle-main

唯一编排层（非功能插件）：自身 `apply` 为空、不注册任何服务，全部价值在
[`cordis.patch.yml`](../cordis.patch.yml)——按序 `insert` 本仓【正式】插件的装配行与
默认 config，作为 profile `dsh.profile.bundles` 中的「一键引入」层。

## 契约

- **顺序即契约**：`lifeboat` 首位（须先于兄弟插件就绪才能观察其失败）、`access-gate`
  次之（在兄弟插件之前完成拦截包装）、`boot-retry` 第三（纯注入行、无时序依赖），
  其余按依赖需要排列。改动顺序要在本文件或 ADR 说明理由。
- **`dependencies` 与 patch 行双向一致**：patch 中出现的 `@dsh-plus/*` 必须在本包
  `dependencies` 声明，反之亦然（现状 21 条对齐）。新增正式插件由
  `dshctl new-plugin` 自动登记，不要只手改一侧。
- **不 import 任何插件**：装配经 patch 行完成，本包源码只依赖 cordis 类型。任何包
  import 本包都会被架构规则拦下（`biome.json` 的 `noRestrictedImports`）。
- **示例/演示插件不入此层**（如 `tool-text-transform`）：它们只经 dev profile 的用户
  补丁层注入，避免随 bundle 进入生产、无效占用模型上下文。
- **单插件独立性**：每个插件都必须能脱离本包独立安装（包间不互相 import，运行期联动
  只走 cordis 服务），本包只是便利层，不是依赖前提。
