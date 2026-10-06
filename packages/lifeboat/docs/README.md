---
last_modified: "2026-10-06 13:52"
description: "@dsh-plus/lifeboat 文档索引"
type: fact
---

# @dsh-plus/lifeboat 文档索引

故障救生艇：dsh 破坏性更新导致兄弟插件无法加载时的自动止血。

## 机制

- **故障隔离**（`src/quarantine.ts`）：监听 `internal/status` fiber FAILED 转移
  （host 侧直接监听；浏览器侧由 `src/client/client.ts` 哨兵经
  `POST /dsh-plus/lifeboat/quarantine` 回报），向 profile 用户 patch 层
  （默认取 `ctx.profileContext.patchPath`——CLI 的 `web` profile 与桌面端的
  `desktop` profile 各写各的，行级 config `patchFile` 可覆盖；组合树无
  profileContext 时隔离停用且不写任何文件，防错写其他 profile）
  追加 `{id, disabled: true}`。只处理 `dsh-plus-` 前缀，排除自身与 bundle-main。
  写入幂等、先备份（`.lifeboat.bak`）、原子落盘。隔离时摘录 fiber 的失败原因
  （`fiber._error`，截断 500 字符）进 journal 与告警正文——dsh 的插件 logger
  不落 stdout，无此摘录则故障根因不可见。
- **LLM 应急副本指引**（`src/copy-guide.ts`）：默认模型 provider 无已注册 adapter
  时，读取 llm-pi 常备的官方应急副本（`$DSH_HOME/llm-pi.official-patch.yaml`；
  `src/official-copy-status.ts` 按文件契约同路径派生、只读），按副本形态告警：
  就绪（附生成时间/route 数与 `dsh <profile> --patch <路径>` 应用指引）、缺失、
  空副本（应用无效果）。启动宽限 60s + settings/llm 事件触发，同指引受
  `alertCooldownMs` 冷却。**只告警不写**：旧「出错时自动改写配置」实现因不稳定、
  常无效已移除，应用与回退操作交还给人。
- **journal 与告警**：一切动作写入自身数据文件
  （`$DSH_HOME/dsh-plus/lifeboat/state.json`，封顶 50 条；运行期状态不入
  settings），告警优先走
  notify-email 的 `sendNotice`，缺席降级为日志。
- **健康面板**（`src/client/health-tab.tsx`）：设置 → 插件 → 「救生艇」tab
  （官方 `settings.plugins.tab` 插槽）。展示官方应急副本状态卡片（路径/生成时间/
  覆盖 route/生成警告 + 应用指引）、已隔离插件
  卡片（两段确认「恢复」= 调 `POST /dsh-plus/lifeboat/restore` 移除用户 patch
  层的禁用覆盖；用户 patch 层热应用，恢复无需重启）、journal 时间线
  （kind 徽标着色：alert 红 / quarantine 橙 / restore 绿）。宿主面端点
  （`src/health-api.ts`）：`GET /dsh-plus/lifeboat/status` 与 restore。
  浏览器半哨兵保持零依赖铁律——健康页经惰性模块隔离加载（rolldown
  `__esmMin` 延迟初始化），UI 故障不拖垮哨兵。

## 边界

- 首次启动失败不可自动避免（客户端 boot 是 fail-loud 内核设计）；自动化的是恢复。
- lifeboat 自身故障时退化为手动恢复：编辑上述 patch 文件删除/添加 disabled 条目，
  或 `dsh plugin --profile web remove <pkg>`。
- 应急副本只读不写：lifeboat 不改任何 LLM 配置（自动改写实现已移除），指引文案
  给出人工应用步骤。
- 零 dsh-plus 内部依赖（不 import 本仓库其他包），防止共享代码故障团灭。

## 平台支持

- **Linux（web profile）**：完整能力，`profileContext.patchPath` 缺省生效。
- **桌面端（DSH Desktop）**：patch 落点取 `profileContext.patchPath`（写
  `$DSH_HOME/profiles/desktop/cordis.patch.yml`），隔离/恢复与 CLI 同语义；
  无 profileContext 的组合树停用隔离（告警提示，不写任何文件）。
- **Windows**：无平台特判需求（patch 写入经官方 dsh-atomic-write 原子落盘，
  Windows 瞬态重试覆盖杀软/编辑器占用）；告警依赖 notify-email 的 SMTP 可达性。
- 零 dsh-plus 内部依赖铁律不变；官方平台包（dsh-atomic-write/dsh-home-paths/
  dsh-app-boot 类型）按 peer 引用。
