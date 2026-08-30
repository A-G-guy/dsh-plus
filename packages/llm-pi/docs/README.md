---
last_modified: "2026-08-30 21:50"
---

# @dsh-plus/llm-pi 文档索引

自定义 LLM 路由插件：在官方 `llm-pi-ai` 之外，以**自动跟随 dsh 上游**的方式提供
pi-ai 全量能力——三协议自定义 route、官方内置 provider/model 继承 + 字段级覆盖、
全量 compat（**compat 门控与官方 0.1.2-alpha.1 的 COMPAT_GATES 逐字段对齐，未知键
/withhold 字段写时拒绝**）、models.dev 目录兜底。
另支持 `adapter: deepseek` 路由：直接复用官方 `DeepSeekAdapter`（视觉模型图片走
Files API 文件通道、失败自动降级 base64），模型继承官方内置目录而非 pi-ai 目录。
配置 UI 位于 webui「设置 → 插件 → 插件配置」，持久化到 `$DSH_HOME/settings.yaml`
（namespace `dsh-plus-llm-pi`）并热生效。

## 与官方 llm-pi-ai 的关系

- **不替换、不劫持**：官方插件照常运行；本插件注册自己的 route，重名 route 触发
  `DUPLICATE_ADAPTER` 并保留旧注册。
- **自动跟随上游**：node 半通过 `process.argv[1]` 真实路径向上定位 dsh 安装树，
  动态 import 树内的 `@deepseek-ai/dsh-llm-pi-ai` / `@earendil-works/pi-ai`——
  与 dsh 本体共享同一模块实例，dsh 升级即自动获得新版 pi-ai 的逐模型代码级适配
  （`resolve-dsh.ts`，套件形状自检 + 诊断日志）。仅在找不到 dsh 树时退化到
  依赖里精确钉住的 vendored 副本（此时跨副本 `instanceof` 会让 `LlmError` 归类
  退化为 UNKNOWN，功能不受影响）。
- **继承而非复制**：`PiAiAdapter` 构造 seam（`profiles` / `resolveApiKey` /
  `resolveAttachments` / **`auth`（0.1.2-alpha.1 必需）** / `resolveImageAccess` /
  `onReplayDegrade` 回调）是官方给出的插件自有解析钩子；schema 校验完全在
  adapter 之外，本插件自行实现配置层。
- **src 子路径双轨（0.1.2-alpha.1 新增面）**：`resolveProfiles` 与认证助手
  （`credentialStoreFrom`/`authContextFrom`）仅从官方 `src/config.ts`/`src/auth.ts`
  子路径导出，npm 发布形态不携带 src/——dsh 树 dev 布局（源码仓库）时经
  src 子路径复用官方实现；npm 布局与 vendored 兜底时走插件等价实现
  （profile 解析语义逐行对齐官方 resolveProfiles，compat 门控表逐字段镜像官方
  catalog.ts COMPAT_GATES；认证助手为官方 auth.ts 等价移植，recordKeyFor 同源
  注入），并经 assertKitShape 自检兜底。

## adapter: deepseek 路由（文件通道）

provider 条目设 `adapter: deepseek` 后，该 route 由官方 `DeepSeekAdapter`
（`@deepseek-ai/dsh-llm-deepseek`，同树同实例）服务，而不是 PiAiAdapter：

- **文件通道免费获得**：视觉模型的图片输入先经 Files API 上传为 file_id 引用
  （配额清理、过期刷新、`file_id` 被拒后失效重传），上传失败自动降级 base64 内联——
  全套策略在官方适配器内部，本插件只喂配置。
- **继承官方内置目录**：模型条目只写 `id` 即继承同名官方模型的模态/像素预算等
  能力（如 `deepseek-v4-flash-vision-exp` 自动获得 image 模态）；route 级
  `extends: deepseek` 全量继承官方目录，模型级 `extends: 'deepseek/<id>'` 可起别名。
  官方目录取自 `resolveAdapterOptions({}, undefined)`，随 dsh 树升级自动更新。
  `imageDetail` 已随 0.1.2-alpha.1 移除（官方 llm-deepseek 对含该字段的目录模型
  直接抛错）——旧配置含 `imageDetail` 时**写时拒绝**并提示改用
  `imagePixelBudget`/`imageMaxBytes`。
- **与官方 `deepseek-official` 渠道隔离**：路由名独立；文件索引作用域为
  sha256(baseURL + apiKey)（官方实现），中转与官方分池互不串扰；实例/重试策略独立。
- **配置子集**：共享字段（`displayName`/`baseURL`/`apiKeyEnv`/`defaultContextWindow`/
  `defaultMaxTokens`/`streamIdleTimeoutMs`/`retryPolicy`/`models`）语义不变；
  deepseek 专有字段 `thinking`/`reasoningEffort`/文件与图片限额组
  （`maxRequestFilesBytes`/`maxInlineRequestImageBytes`/`maxImagesPerRequest` 及三个
  offload quantum）/`filesApiTimeoutMs`/`fileExpiresAfterSeconds`/`fileRefreshMarginSeconds`
  原样透传官方 `resolveAdapterOptions` 校验；pi 专有字段（`api`/`compat`/`headers`/
  `transport`/`reasoning` 等）在 deepseek 路由上**写时拒绝**（防误以为生效）。
  `apiKeyEnv` 必填（DeepSeekAdapter 无环境自发现）；`baseURL` 必填，除非
  `extends: deepseek`（继承官方端点）。
