---
last_modified: "2026-08-24 16:17"
---

# @dsh-plus/notify-email

任务结束邮件通知插件：在 agent 停止工作的三类时机，用配置的 SMTP 邮箱向指定
收件人发送邮件。service+ui 混合插件（node 半编排通知，浏览器半提供配置卡片）。

## 触发时机与邮件内容

| 时机 | 观察点 | 邮件内容 | 默认开关 |
|---|---|---|---|
| 任务执行完毕 | `session/event` 的 `turn/end`（kind=completed）+ 空闲防抖 | 该会话最后一条 assistant 交付消息 | 开 |
| 提问等待回答 | `tools/pre-execute` 观察 `ask_user_question` | 问题全文 + 选项列表 | 开 |
| Plan 待审批 | `tools/pre-execute` 观察 `exit_plan_mode` | plan 全文 | 开 |
| 报错/失败停止 | `turn/end`（kind=error） | 错误信息 | 开 |
| 被用户取消 | `turn/end`（kind=aborted） | 仅原因 | 关 |

机制要点：

- **只通知 runtime root agent**（`ctx.agents.roots()` 判定），子代理会话不触发。
- 完成类通知经 `idleDebounceMs`（默认 3000）防抖：窗口内新 `turn/start` 到达
  则取消（goal 续轮、followup 排队不误报）；触发时 agent 非 idle 或 inbox 仍有
  待处理消息则跳过。按 `session:turn:kind` 去重。
- `blocked` / `max-tokens` / `interrupted`（crash 恢复标记）不通知。
- 决策类观察是 `tools/pre-execute` waterfall 的纯旁观（原样 `next()`），按
  `callId` 去重（按 sessionId 分桶，会话销毁即释放桶，长时间运行无累积）；
  发送异步进行，绝不拖慢工具闸门。
- 发送失败只记日志与审计，永不影响 agent 循环。

## 配置

cordis 行级 `Config`（组合默认值）与 settings namespace `dsh-plus-notify-email`
（用户层）共用同一 schemastery schema（`src/config.ts` 单一事实源）。用户层经
dsh-settings-file 持久化到 `$DSH_HOME/settings.yaml`，热生效。

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | false | 总开关 |
| `smtp.host/port/secure/user/pass/from` | 465/TLS | SMTP 参数；`pass` 为 secret 角色，任何读取通道不回传（卡片提交空串 = 保持不变） |
| `to` | [] | 收件邮箱列表 |
| `triggers.onComplete/onError/onAborted/onQuestion/onPlanReview` | 见上表 | 分时机开关 |
| `idleDebounceMs` | 3000 | 完成类通知的空闲确认窗口 |
| `maxBodyChars` | 4000 | 邮件正文截断长度 |
| `dryRun` | false | 仅记录不真实发送（dev profile 补丁层置 true） |

## WebUI 配置卡片

浏览器半注册进官方 `settings.plugin.item` 插槽（设置 → 插件 → 插件配置），
视觉与交互对齐官方卡片（staged draft、保存/放弃），另加「发送测试邮件」。
dsh rc7 起该插槽为 **keyed** 槽位：卡片以本插件 settings 命名空间
（`dsh-plus-notify-email`，字面量统一在 `src/ns.ts`）为 key 注册，官方配置页
按 key 与 Host 已注册命名空间配对分发。

**配置传输**：dsh rc7 起白名单已移除、全部已注册命名空间对 `settings.*` RPC
开放，卡片读写直接走官方 **settingsScope** 传输（浏览器半 `settingsScope.bind`
绑定命名空间 + `connection.api.settings` 读写；pass 为 secret 角色，value 恒
脱敏，是否已配置经 describe 的 `secrets` 列表探测；空 pass 提交 = 保持不变）。
自定义端点仅剩「发送测试邮件」（node 半经 `ctx.webServer.register` 注册）：

- `POST /dsh-plus/notify-email/test` — 发送测试邮件（绕过 enabled 门禁）

## 投递审计

每次发送尝试（含 disabled/incomplete 跳过与失败）追加一行 JSONL 到
`$DSH_HOME/logs/notify-email.jsonl`：时间、主题、收件人、结果、正文摘录
（≤2000 字符，永不含凭据）。dev 实例 logger 不落盘，审计文件是 dry-run
的主要可观测面。

## 第三方扩展接口

```ts
ctx.inject(['notifyEmail'], (ctx) => {
  ctx.notifyEmail.registerTrigger({
    id: 'my-plugin-trigger',
    // 决策类：工具调用即将阻塞等待用户时
    onDecision: (call) => call.name === 'my_tool'
      ? { subject: '...', text: '...' } : undefined,
    // 任务停止类：root agent turn 结束且空闲防抖后
    onTurnEnd: (info) => info.kind === 'completed'
      ? { subject: '...', text: '...' } : undefined,
  })
})
```

首个返回非空 `EmailNotice` 的触发器被投递；返回 `undefined` 表示不关心。
内置官方适配器（`src/triggers/builtin.ts`）经同一接口注册，无特权路径。
触发器抛错只告警，不影响其余触发器与 agent 循环。重复 id 注册抛错。

## 开发与验证

```bash
pnpm --filter @dsh-plus/notify-email build           # 双入口构建
pnpm --filter @dsh-plus/notify-email watch           # 浏览器半 HMR
node --test packages/notify-email/tests/*.test.ts      # 单元测试（纯逻辑，无网络）
```

联调建议用独立 `DSH_HOME` 的 dev 实例：补丁层覆盖 `{ enabled: true, dryRun: true }`
（只记录不真发），触发后查验 `$DSH_HOME/logs/notify-email.jsonl`。
