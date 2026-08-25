---
last_modified: "2026-08-25 11:28"
---

# @dsh-plus/web-terminal

DSH Web GUI 内嵌的持久化终端工作台插件：多会话（标签）、桌面分屏（可拖拽
分割条）、scrollback 回放，会话在 dsh 运行期间保活（关闭面板/浏览器仅
detach，重开自动回放并续接，类 tmux detach/attach）。

## 选型记录（为什么不复用官方 ctx.terminals）

官方 `@deepseek-ai/dsh-terminal`（+ `dsh-terminal-bash`）是**面向模型**的
PTY 接缝，对人类交互终端不可用：

- 强制 `TERM=dumb`、`NO_COLOR`、劫持 `PS1` 为受控提示符（模型友好，人不可用）；
- 会话必须挂靠**存活的 Agent owner**（`isLiveOwner` 逐操作校验），人类会话
  无此实体；
- handle 无 resize（分屏必需）；
- web profile 组合树根本没有这些行（仅 subprocess 底座在）。

因此本插件经 `node-pty` 直连孵化真实交互 shell（`TERM=xterm-256color`、
加载用户 rc 文件），并以 peer 依赖复用宿主安装树的单实例
（`~/.dsh/profiles/node_modules/node-pty` fallback symlink，ADR 0001 同机制；
dshctl 的平台包运行时依赖守卫不受影响——node-pty/ws 不在
`PLATFORM_TOP_SCOPES` 白名单）。

## 契约

- node 半 `src/index.ts`：`ctx.inject(['webServer'])` 后二级
  `inject(['webTerminal'])` 注册路由（Service init 完成后才能读
  `ctx.webTerminal`，否则 `cannot get without inject`——dev 实测教训，
  lifeboat 会把该错误自动隔离）。
- 会话语义在 `src/registry.ts`（`WebTerminalService`，ctx key
  `webTerminal`）+ `src/session.ts`（单会话：pty + scrollback 环形缓冲 +
  事件扇出）+ `src/scrollback.ts`（行数/字节双上限，整行淘汰保证 replay
  永远从行边界开始）。
- PTY 适配 `src/pty.ts`：node-pty 薄封装为 `PtyLike` 接口（registry 依赖
  抽象，测试注入 FakePty）。
- 环境：官方 `scrubbedParentEnv()`（自 `@deepseek-ai/dsh-subprocess` 导入，
  凭据清洗单一来源）→ `TERM=xterm-256color` / `COLORTERM=truecolor` →
  用户配置 env 覆盖。
- 浏览器半 `src/client.tsx`：`dsh.client` 声明装载，注册
  `sidebar.footer.action` 入口 + `shell.overlay` 面板 + `settings.plugin.item`
  配置卡片（key = settings ns `dsh-plus-web-terminal`，经官方 settings RPC）。
- 分屏布局 `src/panel/layout.ts` 纯函数（tab 内二叉分割树；单测覆盖）；
  拖拽调宽的兄弟配对语义见 tests（sessionId 所在叶 vs 相邻 siblingIndex）。
- xterm 主题从 `--dsw-*` 令牌读取（`getComputedStyle`），监听 `html` 元素
  属性变化随深浅色切换热更新；xterm 基础结构样式冻结于 `src/xterm-css.ts`
  （宿主只服务 client.js 单文件，不能依赖独立 style.css 产物）。
- 响应式：断点 767px（与 ui-mobile-fit 对齐），移动端 Modal 全屏、隐藏
  分割条、仅焦点叶可见（点击叶切换焦点）。

## HTTP / WS 端点（`src/protocol.ts` 为线协议单一事实源）

| 端点 | 方法 | 语义 |
|---|---|---|
| `/create` | POST JSON | 创建会话（name/cwd 可选；超 maxSessions 429） |
| `/list` | POST | 会话列表 + maxSessions |
| `/kill` | POST JSON | 杀会话（TERM → killGraceMs → KILL） |
| `/rename` | POST JSON | 改显示名（1-64 可打印字符） |
| `/ws` | WebSocket | 单连接多路复用全部会话 |

