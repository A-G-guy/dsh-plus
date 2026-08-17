---
last_modified: "2026-08-17 20:03"
---

# @dsh-plus/skill-manual：手动触发技能

把「低频 / 只需手动触发」的 skill 独立到 `$DSH_HOME/skills-manual/` 管理：
不进模型 skills catalog、agent 无法主动加载，但用户仍可在斜杠发现中看到，
发送 `/name` 即把 SKILL.md 以 `<skill_content>` 提示词形式注入会话。

## 机制（全部复用上游，无私有解析）

- 发现/解析：完全委托上游 `@deepseek-ai/dsh-skill-filesystem` 的
  `FileSystemSkillProvider`（`includeDefaultRoots: false` + 单 `customSkillDirs`），
  识别规范不变：`<root>/<name>/SKILL.md` 或 `<root>/<name>.md`，frontmatter
  `name`/`description` 必填、kebab-case，支持 `whenToUse`/`metadata` 等上游字段。
- 策略：本插件把每个发现的 skill 强制映射为
  `invocation: { modelInvocable: false, userInvocable: <frontmatter 原值> }`。
- 生效链路（上游既有行为，无需本插件参与）：
  - 模型侧 catalog 与 `skill` 工具只暴露 model-invocable → manual skill 天然缺席；
    模型强行调用会得到 `skill "<name>" is not available for model invocation`。
  - Web 的 `skills.list` 以 user-invocable 过滤并携带 `modelInvocable` 标志 →
    斜杠命令/选择器可见。
  - 用户消息中空白边界的 `/name` 由 `dsh-tool-skill` 的 user-explicit gesture
    边界注入完整 `<skill_content>`（user-role instructions）。
- 注册位置：经 `@dsh-plus/bundle-main` 进入 host 组合 → provider 落在
  `ctx.skills` 全局层，所有 preset 的合并视图可见；与项目层同名 skill 冲突时
  项目层就近胜出（上游标准遮蔽规则）。

## 使用

1. 在 `$DSH_HOME/skills-manual/<name>/SKILL.md`（或 `<name>.md`）按上游规范撰写；
   **无需**写 `disable-model-invocation: true`，目录位置即手动语义。
2. 在 Web 输入框斜杠发现该 skill 并发送 `/name`，或直接把 SKILL.md 路径发给 agent。
3. 想恢复自动触发：把该 skill 移回常规 skills 目录（如 `~/.dsh/skills`）。

### 策略决策（显式）

- 位置即语义：manual 根下 skill **一律** `modelInvocable: false`，
  frontmatter 写 `disable-model-invocation: false` 不能重新开放模型调用。
- frontmatter `user-invocable: false` 仍受尊重（该 skill 完全隐藏，两侧都不可见）。

## 配置（cordis 行级）

| 字段 | 默认 | 含义 |
|---|---|---|
| `providerName` | `skill-manual` | provider 在 `ctx.skills` 的唯一名 |
| `root` | `$DSH_HOME/skills-manual` | 手动技能根目录（跟随 dev/prod home 自动隔离） |
| `watch` | `true` | Chokidar 监听根目录变化并失效目录缓存 |
| `watchUsePolling` | `false` | 轮询替代原生事件 |

后续 patch 层可按 id `dsh-plus-skill-manual` 覆盖 config 或禁用。

## 边界

- 根目录不存在是合法空态；`watch: true` 时缺失路径会被探针跟踪，创建后自动挂载监听。
- 畸形 frontmatter 由上游 warn + 跳过，本插件不额外处理。
- 改动 SKILL.md 正文无需重启；frontmatter 变化经 watcher 失效后下个目录快照生效。

## 零代码替代方案（取舍记录）

也可以只在 preset 的 `skill-filesystem` 行配置 `customSkillDirs: […/skills-manual]`，
并为每个 skill 手写 `disable-model-invocation: true`。本插件的价值在于
「位置即语义」免逐文件标注、策略强制不可误开、独立 provider 可单独启停。
