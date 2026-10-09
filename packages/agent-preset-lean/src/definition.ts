/**
 * 精简模式预设声明组装：官方 `standard` 预设的行**镜像子集**。
 *
 * 每条保留行的 `id`/`name`/`config`（含平台门控表达式）都与上游
 * `@deepseek-ai/dsh-web-app` 的 `presets/standard.patch.yml` 逐字一致，唯一自有
 * 文本是 persona 前缀（见 prompt.ts）；上游改用新版本后，按
 * docs/ops/新版适配流程.md 刷新夹具，tests/upstream-mirror.test.ts 会逼出对齐。
 *
 * 取舍：只挂模型面核心能力（shell、文件、后台任务、联网、技能、待办、提问、
 * 计划、交付、压缩），去掉委派与编排类大件（subagent/fork/workflow/ralph）、
 * goal、schedule、glob/grep（shell 覆盖之）与插件管理工具——见 DROPPED_ROWS。
 * 组行必须带 `isolate` 归属 realm，否则注册表拒绝挂载（服务泄漏判定）。
 * @module @dsh-plus/agent-preset-lean/definition
 */
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'

import type { AgentPresetLeanConfig } from './config.ts'
import { LEAN_PERSONA_PREFIX, PLAN_MODE_SECTION } from './prompt.ts'

/** 预设注册表身份（改 id 等于换预设，default 等引用都会落空）。 */
export const LEAN_PRESET_ID = 'lean'

/**
 * 上游 `standard` 预设有、本预设刻意不挂的行 id（含组内子行）。
 *
 * 镜像测试用它判定「上游新增行必须显式决策」：上游行既不在声明里、也不在本表，
 * 测试即失败。删除本表条目等于把该能力加回精简模式。
 */
export const DROPPED_ROWS: readonly string[] = [
  // 文件检索：glob/grep 由 shell（rg/find/ls）覆盖
  'tool-fs-search',
  // 定时提醒：模型面 schedule_* 四工具
  'tool-schedule',
  // 同会话目标：/goal 命令与模型面目标工具
  'command-goal',
  'tool-goal',
  // 委派与编排：子代理、fork、workflow 整组
  'delegation',
  'tool-subagent-control',
  'tool-subagent-list-agents',
  'tool-subagent',
  'tool-subagent-fork',
  'workflow-ptc',
  'tool-workflow',
  // 宿主插件管理（上游 standard 里同样是 disabled 行）
  'tool-plugin-manager',
]

/** 平台门控表达式：与上游 `standard` 预设逐字相同，Windows 上由 pwsh 顶替 bash。 */
const WINDOWS_ONLY = { __jsExpr: "process.platform === 'win32'" } as const
const POSIX_ONLY = { __jsExpr: "process.platform !== 'win32'" } as const

/** 官方 loader 的嵌套组行名。 */
const GROUP = 'cordis:group'

/** 生效的 persona 前缀：显式配置优先，空白串回落内置文本。 */
export function resolvePersonaPrefix(config: AgentPresetLeanConfig): string {
  return config.personaPrefix.trim() === '' ? LEAN_PERSONA_PREFIX : config.personaPrefix
}

/**
 * 由配置拼出注册表声明。
 * @param config - 已验证的插件配置。
 * @returns id 固定为 `lean` 的预设声明。
 */
export function leanPresetDefinition(config: AgentPresetLeanConfig): PresetDefinition {
  return {
    id: LEAN_PRESET_ID,
    name: config.name,
    description: config.description,
    order: config.order,
    plugins: [
      // 身份：保留官方装配（非 complete、保留运行时上下文快照），只换前缀；
      // 上游只声明 prefix（工作目录改由官方 working_directory 工具传达），本行不补后缀。
      {
        id: 'persona',
        name: '@deepseek-ai/dsh-persona',
        config: {
          prefix: resolvePersonaPrefix(config),
        },
      },
      // 项目指令（AGENTS.md）与逐步时钟上下文（默认 10 分钟一条）。
      {
        id: 'agent-instructions',
        name: '@deepseek-ai/dsh-agent-instructions',
        config: { maxBytes: 65536 },
      },
      { id: 'time-context', name: '@deepseek-ai/dsh-time-context' },
      // shell：一次性执行，执行器在宿主平面；平台门控与上游一致。
      { id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash', disabled: WINDOWS_ONLY },
      { id: 'tool-pwsh', name: '@deepseek-ai/dsh-tool-pwsh', disabled: POSIX_ONLY },
      // 文件读写与后台任务控制。
      { id: 'tool-fs', name: '@deepseek-ai/dsh-tool-fs' },
      { id: 'tool-jobs', name: '@deepseek-ai/dsh-tool-jobs' },
      // 技能：本地目录发现 + 模型面加载器（官方注册表按 scope 分层）。
      { id: 'skill-filesystem', name: '@deepseek-ai/dsh-skill-filesystem' },
      { id: 'tool-skill', name: '@deepseek-ai/dsh-tool-skill' },
      // 计划模式：状态天然属于单个 agent，条目级 realm 即正确生命周期。
      {
        id: 'planning',
        name: GROUP,
        group: true,
        isolate: { planMode: true },
        config: [
          {
            id: 'plan-mode',
            name: '@deepseek-ai/dsh-plan-mode',
            config: { section: PLAN_MODE_SECTION },
          },
        ],
      },
      // 压缩：token 计量器留在宿主平面，本组只挂读取它的后端与结果裁剪器。
      {
        id: 'compaction',
        name: GROUP,
        group: true,
        isolate: { compaction: true, toolResultPruner: true },
        config: [
          { id: 'compaction-basic', name: '@deepseek-ai/dsh-compaction-basic' },
          { id: 'command-compact', name: '@deepseek-ai/dsh-command-compact' },
          {
            id: 'tool-result-pruner',
            name: '@deepseek-ai/dsh-compaction-tool-result-pruner',
            config: { thresholdChars: 8192, headChars: 4096, tailChars: 1024 },
          },
        ],
      },
      // 其余模型面行。
      { id: 'tool-ask-user', name: '@deepseek-ai/dsh-tool-ask-user' },
      {
        id: 'tool-todo',
        name: '@deepseek-ai/dsh-tool-todo',
        config: { allowParallelInProgress: true },
      },
      {
        id: 'tool-web',
        name: '@deepseek-ai/dsh-tool-web',
        config: { fetch: true, searchTimeoutMs: 60000 },
      },
      { id: 'present', name: '@deepseek-ai/dsh-tool-present' },
    ],
  }
}
