---
last_modified: "2026-09-29 18:54"
---

# @dsh-plus/agent-preset-chat 文档索引

把「纯聊天模式」注册为官方 agent preset（**id=`chat`**），出现在
设置 → Agent 预设 的名单里，可被新会话选择。

## 背景（为什么需要这个插件）

遗留预设 `$DSH_HOME/.agent-presets/chat/{preset.yml,agent.cordis.yml}`
自官方 preset registry（`@deepseek-ai/dsh-agent-preset-registry`）起
**不再被任何代码读取**（官方技能 `editing-cordis-compositions`：
"Nothing reads that directory any more"）。本插件是它在新机制下的等价物，
经 `ctx.agentPresets.register()` 注册，迁移完成后遗留目录可删除。

## 预设语义

与遗留 `agent.cordis.yml` 逐字段一致，仅一行 `persona`：

```yaml
- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    prefix: ''
    complete: true
    includeRuntimeContext: false
```

- `prefix: ''` + `complete: true`：该行即完整系统提示词——全局身份、
  Web 定向、工具指引不再追加任何文本；
- `includeRuntimeContext: false`：不注入运行时上下文快照；
- 未声明任何工具/skill 行 → 模型拿到空工具目录、无 skill 目录；
- 会话/对话主流程（agent loop、sessions、UI）不变。

## 行为

- **惰性 inject `agentPresets`**：服务缺席的 profile（如 headless）里本行
  照常 active、只是不注册（等价插件缺席），不因硬 inject 永久 pending
  拖垮 boot（同 boot-retry 的教训）；
- **后台注册**：`register()` 在 effect 内不 await 完成——注册会同步挂载
  预设子树并等待其激活，阻塞本行激活可能与 Host 树推进互锁；失败（如
  重名 `chat`）仅记 warn，不使 boot 失败，注册表名单不受影响；
- **卸载即注销**：effect 清理函数持有注册表返回的 disposer；fiber 早于
  注册完成被卸下时，`disposed` 标记保证晚到的 disposer 仍被调用。

## 配置

cordis 行级 config（schemastery，见 `src/config.ts`），可在 profile 的
`cordis.patch.yml` 覆盖（patch 层按行整体替换，需写全字段）：

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关；`false` = 不注册，等价插件未安装 |
| `name` | `聊天模式` | 预设显示名（卡片标题） |
| `description` | `纯对话模式：无工具调用、无 skill、无内置提示词，仅用于聊天。` | 卡片描述 |

预设 **id 固定为 `chat`**（注册表身份，不开放覆盖——改 id 等于换预设，
default 等引用会落空）。

## 契约

- 服务端插件，无浏览器半；平台包（`@deepseek-ai/dsh-agent-preset-registry`）
  一律 peer（宿主提供单实例），仅作类型来源，运行时不 import。
- `chatPresetDefinition(config)`：配置 → 注册表声明的纯函数，供测试断言
  与遗留文件逐字段对齐（`tests/agent-preset-chat.test.ts`）。
