---
last_modified: "2026-10-07 00:39"
description: "@dsh-plus/llm-pi 文档索引"
type: fact
---

# @dsh-plus/llm-pi 文档索引

自定义 LLM 路由插件：在官方 `llm-pi-ai` 之外，以**自动跟随已装 dsh** 的方式提供
pi-ai 全量能力——自定义 route（协议集合现场推导）、pi-ai 内置 provider/model 继承
+ 字段级覆盖、全量 compat（**门控表与取值约束从官方安装副本现场推导**，未知键
/withhold 字段写时拒绝）、**内置模型目录浏览器**（模糊搜索/筛选/复制路径 id/
一键 extend）。
另支持 `adapter: deepseek` 路由：直接复用官方 `DeepSeekAdapter`（视觉模型图片走
Files API 文件通道、失败自动降级 base64），模型继承官方内置目录而非 pi-ai 目录。
配置 UI 位于侧边栏「插件」页本行的「配置」页（`plugins.row.config` /
`plugins.bundle.config`），持久化到 settings（namespace `dsh-plus-llm-pi`）并热生效。

## 模型目录：唯一来源是 pi-ai 内置目录

- **没有第二份目录**：继承解析只有一级——**pi-ai 内置目录命中 → 否则手写条目**，
  不存在 models.dev 兜底源与 `catalogUrl` / `catalogRefreshHours` / `catalogProxy`
  根字段、目录缓存文件与 `/catalog/refresh` 端点，消除"测试跑的和生产跑的不是同一份
  目录"这一类问题（变更决策见
  [ADR 0007](../../../docs/repo/adr/0007-llm-pi目录唯一来源与动态面现场推导.md)）。
- **自带诊断而非沉默**：显式 `extends` 引用不存在时**写时拒绝**并报出引用名与当前
  生效 pi-ai 版本；route 级 `extends` 不是内置 provider 时同样写时拒绝（列出可用
  provider）。运行期（lenient）遇到目录漂移只降级/跳过并告警，不弄挂 route。
- **迁移**：旧配置若用 models.dev 独有 provider 名做继承源，会在写入时被拒（提示
  可用 provider 列表），按提示改为内置 provider 即可；残留的 `catalogUrl` 等键不再
  被 schema 声明（解析层透传但不消费），从配置卡片保存一次即不再写出。

## 自动跟随：动态面全部现场推导

插件不认识"某个 pi-ai 版本"，只认识形状与推导结果。四类事实都取自**正在运行的那份
官方副本**（dsh 树优先，vendored 副本兜底），官方升级即自动生效：

| 事实 | 来源 | 推导失败时 |
|---|---|---|
| 线协议集合 | 官方包根 `supportedProtocols()`；协议实现按 `pi-ai/dist/api/<api>.lazy.js`（api id 即模块名）动态加载 | 回退内置三元组；单个协议加载失败只跳过该协议并记诊断 |
| compat 门控 | 官方 bundle 文本的 `COMPAT_GATES`（运行期事实源） | 回退内置快照，**且未知键放行**（交官方自身校验），只拦快照中明确 withhold 的键 |
| compat 取值约束 | 官方 `Config` schema 的 `providers.*.compat` 节点 | 跳过该字段的值校验（宁可放行不误拒） |
| 模型条目字段集 | 官方 `Config` schema 的 `providers.*.models` 键集 | 回退已知七键（`id/name/contextWindow/maxTokens/input/reasoningEfforts/compat`） |

- **继承透传**：`ModelBase.extra` 按上面的字段集把 pi-ai 目录给出的同名字段带进条目
  （官方将来新增模型级字段即自动继承）；目录里出现而官方 schema 不接受的字段
  （`cost` / `inputLimits` / `headers`）仍进浏览器的参数明细，但不参与继承。
- **`api` 不在 schema 里钉死枚举**：合法集合运行期推导，非法协议在写时以
  "本插件无法服务（当前生效 pi-ai X 支持的协议：…）"拒绝。
- **版本显示与提示**：配置卡片状态行显示生效的 `pi-ai` / `dsh-llm-pi-ai` / `dsh`
  版本、安装树路径、目录规模与数据生成时间、协议/compat 来源与全部降级诊断。
  生效 pi-ai 超出 `VERIFIED_PI_AI_RANGE`（当前 `>=0.85.1 <0.88.0`）**只提示不阻断**
  ——能不能用由运行期形状自检与逐项降级决定；peer 范围也写成 `>=0.85.1`（无上界），
  不因版本号把插件挡在新版 dsh 之外。

