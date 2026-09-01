---
last_modified: "2026-09-01 12:19"
---

# @dsh-plus/secret-env

环境变量：把 API key、链接等值以 `$DSH_VAR_*` 环境变量形式暴露给 agent 的
shell 工具——值由宿主在执行瞬间注入，**永不进入会话记录 / prompt / 配置流**，
模型只能看到并引用变量名，读不到值本身。service+ui 混合插件。

## 核心保证

| 保证 | 机制 |
|---|---|
| 值不进 prompt | 值路径：浏览器 → 同源 POST → 宿主 → credentials 文件 / 会话内存 → `dshEnv` 注入；全程不触碰消息流 |
| prompt 前缀字节稳定 | 不写系统提示、不加工具；值变化不改变任何已发送内容，缓存命中率不受影响 |
| 模型可发现 | 复用原生 bash 工具自带的 `DSH_*` 环境变量枚举提示，零额外提示词 |
| 值不落会话盘 | 会话记录（zstd JSONL）中只出现变量名；端到端实测零泄漏 |

## 三种来源

| 来源 | 入口 | 持久化 | 生命周期 |
|---|---|---|---|
| 全局 | 设置 → 环境变量 页 | `$DSH_HOME/.credentials.yaml`（dsh-credentials）+ 元数据索引于 settings | 跨会话、跨重启 |
| 会话 | 聊天框 `/var` 命令（或设置页会话管理区） | 仅内存（会话 bucket） | 会话 dispose 即焚毁；可选一次性（首次使用后即焚） |
| 继承 | 宿主进程环境的 `DSH_VAR_*`（平台默认剥离，本插件显式转发） | 宿主环境本身 | 随宿主进程；默认纳入注入，可屏蔽 |

优先级：会话值 > 全局值（同名时会话值胜出）。屏蔽名单最优先：
会话屏蔽 > 全局屏蔽 > 一切来源（被屏蔽的变量对相应执行一律不注入）。

## 屏蔽（mask）

- 设置页「继承变量」区可全局屏蔽/恢复（持久于 settings 的 `masked` 名单）；
- `/var` 会话面板里全局与继承变量带眼睛开关，仅屏蔽本会话（纯内存）；
- 被屏蔽的变量不出现在 `$` 补全候选中。

## 模型可见的名称

`$DSH_VAR_<SUFFIX>`。SUFFIX 规则：大写字母开头，仅大写字母/数字/下划线，
≤64 字符；所有名称输入框**键入即自动大写**，非法格式实时标红并禁用保存
（端点侧同源校验兜底）。

## `$` 触发补全

在聊天输入框键入 `$` 即弹出变量名候选（交互对齐官方 `/` 命令与 `@` 引用）：
候选只显示**本名**（不含 `DSH_VAR_` 前缀），继续键入按前缀/子串过滤，
↑↓ 选择，Enter/Tab/点击补全为完整 `$DSH_VAR_*` 名（含尾随空格），Esc 关闭。
候选涵盖会话/全局/继承三种来源（带作用域徽标），已屏蔽的不出候选。
词法边界与官方一致：起草开头、空白后、标点后触发；词中 `$` 不弹窗。

实现要点：官方 input-trigger 管线的检测核只认 `/` 与 `@`（TriggerChar 联合
类型），`$` 进不了该管线，故检测/菜单由插件自理（conversation.input.overlay
插槽 + 官方标准面 `useInput`）；插入复用官方会话作用域 bail 通道
`slash/input-insert-text`（span + draftRev CAS，编辑器内应用）。

## `/var` 斜杠命令

经官方 `commandUi`（dsh-client-ui-commands）注册。contribution 的 UI kind
只有官方共享 popupSelect 壳（自定义 React 弹窗不可经此渲染），故命令提供
「打开会话变量面板」单动作，选中后由本插件占有的 overlay 槽渲染完整面板
（会话变量增删 + 全局/继承变量的会话内屏蔽）。子代理会话不出现该命令。

## 图标约定

图标统一经 `@dsh-plus/shared/client`：官方基元
`@deepseek-ai/dsh-client-ui-primitives`（平台 seed 模块，构建 external、
运行时外壳供给）直接 re-export；官方缺失的 Eye/EyeOff 由 lucide-react
深路径单图标文件补齐（CJS barrel 会导致全量 1.8k 图标进 bundle，禁用之）。

## 已知边界（方案 A 固有限制）

agent 可通过 `echo $DSH_VAR_X` 主动把值打印进工具结果——方案 A 防的是
**被动泄漏**（值不随 prompt/记录/配置流转），防不了同用户子进程的**主动读取**
（与官方内置 `DSH_*` 变量同一边界）。不要让不可信提示词诱导 agent 回显机密。

## 架构

- **宿主半**：`src/service.ts`（`SecretEnvService`：镜像/会话桶/屏蔽名单）、
  `src/contributors.ts`（`ContributorBook`：受管/继承 contributor 一键一主
  生命周期）、`src/inventory.ts`（索引解析与端点 DTO 纯函数）。元数据索引与
  全局屏蔽名单经官方 `settings.installSection` 范式持久化（`setSource`
  实时 getter，重启/热更不丢）。
- **API 半**（`src/api.ts`）：`/dsh-plus/secret-env/` 前缀端点（list /
  global/set/unset / session/set/unset / mask/set），同源 loopback 信任，
  错误一律以 `SecretEnvError.code` 结构化返回（empty-value / shadowed /
  conflict / no-session）。
- **浏览器半**（`src/client/`）：`settings.section` 设置页（全局管理 +
  继承屏蔽 + 会话管理）+ `conversation.input.overlay` 双浮层（`$` 菜单与
  `/var` 面板）；样式复用官方 `--dsw-alias-*` 设计令牌，≤767px 响应式。

## 验证口径（零真实 API 费用）

`node --test packages/secret-env/tests/`（31 例：优先级、隔离、一次性焚毁、
dispose 清理、空值拒绝、重启镜像重建、空描述回落、全局/会话屏蔽、继承转发
与接管）+ dev 实例端到端（mock-llm + 真实 bash 工具调用，sha256 比对证明
值达子进程、记录零泄漏）。
