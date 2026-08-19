---
last_modified: "2026-08-19 17:23"
---

# @dsh-plus/reload 文档

内置重新加载：插件开发/安装完成后，不必再手动跑 `dshctl restart-prod`——
设置页「重新加载」按钮（General 段）与 `/reload` 命令，两段确认 + 可取消
倒计时后重启 systemd 托管的 dsh-web，服务恢复后浏览器自动刷新（新 bundle 生效），
会话不丢失（dsh 既有持久化）。

## 机制

- **host 半**（`src/`）：
  - `preflight.ts` — 重启预检：本进程必须是 systemd 单元主进程
    （`systemctl show -p MainPID` 与 `process.pid` 匹配，INVOCATION_ID/cgroup
    会被子进程继承、不可作判据）、单元 active、`sudo -n true` 通过。任一失败
    拒绝调度并列出原因。
  - `scheduler.ts` — 状态机 `idle → prepared → scheduled`：`prepare` 签发
    一次性 TTL token；`confirm(token, {force, runningAgents})` 在 running
    会话 >0 且未 force 时拒绝（409，token 保留可携同 token force 重试）；
    成功后缓冲 `serverGraceMs` 再 detached 执行
    `sudo systemctl restart --no-block <unit>`（`--no-block` 只向 PID1 投递
    作业即返回，本进程随后被 SIGTERM 不影响拉起）；缓冲期内可 cancel。
  - `routes.ts` — `/dsh-plus/reload` 四端点：`GET health`（bootId，供客户端
    轮询）、`POST prepare`、`POST confirm`、`POST cancel`。暴露面与 GUI 其余
    部分同级（默认 loopback），token + 两阶段确认构成防误触/防重放边界。
  - `command.ts` — `/reload`（预检→调度）、`/reload force`、`/reload cancel`、
    `/reload status`；经官方 commands 注册表分发，结果直渲 UI、不进模型上下文。
  - `agents.ts` — `ctx.agents.list()` 中 status=running 的计数；agents 服务
    缺席降级为 0。
- **client 半**（`src/client/`）：`settings.general.item` 插槽注册「重新加载」
  行；流程 prepare → 可取消倒计时（有 running 会话时归零不自动确认，须点
  「仍然重启」）→ confirm → 轮询 health 直至 bootId 变化 → `location.reload()`；
  超时（默认 30s）给出人工排查指引。多标签页经 localStorage 标记联动，
  其他标签页自动接力轮询刷新。

## 配置（行级，`dsh` 组合层可覆盖）

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关（按钮与命令同时生效/隐藏） |
| `unitName` | `dsh-web` | systemd 单元名 |
| `clientCountdownSeconds` | `5` | 客户端倒计时秒数 |
| `confirmTokenTtlMs` | `60000` | 一次性 token 有效期 |
| `serverGraceMs` | `800` | confirm 后到执行重启的缓冲（响应落盘/取消窗口） |
| `clientPollTimeoutMs` | `30000` | 客户端等待服务恢复的轮询超时 |

## 边界

- **非托管环境拒绝执行**：dev 实例（`dshctl dev up`，非 prod 单元主进程）、
  从服务内 shell 手动拉起的进程，preflight 一律拒绝并提示改用
  `dshctl restart-prod`；这是特性而非缺陷。
- 命令路径的 cancel 为本地可信面（无 token），HTTP 面必须持 token。
- 与 lifeboat 的关系：无代码联动——重启后若兄弟插件加载失败，lifeboat 既有
  隔离+告警机制自动止血；reload 自身亦在其 `dsh-plus-*` 守护范围内。
- 重启仅由 systemd 拉起保证；若单元被 stop 而非 restart，服务不会自动回来。
- 多标签页中任一页发起重启，其余页会跟随刷新；无痕/禁用 localStorage 的页面
  只刷新自己。