## 内置模型目录浏览器（配置页）

配置页自上而下：根字段（开关 + 运行期状态）→「内置模型目录」（默认收起）→
Provider 路由列表（每 route 收起，route 内模型行同样默认收起）。
「内置模型目录」提供：

- **模糊搜索**：多词 AND；分级 = 相等 > 前缀 > 词首前缀 > 子串 > 归一化 > 首字母
  缩写（缩写要求首字符落在词首、命中跨度有上限，避免长路径乱命中），同分优先更短
  的路径；
- **筛选**：供应商、协议、能力（推理 / 图片输入）、"仅本插件可服务"（默认开，
  并显示被隐藏的协议不受支持条数）；分页每页 30 条，"加载更多"追加；
- **参数明细**：请求 id、显示名、上下文长度、输出上限、模态、请求协议、compat、
  思考档位、`cost`/`inputLimits` 等其余目录字段（官方新增字段自动出现）、baseUrl；
- **复制路径 id**：一键复制 `deepseek/deepseek-flash` 形式（非安全上下文回落
  `execCommand`）；
- **一键添加到 route**：写入 `{ id, extends: 'provider/model' }`（**不预填** 显示名/
  容量——继承才能跟随目录升级），并自动展开目标 route。添加前三类必然失败的加法
  会被拦下并给出原因：协议不受支持、目标 route 已有同 id、与目标 route 协议不一致
  （含目标 route 已混用协议）；目标候选只列 `adapter: pi` 的 route。

## 与官方 llm-pi-ai 的关系

- **不替换、不劫持**：官方插件照常运行；本插件注册自己的 route，重名 route 触发
  `DUPLICATE_ADAPTER` 并保留旧注册。
- **自动跟随上游**：node 半通过 `process.argv[1]` / `installAnchor` 真实路径向上
  定位 dsh 安装树，动态 import 树内的 `@deepseek-ai/dsh-llm-pi-ai` /
  `@earendil-works/pi-ai`——与 dsh 本体共享同一模块实例（`resolve-dsh.ts`，
  套件形状自检 + 诊断日志）。仅在找不到 dsh 树时退到 devDependencies 里的副本
  （此时跨副本 `instanceof` 会让 `LlmError` 归类退化为 UNKNOWN，功能不受影响）。
- **官方 Models 页已有"拉取可用模型 + 搜索"**（需 route 先配 `extends`）：与本插件
  的目录浏览器重叠但不等价（后者可跨供应商浏览、看 compat/协议等参数、复制路径 id），
  故两者并存；本插件不重复实现其表单。
- **继承而非复制**：`PiAiAdapter` 构造 seam（`profiles` / `resolveApiKey` /
  `resolveAttachments` / `auth` / `resolveImageAccess` / `onReplayDegrade`）是官方
  给出的插件自有解析钩子；schema 校验完全在 adapter 之外，本插件自行实现配置层。
- **src 子路径双轨**：`resolveProfiles` 与认证助手仅从官方 `src/config.ts`/`src/auth.ts`
  子路径导出，npm 发布形态不携带 src/——dev 布局时经 src 子路径复用官方实现，
  其余形态走插件等价实现（profile 解析语义逐行对齐官方 resolveProfiles，compat
  门控以官方现场表为准；认证助手为官方 auth.ts 等价移植），并经形状自检兜底。

## 官方应急副本（应急能力）

常备一份**官方可识别**的应急配置副本，llm-pi 缺席/故障时用 dsh 原生方式即可
恢复 LLM 能力；lifeboat 面板只读展示其状态并给出应用指引告警。

- **文件契约**：`$DSH_HOME/llm-pi.official-patch.yaml`（`src/official-copy.ts` 的
  `OFFICIAL_COPY_PATH`，`src/official-copy-writer.ts` 生成）。头注释即使用说明
  （两种应用方式、回退方法、生成警告；mtime 即生成时间），正文为 profile patch
  行：`- id: dsh-plus-llm-pi, disabled: true` + `- id: llm-pi-ai, config.providers`。
- **生成时机**：插件启动、配置热更新（`loader/volatile-update`）、
  `llm/adapters-updated`（官方 llm-pi-ai 晚注册时补入手写条目）。内容未变跳过
  写盘（备忘 + 存在性自愈）；原子落盘，写失败只降级为状态与日志，不影响路由注册。
