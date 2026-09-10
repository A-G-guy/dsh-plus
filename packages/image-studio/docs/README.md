---
last_modified: "2026-09-10 19:45"
---

# @dsh-plus/image-studio

图像工作室：OpenAI Images 协议文生图/图生图。官方全参数开关化（未启用参数
不进请求体，用上游默认值），双预设体系（提示词/参数/提供商），并发生图任务，
画廊持久化并支持从画廊二次编辑（衍生链）。service+ui 混合插件：node 半承载
任务编排与画廊存储，浏览器半为侧栏 footer 入口 + overlay 工作台（文生图/
图生图/画廊三标签 + 任务条）+ settings.plugin.item 配置卡片。

## 能力总览

| 能力 | 说明 |
|---|---|
| 双端点 | generations（文生图）/ edits（图生图，≤16 输入图 + 可选 mask） |
| 源图双通道 | 画廊历史图片与本地上传文件混用（源图与遮罩均适用，遮罩上传限 PNG）；上传原图经魔数嗅探校验、暂存区落盘、孤儿按 TTL 回收 |
| 全参数面 | 官方 Images API 全集（含 legacy 代际参数），逐参数开关 + 自定义值；`size` 按官方规则校验并提供预设尺寸（自由输入不受限） |
| 中转兼容 | baseUrl/模型/key/附加头全可配（如 PackyAPI 填其地址即可）；推荐参数模板随提供商预设下发 |
| 并发任务 | FIFO 队列 + 可配置并发上限（0 = 不限），单任务超时/取消互不影响 |
| 画廊 | 元数据 JSONL + 图片落盘（url/b64 统一本地化，不受外链过期影响）；完整请求参数与提示词随条目保存 |
| 二次编辑 | 历史条目图片（含当时上传的源图）作为 edits 源图 + 历史参数回放，`sourceIds`/`sourceUploads` 形成衍生链 |
| 双预设 | 提示词预设 / 参数预设 / 提供商预设（协议 + baseUrl + 模型 + 凭据引用） |

## 架构

- `src/params/catalog.ts` — 参数目录单一事实源（key/类型/取值/端点适用性/代际），
  前端表单与校验据此动态生成。
- `src/params/spec.ts` — `ParamSpec{enabled,value?}` 开关模型与归一化裁剪
  （enabled=false 不进请求；越界/未知边界拒绝；目录声明的 `rules` 规则分派到实现）。
- `src/params/size.ts` — 尺寸规则与预设尺寸单一事实源（16 倍数 / 长边 ≤3840 /
  比例 ≤3:1 / 像素区间），宿主校验与前端即时提示共用。
- `src/images/` — 图片基础工具：`mime.ts` 魔数嗅探与扩展名互转、`id.ts` 标识形态白名单。
- `src/provider/` — 协议适配层：`types.ts` 协议无关模型、`registry.ts` 封闭注册表
  （新协议只增不改）、`openai-images.ts` 首批实现（请求构造纯函数 + node:http 执行）。
- `src/task/runner.ts` — 并发调度器（FIFO + 上限 + abort 语义），任务体注入可测。
- `src/gallery/store.ts` — `$DSH_HOME/dsh-plus/image-studio/gallery/`（index.jsonl +
  images/，原子写）。
- `src/uploads/store.ts` — 上传暂存区 `$DSH_HOME/dsh-plus/image-studio/uploads/`
  （index.jsonl + blobs/）；`pruneUploads` 保留被条目引用的、回收超 TTL 的孤儿。
- `src/service.ts` — 编排：预设解析 → 参数归一化 → 凭据即时 resolve → 任务执行 → 入库。
- `src/api.ts` — 同源 webServer 路由（见下表）。
- `src/client/` — 浏览器半：`client.ts` 入口（sidebar.footer.action 入口按钮 +
  shell.overlay 工作台 + settings.plugin.item 配置卡片）；`panel/` 面板组件
  （panel 根、generator 双端点表单、params-form 目录驱动参数面、picker 源图
  选择（画廊/本地上传两分区）、uploads 上传 hook 与触发按钮、gallery 画廊与
  详情、tasks 任务条、controller 开合与二次编辑种子、param-state 表单态
  ⇄ParamSpecMap 纯函数）；`card.tsx` 三组预设与凭据管理；
  `api.ts` 数据通道、`i18n.ts` zh/en 字典、`styles.ts` 全量样式（767px 断点）。

## 配置

settings 命名空间 `dsh-plus-image-studio`（`$DSH_HOME/settings.yaml` 热生效）：

