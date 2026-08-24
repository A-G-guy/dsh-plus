---
last_modified: "2026-08-24 23:27"
---

# @dsh-plus/feature-toggle 文档索引

功能开关管理器：在 webui「设置 → 插件 → 插件配置」按功能组开关官方插件与
dsh-plus 自研插件。官方子代理相关行（delegation 组）合并显示为
「子代理与工作流」一个开关；核心插件经封闭目录隔离，机制上不可关闭。

## 机制

### 双平面开关

| 平面 | 控制对象 | 实施位置 | 生效方式 |
|---|---|---|---|
| host | 组合树行（dsh-base / dsh-web-app / dsh-plus bundle） | profile 用户 patch 层（`cordis.patch.yml`）的管理条目 | watchUserPatches 热应用，即时生效 |
| preset | agent 预设行（standard 等 `agent.cordis.yml`） | 托管预设副本 `~/.dsh/.agent-presets/dsh-plus-toggles/` | 预设 stamp/generation，新会话生效 |

- **host 管理条目**（`src/patch-file.ts`）：带 `dsh-plus-feature-toggle:managed`
  注释标记的 `{id, disabled: true}` 行。归属判定只认标记——lifeboat 的隔离条目
  与用户手工条目（同形但无标记）一律视为外部条目，只读不动。
- **托管预设**（`src/preset-file.ts` + `src/engine.ts`）：首次启用任一 preset 平面
  功能时，经官方 `agentPresets.copy(源, 'dsh-plus-toggles')` 复制源预设（默认
  `standard`），随后按期望态对目录行增删 `disabled: true` 标量（组行如
  `delegation` 禁用即级联全部子行），并把 `agent-presets` settings ns 的
  `default` 指向托管副本。新会话自动走托管副本；已加入会话保持原组合不变。
- **生效顺序**：禁用路径先 preset 后 host（先撤模型面工具再撤后端）；启用路径
  反之（先恢复后端再恢复工具）。

### 封闭目录（默认拒绝）

`src/catalog.ts` 是编译期常量：只有目录登记的行 id 才可写，目录外的任何 id
（llm / session / settings / webserver / api-gateway / agent-presets / `subagent`
注册表 / sandbox / tools / system-prompt / lifeboat / bundle-main /
feature-toggle 自身 / llm-pi）在 `patch-file` / `preset-file` 写入边界直接抛错。
`catalogViolations()` 自检（单测覆盖）：host 与 preset 行不相交、禁止行不进目录、
行不跨功能重复。

### 与 lifeboat 的协调

- 启用被 lifeboat 隔离的 dsh-plus 插件：规划阶段拒绝（journal 记录
  `reject`，维持禁用态），避免与救生艇对抗。
- lifeboat journal（settings ns `dsh-plus-lifeboat` 的 quarantine 条目）零依赖
  读取（`src/lifeboat-bridge.ts`），读取失败一律视为无记录。

### 写入纪律与回退

1. 每次写入前 `copyFile → .feature-toggle.bak`；结构校验（顶层数组、id ∈ 目录）
   不过即拒写；tmp + rename 原子落盘，绝不写半个文件。
2. 预设写入后经 `agentPresets.list()` 复核托管预设非 broken；不符 → 恢复备份。
3. patch 写入后开健康监视窗口（默认 10s，`healthWindowMs` 可配）：监听
   `internal/status` fiber FAILED（`FiberState.FAILED=3` 镜像，lifeboat 同款），
   发现失败 → 恢复备份热回滚 + journal + 告警。
4. 最坏情况（进程级 boot 失败）：封闭目录保证只可能来自 YAML 语法损坏，而原子
   写杜绝半文件；手动恢复路径：`cp <file>.feature-toggle.bak <file>` 后重启。
5. feature-toggle 自身 fiber FAILED：lifeboat 既有能力自动隔离它（管理条目留存
   为惰性禁用态，无放大损害）。

### 重启提示策略

常规操作**零重启**：host 平面开关即时生效；preset 平面开关自新会话生效。
卡片横幅常显「无需重启 dsh」；仅当出现 `pendingRestart`（热应用验证失败回滚后）
才显示红色横幅，写明重启路径（`sudo systemctl restart dsh-web` 或设置页
「重新加载」按钮）。

## 功能目录 v1

| 功能 | 平面/行 | 生效 |
|---|---|---|
| 子代理与工作流 | preset `delegation` 组；host `subagent-spawn-in-process` / `subagent-fork-in-process` | 新会话 |
| 网页搜索 | preset `tool-web`（host `web` 服务保留空转） | 新会话 |
| 计划模式 | preset `planning` 组 | 新会话 |
| 任务清单 | preset `tool-todo` | 新会话 |
| 目标 | preset `tool-goal`（host goal 服务族保留，gateway 依赖） | 新会话 |
| dsh-plus 各插件（7 项） | host 对应 `dsh-plus-*` 行 | 即时 |

不可关（部分）：`subagent` 注册表（api-proxy `static inject` 硬依赖）、
`tool-subagent-report`（host 平面 continuable setup）、`web`/`web-search-deepseek`
（热 dispose 连累在途会话）、goal 服务族（gateway Remote 依赖）。

## 配置项

行级 config（settings ns `dsh-plus-feature-toggle`）：

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | true | 总开关（false 清理全部管理痕迹并还原默认预设指针） |
| `patchFile` | '' | profile 用户 patch 文件绝对路径（留空取 web profile） |
| `sourcePresetId` | standard | 托管预设复制源 |
| `healthWindowMs` | 10000 | 写入后健康监视窗口毫秒数 |

用户期望态：`features: dict<boolean>`（缺省 = 启用）；卡片经官方 settings RPC
读写，插件 watch 后自动调和。

## 自定义端点

- `GET /dsh-plus/feature-toggle/state` — 状态快照（期望/生效/指针/journal/隔离）。
- `POST /dsh-plus/feature-toggle/rebuild` — 重建托管预设（body 可带
  `{sourcePresetId}`；源预设升级漂移后的修复动作）。

## 边界

- agentPresets 服务缺席：preset 平面开关降级不可用（卡片显示告警），host 平面
  开关不受影响。
- 默认预设指针被用户改走：卡片黄条告警 + 「重建托管预设」一键修复。
- 源预设升级漂移：托管副本不自动跟进（避免覆盖用户开关态），经重建动作手动同步。