- **翻译规则**（`buildOfficialCopy`，纯函数）：
  - route 字段白名单现场取自官方 `Config` schema（布局不可识别时回退内置键集并
    告警），模型条目字段取 `kit.officialModelFields`；
  - 模型条目来自 normalizeRoute 的全物化产物（官方 schema 无 `extends`），compat
    只保留当前协议 offer 的键（withhold/未知键丢弃——目录继承值可能携带）；
  - `adapter: deepseek` 路由改写为 `api: openai-completions`（中继网关本就是
    OpenAI 兼容面），连接事实取官方 `resolveAdapterOptions` 的校验产物；文件通道
    与思考配置无对应字段**不迁移**，逐项写进头注释警告（绝不静默丢弃）；
  - 官方 `llm-pi-ai` 现有 providers 经 `settings.describe()` 生效视图合并
    （profile patch 行 + settings 用户层，schema 已解析），同名 key 手写条目优先。
- **逐 route 官方校验**：官方 `Config` 解析 + 官方 `resolveProfiles` 可服务性链，
  任一不过即从副本剔除并记警告——**写不进官方的配置绝不落盘**（旧「出错时自动
  改写配置」不稳定、常无效，根因即在此前无此校验；该实现已由 lifeboat 移除）。
- **应用与回退**：`dsh <profile> --patch <副本路径>`（单次启动）或把行并入该
  profile 的 `cordis.patch.yml`（web 热应用）；应用即切换（禁用本插件、整行替换
  llm-pi-ai config），回退只需移除 `--patch` 参数或并入的条目。
- **边界**：零 route 时渲染空补丁 `[]`（不产出「只禁用不供给」的误导副本）；
  多 profile 写同一路径，后写者覆盖；副本头注释警告同步进配置卡「诊断」与状态行。

## adapter: deepseek 路由（文件通道）

provider 条目设 `adapter: deepseek` 后，该 route 由官方 `DeepSeekAdapter`
（`@deepseek-ai/dsh-llm-deepseek`，同树同实例）服务，而不是 PiAiAdapter：

- **继承官方 deepseek 目录**：模型条目只写 `id` 即继承同名官方模型的模态/像素预算等
  能力（如 `deepseek-flash` 自动获得 image 模态 + `imageMaxBytes`）；route 级
  `extends: deepseek` 全量继承官方目录，模型级 `extends: 'deepseek/<id>'` 可起别名。
  官方目录取自 `resolveAdapterOptions({}, undefined)`，随 dsh 树升级自动更新。
  注意**官方目录的模型代号会变**：写死的旧代号未命中官方目录时按"手写条目"处理
  （不报错，但拿不到继承能力）；显式 `extends: 'deepseek/<未知代号>'` 则**写入即拒绝**。
- **接线**：认证头经 `resolveAuth` 一次性给出（同官方 `llm-deepseek-api-key` 给
  `x-api-key`）；模型发现经 `discoverModels`（官方缺省即空目录），本插件从当前物化
  `connection.models` 经同树 `catalogModelInfo` 映射，否则模型选择器对该 route 无项。
  套件形状自检（`checkDeepseekShape`）因此要求 `catalogModelInfo`，缺项即判定
  deepseek route 不可用。
- **文件通道免费获得**：视觉模型的图片输入先经 Files API 上传为 file_id 引用
  （配额清理、过期刷新、`file_id` 被拒后失效重传），上传失败自动降级 base64 内联——
  全套策略在官方适配器内部，本插件只喂配置。
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
- 配置卡片的 deepseek 专有字段：表单未逐项渲染的 wire 字段（`adapter`/`thinking`/
  `reasoningEffort`、文件与图片限额组、三个 offload quantum、
  `filesApiTimeoutMs`/`fileExpiresAfterSeconds`/`fileRefreshMarginSeconds`，以及模型级
  `imagePixelBudget`/`imageMaxBytes`）经 route/模型「高级设置」里的
  **其余字段（JSON）**编辑器整体编辑——草稿的 `extra` 原样往返，表单已渲染的字段优先。
  去掉卡片里的未知字段也不会丢：留空即清空该 route 的 extra。
  非法 JSON 不提交；合法但非对象（数组/标量）的输入被忽略，避免静默清空已配置字段。

## 配置项（settings namespace `dsh-plus-llm-pi`）

### 全局

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `enabled` | boolean | true | 总开关（关闭则不注册任何 route；配置写错导致启动失败的逃生门） |
| `providers` | dict | {} | 键 = route 名（即 provider id），值见下表 |

### provider（route）级

