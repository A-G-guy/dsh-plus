---
last_modified: "2026-09-01 02:07"
---

# @dsh-plus/secret-env

密钥变量：把 API key 等机密以 `$DSH_SECRET_*` 环境变量形式暴露给 agent 的
shell 工具——值由宿主在执行瞬间注入，**永不进入会话记录 / prompt / 配置流**，
模型只能看到并引用变量名，读不到值本身。service+ui 混合插件。

## 核心保证

| 保证 | 机制 |
|---|---|
| 值不进 prompt | 值路径：浏览器 → 同源 POST → 宿主 → credentials 文件 / 会话内存 → `dshEnv` 注入；全程不触碰消息流 |
| prompt 前缀字节稳定 | 不写系统提示、不加工具；值变化不改变任何已发送内容，缓存命中率不受影响 |
| 模型可发现 | 复用原生 bash 工具自带的 `DSH_*` 环境变量枚举提示，零额外提示词 |
| 值不落会话盘 | 会话记录（zstd JSONL）中只出现变量名；端到端实测零泄漏 |

## 两种作用域

| 作用域 | 入口 | 持久化 | 生命周期 |
|---|---|---|---|
| 全局 | 设置 → Secret Variables 页 | `$DSH_HOME/.credentials.yaml`（dsh-credentials）+ 元数据索引于 settings | 跨会话、跨重启 |
| 会话 | 会话输入区右侧钥匙 chip | 仅内存（会话 bucket） | 会话 dispose 即焚毁；可选一次性（首次使用后即焚） |

优先级：会话 > 全局（同名时会话值胜出）。

## 模型可见的名称

界面展示与模型实际可见的名称一致：`$DSH_SECRET_<SUFFIX>`。
SUFFIX 规则：大写字母开头，仅大写字母/数字/下划线，≤64 字符
（输入自动 trim + 大写归一）。

## `$` 触发补全

在聊天输入框键入 `$` 即弹出密钥名候选（交互对齐官方 `/` 命令与 `@` 引用）：
继续键入按前缀/子串过滤，↑↓ 选择，Enter/Tab/点击补全为完整变量名
（含尾随空格），Esc 关闭。词法边界与官方一致：起草开头、空白后、标点后
才触发；词中 `$`（如续写 `foo$BAR`）不弹窗。

实现要点：官方 input-trigger 管线的检测核只认 `/` 与 `@`（TriggerChar 联合
类型），`$` 进不了该管线，故检测/菜单由插件自理（conversation.input.overlay
插槽 + 官方标准面 `useInput`/`inputActions`）；插入复用官方会话作用域 bail
通道 `slash/input-insert-text`（span + draftRev CAS，编辑器内应用，引用芯片
按 detect 投影坐标修正）。补全只写变量名文本，值不经过浏览器外的任何通道。

## 已知边界（方案 A 固有限制）

agent 可通过 `echo $DSH_SECRET_X` 主动把值打印进工具结果——方案 A 防的是
**被动泄漏**（值不随 prompt/记录/配置流转），防不了同用户子进程的**主动读取**
（与官方内置 `DSH_*` 变量同一边界）。不要让不可信提示词诱导 agent 回显机密。

## 架构

- **宿主半**（`src/service.ts`）：`SecretEnvService` 持有全局镜像（内存 Map，
  供 shell-env 同步 contributor 的 `resolve` 读取）与会话 buckets；
  每个变量名注册一个 `ctx.shellEnv.register` contributor（注册表一键一主，
  按值的存在性动态注册/注销）。元数据索引经官方 `settings.installSection`
  范式持久化（`setSource` 实时 getter，重启/热更不丢索引）。
- **API 半**（`src/api.ts`）：`/dsh-plus/secret-env/` 前缀端点（list /
  global/set/unset / session/set/unset），同源 loopback 信任（无额外鉴权），
  错误一律以 `SecretEnvError.code` 结构化返回（empty-value / shadowed /
  conflict / no-session）。
- **浏览器半**（`src/client/`）：`settings.section` 全局管理页 +
  `conversation.input.right` 会话注入 chip（计数徽标 + popover，窄屏降底栏）；
  样式复用官方 `--dsw-alias-*` 设计令牌，≤767px 响应式（表格转堆叠卡、
  44px 触控目标）。

## 验证口径（零真实 API 费用）

`node --test packages/secret-env/tests/`（14 例：优先级、隔离、一次性焚毁、
dispose 清理、空值拒绝、重启镜像重建、空描述回落）+ dev 实例端到端
（mock-llm + 真实 bash 工具调用，sha256 比对证明值达子进程、记录零泄漏）。