- `promptPresets[]`：`{id, name, text}` 提示词模板。
- `paramPresets[]`：`{id, name, endpoint, paramSpecs}` 参数组合。
- `providerPresets[]`：`{id, name, protocol, baseUrl, model, credentialRef, extraHeaders}`。
- `maxConcurrent`（默认 3，0 = 不限）、`requestTimeoutMs`（默认 300000）、
  `proxy`（空 = 直连）、`galleryMaxItems`（默认 500，0 = 不清理）、
  `uploadTtlHours`（默认 24；上传原图未被任何条目引用时的保留时长）。

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
| `/images/<imageId>` | GET | 画廊图片流（`<img>` 直连） |
| `/uploads?name=<文件名>` | POST | 上传原图（raw body 流，≤50MB，魔数嗅探校验），201 返回条目 |
| `/uploads` | GET | 上传暂存区列表 |
| `/uploads/<uploadId>` | GET | 上传原图流（缩略图直连） |
| `/credentials/<refName>` | GET / POST / DELETE | describe（不回传值）/ set / unset |
| `/providers` | GET | 协议 registry + 参数目录 |
| `/presets` | GET | 预设只读快照（读写走官方 settings RPC） |

## 前端界面

- **入口**：左侧栏底部 `sidebar.footer.action`（与文件/终端入口 flex 等分行宽，
  rail 折叠态退化为圆形图标），点击打开 overlay 工作台。
- **工作台**（`shell.overlay`）：文生图 / 图生图 / 画廊三标签；两个生图表单
  常驻挂载（hidden 切换保留表单态）；底部任务条 2s 轮询（活跃可取消，完成
  一键跳画廊详情，侦测成功自动刷画廊）。
  - 生图表单：提供商预设 + 凭据状态徽标 + inline 覆盖（协议/地址/模型，凭据
    沿用预设）；提示词编辑 + 预设插入/另存；目录驱动参数表单（kind 决定控件，
    advanced 默认收起，代际标记；`size` 附预设尺寸快捷项与即时校验提示）；
    图生图追加源图（≤16，画廊多选 + 本地上传，可混用）与可选遮罩
    （单选，同样支持画廊取图或本地上传，上传限 PNG）。
  - 画廊：缩略网格 + 详情模态（多图、改写提示词、请求参数回放、源图衍生链、
    逐图下载、两段确认删除）；「二次编辑」回填图生图表单并切标签。
- **配置卡片**（设置 → 插件）：提供商预设（含逐条 API Key 设置/删除/状态徽标，
  值永不回显）、提示词预设、参数预设（JSON + validateParamSpecs 本地校验）、
  高级项（并发/超时/代理/画廊上限）；staged draft + revision fencing。
- 响应式断点 767px（移动端面板全屏、表单单列、画廊两列、44px 热区）。

## 前端接入点（组件实现直接消费）

### 包导出

- `@dsh-plus/image-studio/client` — 浏览器半入口（CJS factory bundle，已可构建加载）。
- `@dsh-plus/image-studio/src/client/api` — 全部数据通道函数（同源 fetch）：
  `generate / fetchTasks / fetchTask / cancelTask / fetchGallery / fetchGalleryItem /
  deleteGalleryItem / imageUrl / uploadImage / fetchUploads / uploadImageUrl /
  fetchCredentialStatus / setCredential / unsetCredential / fetchProviders / fetchPresets`。
- `@dsh-plus/image-studio/src/dto` — 全部 wire 类型（`GenerateRequest / SourceRef /
  UploadEntry / TaskWire / GalleryItem / CredentialStatusWire / ProvidersWire /
  PresetsWire`），`import type` 消费。
- `@dsh-plus/image-studio/src/params/catalog` — 参数目录（`PARAM_CATALOG` /
  `paramKeysFor(endpoint)`），表单按 `kind/values/min/max/applies/advanced` 动态渲染。
- `@dsh-plus/image-studio/src/params/spec` — `ParamSpec` 类型与
  `validateParamSpecs`（提交前本地校验）。
- `@dsh-plus/image-studio/src/params/size` — `checkImageSize` / `SIZE_PRESETS`
  （尺寸即时提示与快捷选择项）。

### 插槽（client.ts 已注册）

| 插槽 | key/id | 用途 |
|---|---|---|
| `sidebar.footer.action` | `image-studio-entry` | 侧栏底部入口按钮（`StudioEntryButton`） |
| `shell.overlay` | `image-studio-panel` | 工作台面板（`StudioPanel`） |
| `settings.plugin.item` | key = `dsh-plus-image-studio` | 配置卡片（`StudioConfigCard`） |

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
   `sources`（`item.imageIds` → kind=gallery，`item.sourceUploads` → kind=upload）、
   条目 `params` 回填表单后再次 `generate({endpoint:'edit', ...})`。