| 字段 | 说明 |
|---|---|
| `adapter` | `pi`（默认）/ `deepseek`；deepseek 路由不适用 pi-ai 继承，也不出现在目录浏览器的添加目标里 |
| `extends` | 继承某个 **pi-ai 内置 provider**：端点/整目录模型/协议缺省值（非法值写时拒绝） |
| `displayName` / `api` / `baseURL` / `apiKeyEnv` / `headers` | 同官方语义；`api` 合法集合运行期推导；`apiKeyEnv` 是凭据引用名（凭据服务优先，环境变量兜底） |
| `compat` | route 级全量 compat（按 `api` 分型校验，未知键**写时拒绝**） |
| `defaultContextWindow` / `defaultMaxTokens` / `defaultInput` | 模型与继承源都未标注时的兜底 |
| `reasoning` / `thinkingBudgets` / `cacheRetention` / `transport` | 同官方语义 |
| `timeoutMs` / `websocketConnectTimeoutMs` / `streamIdleTimeoutMs` / `retryPolicy` | 同官方语义 |
| `maxRequestImageBytes` | 单请求 base64 图片载荷上限（字节）；缺省 20MiB（官方必需字段，缺省时由本插件的默认值补齐） |
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

模型解析只有一级查找：**pi-ai 内置目录 → 无基座（手写条目）**。

1. 显式 `extends` 引用未命中时**写时拒绝**（报出引用名与生效 pi-ai 版本），静默退化不存在；
2. 缺省 `extends` 且 route 有 extends 源：按同名模型继承；查不到则为手写条目；
3. 手写条目必须经 route 级字段（或继承源）获得 `api`/`baseURL`，否则写时拒绝；
4. 同一 route 内所有模型协议必须一致（单协议 route 不变量，与官方一致）；
   端点同样收敛为 route 级单一值（官方 schema 无模型级 baseUrl，模型间端点
   不一致写时拒绝）；
5. 自建条目的链式继承（extends 指向本插件另一条目）不支持——基座只来自 pi-ai 目录；
6. 继承来的其余官方可接受字段（字段集现场推导）随 `ModelBase.extra` 一并落进条目，
   用户显式字段最终覆盖。

compat 合并顺序：继承值（同协议才继承）→ route 级 → 模型级，逐字段后者胜出。
字段门控以官方 `dsh-llm-pi-ai` 的 COMPAT_GATES 为唯一事实源，且**从官方安装副本
现场推导而非手抄**（`src/official-surface.ts`）。当前门控：completions 19 /
responses 4 / anthropic 7 个 offer 字段（官方表另有 mistral/bedrock/azure 等协议的
门控，本插件不服务这些协议故不下发）；官方标 withhold 的字段**写时拒绝**并提示以
目录 provider 名为 route。浏览器半的字段表由服务端经 `GET /catalog` 下发
（`installCompatFields`），UI 渲染与服务端校验**同源**；协议下拉同理
（`installProtocols`，兜底三元组）。

> 门控表取自官方安装副本现场推导（`src/official-surface.ts`）。官方表在 npm 发布形态下
> 不可静态引用（包根不导出、`src/` 不随发布），手工镜像曾漏收官方扩容字段导致官方可配
> 字段被误拒（案例见 [事故记录](../../../docs/repo/事故记录.md)）。推导失败时回退内置
> 快照并放宽未知键（只拦快照中明确的 withhold），`tests/official-surface.test.ts` 独立
> 复算官方副本逐字段守门。

## 运行机制

- `startRuntime`：解析套件（dsh 树 → vendored，附版本/协议/字段集/compat 推导与
  逐项诊断）→ profiles 按原始 config 对象 identity 备忘 → `PiAiAdapter`
  （快照随 profiles identity 失效）→ `registerAdapter` + `registerModelDiscovery` +
  `registerConfigurableProviders`（官方 Models 页/拉取模型动作可见）。
- 热更新走 volatile 原位提交（`loader/volatile-update` 换代 config 快照）：
  配置变更下一请求生效；route 集或 displayName/retryPolicy 变化 → `handle.replace`
  原子重注册；**写入被校验拒绝时保留旧注册**（官方同款护栏）。
- **运行期宽松解析（lenient）**：`profiles()` 走宽松模式——已写入的 extends 引用
  因 dsh 升级换 pi-ai 版本而失效时，降级为手写条目并告警（缺 api/baseURL 时跳过该
  模型，route 全空则跳过注册）；写时校验（settings 写入）保持严格。