- **运行时依赖**：0.1.2-alpha.1 基线（树内含 `dsh-llm-deepseek`）；旧版 dsh 树下
  deepseek 路由在写入/启动时以明确错误拒绝，pi 路由不受影响（kit 诊断有日志）。
- 配置卡片暂未提供 deepseek 专有字段的编辑控件，但未知字段会**原样往返保留**
  （卡片编辑不会丢 `adapter` 等手写字段）；deepseek 路由建议直接编辑 settings.yaml。

## 配置项（settings namespace `dsh-plus-llm-pi`）

### 全局

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `enabled` | boolean | true | 总开关（关闭则不注册任何 route；配置写错导致启动失败的逃生门） |
| `catalogUrl` | string | models.dev | models.dev 目录数据端点 |
| `catalogRefreshHours` | number | 0 | 自动拉取间隔小时数；0 = **不自动拉取**（可手动拉取或读已有缓存） |
| `catalogProxy` | string | '' | 拉取目录时的 HTTP 代理地址（如 `http://127.0.0.1:7890`）；留空直连。仅 https 目标走代理 |
| `providers` | dict | {} | 键 = route 名（即 provider id），值见下表 |

### provider（route）级

| 字段 | 说明 |
|---|---|
| `extends` | 继承某个官方内置 provider：端点/整目录模型/协议缺省值 |
| `displayName` / `api` / `baseURL` / `apiKeyEnv` / `headers` | 同官方语义；`apiKeyEnv` 是凭据引用名（凭据服务优先，环境变量兜底） |
| `compat` | route 级全量 compat（按 `api` 分型校验，未知键**写时拒绝**） |
| `defaultContextWindow` / `defaultMaxTokens` / `defaultInput` | 模型与继承源都未标注时的兜底 |
| `reasoning` / `thinkingBudgets` / `cacheRetention` / `transport` | 同官方语义 |
| `timeoutMs` / `websocketConnectTimeoutMs` / `streamIdleTimeoutMs` / `retryPolicy` | 同官方语义 |
| `maxRequestImageBytes` | 单请求 base64 图片载荷上限（字节）；缺省 20MiB（0.1.2-alpha.1 起官方必需字段，旧配置免改自动生效） |
| `requestImagePixelBudget` / `requestImageMaxBytes` | 单请求每个确定性内联图片版本的像素总预算 / 编码字节目标；缺省官方同值（2048² / 1MiB） |
| `models` | 模型条目数组；**缺省且 provider 有 extends 时继承该源全部模型**；两者皆无即"草稿路由"——不注册进 adapter（无模型可服务），但仍出现在可配置 provider 目录里，便于先占位后补模型 |

### 模型级

| 字段 | 说明 |
|---|---|
| `id` | 必填 |
| `extends` | `"provider/model"` 精确引用，或裸 model id（随 route 级 extends 源查找） |
| `name` / `contextWindow` / `maxTokens` / `input` | 字段级覆盖继承值 |
| `reasoningEfforts` | `false` 或 档位→线值映射（键集合 off/minimal/low/medium/high/xhigh/max；未声明档位置 null）；覆盖继承的 thinkingLevelMap |
| `compat` | 模型级 compat，按字段压过 route 级与继承值 |

## 继承语义

模型解析按三级查找基座：**官方内置目录 → models.dev 快照 → 无基座（手写条目）**。

1. 显式 `extends` 引用在两级都找不到时**写时拒绝**（报出引用名），静默退化不存在。
2. 缺省 `extends` 且 route 有 extends 源：按同名模型继承；查不到则为手写条目。
3. 手写条目必须经 route 级字段（或继承源）获得 `api`/`baseURL`，否则写时拒绝。
4. 同一 route 内所有模型协议必须一致（单协议 route 不变量，与官方一致）；
   端点同样收敛为 route 级单一值（官方 schema 无模型级 baseUrl，模型间端点
   不一致写时拒绝）。
5. models.dev 来源的基座**只采信** `name`/`limit.context`/`limit.output`/`reasoning`，
   模态与 compat 不采信（防过度声明，对齐官方注释口径），缺省 text-only。
6. 自建条目的链式继承（extends 指向本插件另一条目）不支持——基座只来自两个目录源。

compat 合并顺序：继承值（同协议才继承）→ route 级 → 模型级，逐字段后者胜出。
字段门控以官方 0.1.2-alpha.1 catalog.ts COMPAT_GATES 为唯一事实源（completions
17 / responses 3 / anthropic 7 个 offer 字段；`openRouterRouting`/`zaiToolStream`/
`supportsToolSearch`/`sendSessionAffinityHeaders`/`supportsToolReferences` 等
catalog 已内置厂商设置的字段官方 withhold——**写时拒绝**并提示以目录 provider 名
为 route，不再静默丢弃；见 `src/compat.ts`）。

