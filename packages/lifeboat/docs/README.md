---
last_modified: "2026-08-22 01:13"
---

# @dsh-plus/lifeboat 文档索引

故障救生艇：dsh 破坏性更新导致兄弟插件无法加载时的自动止血。

## 机制

- **故障隔离**（`src/quarantine.ts`）：监听 `internal/status` fiber FAILED 转移
  （host 侧直接监听；浏览器侧由 `src/client/client.ts` 哨兵经
  `POST /dsh-plus/lifeboat/quarantine` 回报），向 profile 用户 patch 层
  （默认 `$DSH_HOME/profiles/web/cordis.patch.yml`，行级 config `patchFile` 可覆盖）
  追加 `{id, disabled: true}`。只处理 `dsh-plus-` 前缀，排除自身与 bundle-main。
  写入幂等、先备份（`.lifeboat.bak`）、原子落盘。隔离时摘录 fiber 的失败原因
  （`fiber._error`，截断 500 字符）进 journal 与告警正文——dsh 的插件 logger
  不落 stdout，无此摘录则故障根因不可见。
- **LLM 应急翻译**（`src/fallback-llm.ts`）：默认模型 provider 无已注册 adapter 时，
  读 settings.yaml 的 `dsh-plus-llm-pi` 段（只读），翻译为官方 `llm-pi-ai`
  原生格式（键加 `-fb` 后缀防 DUPLICATE_ADAPTER），切换 `agent-default-model`；
  源 provider 恢复后按 journal 自动还原。协议推断为启发式（显式 api > 路由名 >
  模型继承源 > openai-completions）。
- **journal 与告警**：一切动作写入自身 settings 命名空间 `dsh-plus-lifeboat`
  （封顶 50 条），告警优先走 notify-email 的 `sendNotice`，缺席降级为日志。

## 边界

- 首次启动失败不可自动避免（客户端 boot 是 fail-loud 内核设计）；自动化的是恢复。
- lifeboat 自身故障时退化为手动恢复：编辑上述 patch 文件删除/添加 disabled 条目，
  或 `dsh plugin --profile web remove <pkg>`。
- 零 dsh-plus 内部依赖（不 import 本仓库其他包），防止共享代码故障团灭。