- **注册冲突降级**：整批 `registerAdapter` 遇 `DUPLICATE_ADAPTER` 时降级为逐个 route
  注册，跳过冲突者并告警；热更新原子 replace 被拒时保留旧注册。可配置 provider
  目录同理逐个剔除冲突条目重试。
- 配置读写走官方 remote.settings 直连（浏览器半 `createSettingsScope` /
  `createNamespaceApi`），保存为 `settings.update` 深合并（providers dict 全量替换
  语义）；写入经 `internal/config` waterfall 的 assertServiceable 把关。
- 自定义端点只有目录通道（`config-api.ts`，单次注册按 pathname 分派）：
  - `GET /dsh-plus/llm-pi/catalog` → `{ kit（来源/根/版本/协议/目录规模/诊断）,
    providers, apis（provider→modelId→api 紧凑索引）, compat（字段表） }`；
  - `GET /dsh-plus/llm-pi/catalog/models?q=&provider=&api=&reasoning=&image=&servable=&offset=&limit=`
    → `{ total, servableHidden, offset, limit, items }`（每项含路径 id 与参数明细）。

## 边界与风险

- **启动期 fail-loud 的爆炸半径**：cordis loader 条目的 apply 失败会导致整个
  profile 启动失败（与官方 llm-pi-ai 行为一致）。settings 用户层有校验护栏，
  仅组合基座（patch 行 config）配置错误才会触发；此时设 `enabled: false`
  或直接禁用条目即可恢复启动。
- `registerConfigurableProviders([])` 会抛 `INVALID_DIRECTORY`：空目录不注册，
  待 settings 用户层供数后自动补注册。
- 迁移 route 名后，旧会话绑定旧 route 名，不能在新 route 上继续（dsh 原生语义）。
- schemastery 陷阱：array 字段缺省物化为 `[]`（`defaultInput` 必须给 schema 默认值）；
  settings 层 deepFreeze 的解析值不能再过带键约束 dict 的 schema 二次校验——
  volatile 字段为活动引用，`unwrapVolatile` 每次现取而非缓存快照。
- schemastery 物化噪声：**dict 字段无 default 也会物化为 `{}`**（`compat`/`headers`/
  `thinkingBudgets`），`defaultInput` 物化为 `['text']`、模型 `input` 物化为 `[]`。
  凡"用户是否配置了该字段"的判定（如 adapter: deepseek 对 pi 专有字段的写时拒绝）
  必须按语义判空，否则 settings 投递路径会把合法配置误判拒绝，fiber 在启动期 FAILED
  （lifeboat 会隔离插件）。
- **官方打包形态变化**只影响推导：协议/字段集/compat 各自回退并记诊断，配置页
  状态行可见；此时 compat 采用"未知键放行"策略，宁可少拦也不误拒。

## 开发

```bash
corepack pnpm --filter @dsh-plus/llm-pi build   # node 半 ESM + 浏览器半 CJS
node --test packages/llm-pi/tests/*.test.ts        # 单测（vendored 套件，零网络）
```

- 依赖对齐：devDependencies 的 `@deepseek-ai/*` 与 `@earendil-works/pi-ai` 跟随
  本机安装的 dsh 线（当前 0.2.1-alpha.1 / pi-ai 0.87.1），供构建、类型与单测使用；
  peer 里 `@earendil-works/pi-ai` 写成 `>=0.85.1`（无上界），运行时以形状自检为准。
- 新增模型走目录浏览器一键 extend（或 `extends: provider/model` 手写）即可；
  本仓生产配置示例：newapi 中转的 anthropic 路由在 `k3`/`k3-256k` 之外再挂
  `kimi-for-coding` = `extends: kimi-coding/kimi-for-coding`，中转侧无需登记 ID。
- 联调建议：用独立 `DSH_HOME` 起一个 dev 实例，模型后端指向本机 mock（OpenAI 兼容
  假后端），避免产生真实 API 费用。

## 平台支持

- dsh 树锚点链：`ctx.profileContext.installAnchor` → `realpath(argv[1])` 向上
  查找（要求同目录树同时含 `@deepseek-ai/dsh-llm-pi-ai` 与 `@earendil-works/pi-ai`）
  → vendored 副本兜底。桌面端 Electron 启动时 argv[1] 是 Electron 自身，
  锚点是唯一可靠来源（状态行显示生效来源与版本）。
- `auth-inline` 的 `fileExists` 展开 `~/` 与 `~\` 两种前缀（Windows 反斜杠形态）。
- 无其他平台特判：路由/compat/discovery/浏览 全为纯 TS；桌面端与 Windows 复用同链路。