## 运行机制

- `startRuntime`：解析套件 → `ModelsDevSource`（**默认不自动拉取**；`catalogRefreshHours>0`
  时按 TTL 后台刷新；配置卡片「手动拉取」或 `POST /catalog/refresh` 立即拉取，可配
  `catalogProxy` 代理；缓存 `storages/dsh-plus-llm-pi/models-dev.json`，原子写）→
  profiles 按原始 config 对象 identity 备忘 → `PiAiAdapter`（快照随 profiles
  identity 失效）→ `registerAdapter` + `registerModelDiscovery` +
  `registerConfigurableProviders`（官方 Models 页/拉取模型动作可见）。
- 热更新走 `installSettingsSection`：配置变更下一请求生效；route 集或
  displayName/retryPolicy 变化 → `handle.replace` 原子重注册；
  **写入被校验拒绝时保留旧注册**（官方同款护栏）。
- **运行期宽松解析（lenient）**：`profiles()` 走宽松模式——已写入的 extends 引用
  因数据源漂移（models.dev 刷新删模型/内置目录随 dsh 升级变化）失效时，
  降级为手写条目并告警（缺 api/baseURL 时跳过该模型，route 全空则跳过注册），
  不再抛错弄挂整个 route；写时校验（settings 写入）保持严格，非法引用在写入处拒绝。
- **注册冲突降级**：整批 `registerAdapter` 遇 `DUPLICATE_ADAPTER`（route 名与其他
  adapter 冲突）时降级为逐个 route 注册，跳过冲突者并告警——启动不再 fail-loud；
  热更新原子 replace 被拒时保留旧注册。可配置 provider 目录同理：官方目录注册
  是原子语义（任一条目撞既有声明整批不落盘），撞名（如 route 叫 `anthropic`
  撞上官方内置目录条目）时逐个剔除冲突条目重试并告警，其余条目照常生效。
- 配置读写走官方 remote.settings 直连（浏览器半 `createSettingsScope` /
  `createNamespaceApi`，0.1.2-alpha.1 起 `connection.api.settings` 已移除；
  不复用 settingsScope 服务——非 loopback 页面固定 memory 模式无数据），
  保存为 `settings.update` 深合并（providers dict 全量替换语义）；写入经既有
  settings validate 钩子（assertServiceable）把关。自定义端点仅剩模型目录：
  `GET /dsh-plus/llm-pi/catalog?provider=&source=builtin|models-dev`
  （响应附带 `kitSource` 与 models-dev 快照状态，供卡片状态行）、
  `POST /dsh-plus/llm-pi/catalog/refresh`（手动拉取）。

## 边界与风险

- **启动期 fail-loud 的爆炸半径**：cordis loader 条目的 apply 失败会导致整个
  profile 启动失败（与官方 llm-pi-ai 行为一致）。settings 用户层有校验护栏，
  仅组合基座（patch 行 config）配置错误才会触发；此时设 `enabled: false`
  或直接禁用条目即可恢复启动。
- `registerConfigurableProviders([])` 会抛 `INVALID_DIRECTORY`：空目录不注册，
  待 settings 用户层供数后自动补注册。
- 迁移 route 名后，旧会话绑定旧 route 名，不能在新 route 上继续（dsh 原生语义）。
- schemastery 陷阱（已踩过）：array 字段缺省物化为 `[]`（`defaultInput` 必须给
  schema 默认值）；settings 层 deepFreeze 的解析值不能再过带键约束 dict 的 schema
  二次校验——`setSource` 收到的是 thunk，保存引用而非立即求值包装。
- schemastery 物化噪声（已踩过）：**dict 字段无 default 也会物化为 `{}`**
  （`compat`/`headers`/`thinkingBudgets`），`defaultInput` 物化为 `['text']`、
  模型 `input` 物化为 `[]`。凡"用户是否配置了该字段"的判定（如 adapter: deepseek
  对 pi 专有字段的写时拒绝）必须按语义判空——空 dict/物化默认值视为未配置，
  否则 settings 投递路径（解析值过 validate 钩子）会把合法配置误判拒绝，
  fiber 在启动期 FAILED（lifeboat 会隔离插件）；单测若只喂原始对象则覆盖不到，
  须先过 `Config['~standard'].validate` 再构建（见 tests/profiles-deepseek.test.ts）。

## 开发

```bash
corepack pnpm --filter @dsh-plus/llm-pi build   # node 半 ESM + 浏览器半 CJS
node --test packages/llm-pi/tests/*.test.ts        # 单测（vendored 套件，零网络）
```

联调建议：用独立 `DSH_HOME` 起一个 dev 实例，模型后端指向本机 mock（OpenAI 兼容
假后端），避免产生真实 API 费用。
