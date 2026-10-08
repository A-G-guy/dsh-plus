---
last_modified: "2026-10-08 21:45"
description: "@dsh-plus/agent-preset-lean 文档索引"
type: fact
---

# @dsh-plus/agent-preset-lean 文档索引

把「精简模式」注册为官方 agent preset（**id=`lean`**，显示名「精简模式」），
出现在设置 → Agent 预设的名单里，可被新会话选择。

## 定位

官方 `standard` 预设的行**镜像子集**：保留模型面核心能力
（shell、文件读写、后台任务、联网检索、技能、待办、提问、计划模式、交付、
压缩），去掉委派与编排类大件，降低每轮请求的固定开销（工具定义 + 提示词）。

| | 官方 `minimal` | 本预设 `lean` | 官方 `standard` |
|---|---|---|---|
| 模型面工具 | 2（常驻 bash、str_replace_editor） | ≈14（bash/pwsh、read/write/edit、job_*、web_*、skill、todo_write、ask_user_question、exit_plan_mode、present） | ≈28（另含 glob/grep、schedule_*、goal、subagent/subagent_fork、list_agents、workflow、ralph、插件管理） |
| 系统提示词 | 固定一句、`complete`、无运行时上下文 | 官方装配 + 短前缀（本包唯一自有文本）+ AGENTS.md + 运行时上下文 | 官方装配 |
| 压缩 | 无 | 有（`compaction-basic` + 结果裁剪器） | 有 |
| 去掉的工具 | — | `tool-fs-search`、`tool-schedule`、`command-goal`、`tool-goal`、`delegation` 整组、`tool-plugin-manager` | — |

## 行清单

每条保留行的 `id`/`name`/`config`（含平台门控表达式）都与上游
`@deepseek-ai/dsh-web-app@0.2.1-alpha.1` 的 `presets/standard.patch.yml` 逐字
一致，唯一例外是 persona 行（只换前缀、后缀沿用上游）。

| 行 id | 官方行 | 说明 |
|---|---|---|
| `persona` | `@deepseek-ai/dsh-persona` | 精简前缀 + 上游后缀；非 `complete`，保留官方装配与运行时上下文 |
| `agent-instructions` | `@deepseek-ai/dsh-agent-instructions` | 项目指令（`AGENTS.md`），`maxBytes: 65536` |
| `time-context` | `@deepseek-ai/dsh-time-context` | 逐步时钟上下文（默认 10 分钟一条） |
| `tool-bash` / `tool-pwsh` | `@deepseek-ai/dsh-tool-bash` / `dsh-tool-pwsh` | 一次性 shell；`!!js process.platform` 门控，Windows 由 pwsh 顶替 bash |
| `tool-fs` | `@deepseek-ai/dsh-tool-fs` | `read`/`write`/`edit`（`attachments` 在位时另有 `read_image`） |
| `tool-jobs` | `@deepseek-ai/dsh-tool-jobs` | `job_output`/`job_list`/`job_kill`，配 `run_in_background` |
| `skill-filesystem` + `tool-skill` | `@deepseek-ai/dsh-skill-filesystem` / `dsh-tool-skill` | 技能目录发现与模型面加载器 |
| `planning`（组） | `cordis:group` | `isolate: { planMode: true }`，内含 `plan-mode` |
| `compaction`（组） | `cordis:group` | `isolate: { compaction: true, toolResultPruner: true }`，内含 `compaction-basic`、`command-compact`、`tool-result-pruner` |
| `tool-ask-user` / `tool-todo` / `tool-web` / `present` | 同名官方包 | 结构化提问、待办、`web_search`/`web_fetch`、交付声明 |

去除清单见 `src/definition.ts` 的 `DROPPED_ROWS`：`tool-fs-search`（glob/grep
由 shell 的 `rg`/`find`/`ls` 覆盖）、`tool-schedule`、`command-goal`、`tool-goal`、
`delegation` 整组（`tool-subagent*`、`workflow-ptc`、`tool-workflow`、
`tool-ralph`）、`tool-plugin-manager`。

## 行为

- **惰性 inject `agentPresets`**：服务缺席的 profile（如 headless）里本行照常
  active、只是不注册（等价插件缺席），不因硬 inject 永久 pending 拖垮 boot。