WS 消息（JSON 文本帧）：

- C→S：`attach{sessionId}` / `detach{sessionId}` / `input{sessionId,data}`
  / `resize{sessionId,cols,rows}`
- S→C：`attached{session,replay}` / `detached` / `output{sessionId,data}`
  / `exit{sessionId,exitCode,signal}` / `sessions{sessions,maxSessions}`
  / `error{message,code}`
- 背压：socket 缓冲 > 2MB 丢弃该连接 output 帧并告警（scrollback 仍在，
  重连重放自愈）；input 单条 ≤ 256KB；resize 钳制 [2,500]。

普通 GET 到 `/ws` 返回 426（对齐官方语义）。

## 配置（settings ns `dsh-plus-web-terminal`，webui 卡片热生效）

| 键 | 默认 | 说明 |
|---|---|---|
| enabled | true | 总开关（false：REST 503、WS 升级拒绝） |
| shellPath | '' | 空 = `$SHELL` 或 `/bin/bash` |
| shellArgs | [] | 附加参数 |
| cwd | '' | 空 = 家目录；非绝对路径回退家目录 |
| env | {} | 额外环境变量（清洗后合并，可覆盖 TERM） |
| initialCols / initialRows | 120 / 32 | 首次挂载前孵化尺寸 |
| scrollbackLines | 10000 | 每会话保留行数 |
| scrollbackMaxKb | 4096 | 每会话 scrollback 字节上限 |
| maxSessions | 8 | 并发上限（1-64） |
| idleTimeoutMs | 1800000 | 空闲清理（0 禁用） |
| killGraceMs | 2000 | TERM→KILL 宽限 |

## 行为细节

- **空闲清扫**（30s 扫描）：仅当「零挂载 且 距最近输入/输出超时」才杀；
  挂后台跑构建的会话因持续输出而保留；面板关闭仅 detach 不杀。
- **生命周期**：会话存活于 dsh 进程生命周期；disposal 全杀（TERM→KILL），
  另挂 `process 'exit'` 同步 SIGKILL 兜底（对齐 dsh-subprocess-local 语义）。
- **多端 attach**：同一会话可多连接挂载，输出扇出；尺寸冲突
  last-writer-wins（tmux 同款语义）。
- **面板重开**：优先接管最近活动的存活会话（类 tmux attach），无会话才新建。

## 安全

- 每请求/升级先过 `web-terminal/access` serial 事件接缝（监听器抛错即拒，
  同 web-files 模式，供统一安全插件）。
- Origin/Host 一致性校验（携带 Origin 的请求 authority 必须 === Host，
  防 DNS rebinding 与跨站 WS）——终端是 RCE 级暴露面，比 web-files 更严。
- REST 端点校验 `content-type: application/json`。
- 生产暴露面由 access-gate 围栏统一覆盖（upgrade 路由会被其自动包装）。
- 本插件不做鉴权：终端以 dsh 进程权限运行（同 web-files 写操作面）。

## 测试

`tests/scrollback.test.ts`（双上限淘汰/整行边界/残行缝合）、
`tests/layout.test.ts`（分割/塌缩/焦点环绕/钳制）、`tests/registry.test.ts`
（FakePty：创建/上限/扇出/空闲清扫/kill 阶梯/disposal）。
禁网络、零 API 费用。

## 已知限制

- dsh 重启后会话不复活（用户需求明确限定「dsh 运行期间保活」）。
- Ctrl-C 走 xterm 默认 `\x03` 字节注入；自定义信号投递 API 留待后续。
- 官方 `ctx.terminals` 若未来提供面向人类的 backend + resize，可迁移
  （PtyFactory 接缝已按此收敛）。
