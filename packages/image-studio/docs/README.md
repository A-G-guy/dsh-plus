---
last_modified: "2026-09-09 18:25"
---

# @dsh-plus/image-studio

图像工作室：OpenAI Images 协议文生图/图生图。官方全参数开关化（未启用参数
不进请求体，用上游默认值），双预设体系（提示词/参数/提供商），并发生图任务，
画廊持久化并支持从画廊二次编辑（衍生链）。service+ui 混合插件；本版本仅交付
后端与前端接口预留，不做前端设计。

## 能力总览

| 能力 | 说明 |
|---|---|
| 双端点 | generations（文生图）/ edits（图生图，≤16 输入图 + 可选 mask） |
| 全参数面 | 官方 Images API 全集（含 legacy 代际参数），逐参数开关 + 自定义值 |
| 中转兼容 | baseUrl/模型/key/附加头全可配（如 PackyAPI 填其地址即可）；推荐参数模板随提供商预设下发 |
| 并发任务 | FIFO 队列 + 可配置并发上限（0 = 不限），单任务超时/取消互不影响 |
| 画廊 | 元数据 JSONL + 图片落盘（url/b64 统一本地化，不受外链过期影响）；完整请求参数与提示词随条目保存 |
| 二次编辑 | 历史条目图片作为 edits 源图 + 历史参数回放，`sourceIds` 形成衍生链 |
| 双预设 | 提示词预设 / 参数预设 / 提供商预设（协议 + baseUrl + 模型 + 凭据引用） |

## 架构

- `src/params/catalog.ts` — 参数目录单一事实源（key/类型/取值/端点适用性/代际），
  前端表单与校验据此动态生成。
- `src/params/spec.ts` — `ParamSpec{enabled,value?}` 开关模型与归一化裁剪
  （enabled=false 不进请求；越界/未知边界拒绝）。
- `src/provider/` — 协议适配层：`types.ts` 协议无关模型、`registry.ts` 封闭注册表
  （新协议只增不改）、`openai-images.ts` 首批实现（请求构造纯函数 + node:http 执行）。
- `src/task/runner.ts` — 并发调度器（FIFO + 上限 + abort 语义），任务体注入可测。
- `src/gallery/store.ts` — `$DSH_HOME/dsh-plus/image-studio/gallery/`（index.jsonl +
  images/，原子写）。
- `src/service.ts` — 编排：预设解析 → 参数归一化 → 凭据即时 resolve → 任务执行 → 入库。
- `src/api.ts` — 同源 webServer 路由（见下表）。
- `src/client/` — 浏览器半空壳（占位组件 + 数据通道 + i18n key），接口见下文。

## 配置

settings 命名空间 `dsh-plus-image-studio`（`$DSH_HOME/settings.yaml` 热生效）：

- `promptPresets[]`：`{id, name, text}` 提示词模板。
- `paramPresets[]`：`{id, name, endpoint, paramSpecs}` 参数组合。
- `providerPresets[]`：`{id, name, protocol, baseUrl, model, credentialRef, extraHeaders}`。
- `maxConcurrent`（默认 3，0 = 不限）、`requestTimeoutMs`（默认 300000）、
  `proxy`（空 = 直连）、`galleryMaxItems`（默认 500，0 = 不清理）。

凭据走 dsh-credentials（引用名 `IMAGE_STUDIO_PRESET_<ID>`，每次请求即时 resolve，
UI 只 describe 不回传值）。

## HTTP 端点（`/dsh-plus/image-studio` 前缀）

| 路径 | 方法 | 说明 |
|---|---|---|
| `/generate` | POST | 提交任务，202 返回 `{taskId}` |
| `/tasks` | GET | 批量任务列表（最新在前） |
| `/tasks/<id>` | GET | 单任务状态/结果 |
| `/tasks/<id>/cancel` | POST | 取消（queued 直接取消；running 发 abort） |
| `/gallery` | GET | 画廊全量（元数据含完整参数与提示词） |
| `/gallery/<id>` | GET / DELETE | 单条详情（参数回放）/ 删除 |
| `/images/<imageId>` | GET | 图片流（`<img>` 直连） |
| `/credentials/<refName>` | GET / POST / DELETE | describe（不回传值）/ set / unset |
| `/providers` | GET | 协议 registry + 参数目录 |
| `/presets` | GET | 预设只读快照（读写走官方 settings RPC） |

## 前端接入点（预留接口清单，后续版本实施 UI 时直接消费）

### 包导出

- `@dsh-plus/image-studio/client` — 浏览器半入口（CJS factory bundle，已可构建加载）。
- `@dsh-plus/image-studio/src/client/api` — 全部数据通道函数（同源 fetch）：
  `generate / fetchTasks / fetchTask / cancelTask / fetchGallery / fetchGalleryItem /
  deleteGalleryItem / imageUrl / fetchCredentialStatus / setCredential / unsetCredential /
  fetchProviders / fetchPresets`。
- `@dsh-plus/image-studio/src/dto` — 全部 wire 类型（`GenerateRequest / TaskWire /
  GalleryItem / CredentialStatusWire / ProvidersWire / PresetsWire`），`import type` 消费。
- `@dsh-plus/image-studio/src/params/catalog` — 参数目录（`PARAM_CATALOG` /
  `paramKeysFor(endpoint)`），表单按 `kind/values/min/max/applies/advanced` 动态渲染。
- `@dsh-plus/image-studio/src/params/spec` — `ParamSpec` 类型与
  `validateParamSpecs`（提交前本地校验）。

### 插槽（client.ts 已声明，占位组件待替换）

| 插槽 | key/id | 用途 |
|---|---|---|
| `settings.section` | `dsh-plus-image-studio`，order 16 | 独立设置页（生图工作台 + 画廊，`StudioSection` 占位） |
| `settings.plugin.item` | key = `dsh-plus-image-studio` | 配置卡片（三组预设 + 凭据管理，`StudioConfigCard` 占位） |

### 配置读写

- 命名空间字面量：`@dsh-plus/image-studio/src/ns` 的 `SETTINGS_NS`。
- 读写经 `ctx.remote.settings` 直连（复用 `@dsh-plus/shared/client` 的
  `createSettingsScope` + `createNamespaceApi`，远程域名可用）。
- 预设 CRUD 直接改 settings 命名空间数组字段，无自定义端点；凭据走
  `/credentials` 端点。

### 浏览器半依赖

- `inject = ['slots', 'locale', 'remote', 'remote.settings']`；
  package.json `dsh.client.inject` 列包加载顺序（与 usage-panel 一致）。
- locale NS：`dsh-plus-image-studio`（`zh/en` 字典在 `src/client/i18n.ts`）。
- 样式注入沿用 `<style data-plugin data-plugin-css>` 约定（`src/client/styles.ts`）。

### 典型前端流（参考）

1. `fetchProviders()` → 渲染协议选择与参数表单（advanced 参数默认收起）。
2. `fetchPresets()` + settings scope → 提供商/参数/提示词预设下拉。
3. `generate({...})` → `fetchTask(id)` 轮询（1-2s 间隔）→ `galleryItemId`。
4. 画廊 `imageUrl(imageId)` 直显；「二次编辑」= 取条目 `imageIds` 作
   `sourceIds`、条目 `params` 回填表单后再次 `generate({endpoint:'edit', ...})`。