- **后台注册**：`register()` 在 effect 内不 await 完成——注册会同步挂载预设子树
  并等待其激活，阻塞本行激活可能与 Host 树推进互锁；失败（如重名）仅记 warn，
  不使 boot 失败。
- **卸载即注销**：effect 清理函数持有注册表返回的 disposer；fiber 早于注册完成
  被卸下时，`disposed` 标记保证晚到的 disposer 仍被调用。
- **工具面完全由预设决定**：web profile 在宿主平面禁用了全部 per-agent 工具行，
  未在本声明出现的工具不会泄漏——去掉 `tool-fs-search` 即真的没有 `glob`/`grep`。

## 配置

cordis 行级 config（schemastery，见 `src/config.ts`），可在 profile 的
`cordis.patch.yml` 覆盖（patch 层按行整体替换，需写全字段）：

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关；`false` = 不注册，等价插件未安装 |
| `name` | `精简模式` | 预设显示名（卡片标题） |
| `description` | `精简编码预设：官方核心工具子集（shell/文件/联网/技能/待办/提问/计划/交付），去掉委派与编排类工具。` | 卡片描述 |
| `order` | `5` | 名册排序位（官方 standard=1 / ptc=2 / minimal=3 / cordis=4） |
| `personaPrefix` | 内置精简前缀 | persona 前缀；空白串回落内置文本 |

预设 **id 固定为 `lean`**（注册表身份，不开放覆盖——改 id 等于换预设，
`default`/`selectedDefault` 等引用都会落空）。

## 上游镜像与追随更新

- 夹具：`tests/fixtures/upstream-standard.patch.yml`（上游文件逐字副本 +
  来源注释头）。
- 镜像测试：`tests/upstream-mirror.test.ts` 断言「本包只镜像上游已有行」
  「每个上游行要么被镜像、要么在 `DROPPED_ROWS`」「去除清单无孤立项」
  「被镜像行 `name`/`config` 深比较相等（persona 例外）」「shell 门控表达式
  逐字相同」「行次序是上游次序的子序列」。
- dsh 升级后按[新版本 dsh 适配流程](../../../docs/ops/新版适配流程.md)刷新夹具并跑
  `dshctl test`：上游新增/改名/改配置的行会让镜像测试失败，据此决定镜像进
  `src/definition.ts` 还是写进 `DROPPED_ROWS`。

## 验收

```bash
pnpm test                                        # 守门：lint + 构建 + 类型 + 单测
DSH_HOME=~/.dsh-dev dsh --profile web --dump-config | grep -A4 dsh-plus-agent-preset-lean
python3 scripts/dshctl.py dev up                 # dev 实例（mock LLM，零费用）
```

dev 实例内新建会话 → 设置 → Agent 预设选中「精简模式」，用
`python3 scripts/dshctl.py dev logs mock-llm` 核对请求体：工具名单与预期集合
一致（无 `glob`/`grep`/`subagent*`/`workflow`/`ralph`/`goal`/`schedule`），
且 `system` + `tools` 体量小于 `standard` 预设的同类请求。

Windows 等价性由镜像测试与门控表达式逐字比对保证；本机无 Windows 环境，
运行期未实测。

## 实测（dev 实例 + mock LLM，2026-10-08）

同一工作区、同一 `ping` 提示下的首轮请求（取自 `~/.dsh-dev/run/mock-llm.log`
的 `toolsChars` / `chars` 元数据）：

| 预设 | 模型面工具 | 工具定义字节 | 请求体字节 |
|---|---|---|---|
| `lean` | 16（含 dev 专有 `text_transform`） | 11 951 | 21 205 |
| `standard` | 31（同上） | 28 844 | 39 195 |

即工具定义 −58.6%、请求体 −45.9%（请求体含系统提示词）。`lean` 相对 `standard`
少掉的 15 个工具：`glob`、`grep`、`create_goal`、`get_goal`、`update_goal`、
`schedule_create`、`schedule_delete`、`schedule_list`、`schedule_update`、
`subagent`、`subagent_fork`、`send_message`、`interrupt_agent`、`list_agents`、
`workflow`。名册里 `lean` 无 `broken` 诊断，即声明挂载与激活审计均通过。
