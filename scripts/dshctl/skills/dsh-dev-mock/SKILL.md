---
name: dsh-dev-mock
description: 在 dsh-plus 仓库做零费用开发与 UI 调试时使用。用于一键启停 dev 实例（~/.dsh-dev + mock LLM + :3082）、无头调试（hl 直接跑任务看终答）、创建或连接 dev GUI 的 playwright 会话并转发截图/快照等浏览器命令、经 RPC 一键"选定工作区→会话→发消息"、向指定会话注入 mock 内容（回复/思考/工具调用/todo/斜杠命令）。只要任务涉及调试本仓库插件或 GUI、需要不产生真实 API 费用的会话数据、或要省去打开侧边栏/输入/点击的繁琐操作，就用本技能。
---

# dsh-dev-mock

dsh-plus 仓库的零费用调试闭环，统一入口 `scripts/dshctl.py`（下文统称 `dshctl`）。

**红线**：session/chat/mock/pw/hl 命令只准打 dev 实例（:3082），工具自带护栏，
不要把 `--port` 指向生产（3080/3081），不要绕过护栏。

## 标准闭环

```bash
cd <dsh-plus 仓库根目录>
dshctl dev up                                   # 构建 + 拉起 mock-llm 与 dev web（幂等）
dshctl chat -w <工作区路径> -m "消息" --wait     # dev 未启动会自动拉起
dshctl pw run -- screenshot --filename out.png  # 截图（浏览器命令原样转发）
```

## 常用任务速查

### 无头调试（不开浏览器，终答直接打终端）

```bash
dshctl hl 随便问点什么                                   # 回显模式
dshctl hl 转大写 --tool text_transform --args '{"text":"abc","op":"uppercase"}' --then "工具返回 ABC"
dshctl hl 场景名 --spec scene.json                     # 复杂场景
dshctl dev logs mock-llm                              # 排障：看 mock 收到的每次请求
```

### 一键发消息（免侧边栏/输入/点击）

```bash
dshctl chat -w /path/to/workspace -m "消息" [--new] [--wait] [--open]
dshctl session new --workspace <路径|标题> [--title 名]
dshctl session send <会话id前缀或标题子串> 消息...
dshctl session list [--workspace W]
```

### mock 会话内容（注入指定会话）

```bash
S=<会话id前缀或标题子串>
dshctl mock run --session $S --prompt "问题" --reply "终答" --thinking "思考过程"
dshctl mock run --session $S --tool text_transform --args '{"text":"abc","op":"uppercase"}' --then "工具返回 ABC"
dshctl mock run --session $S --todo "任务A;任务B" --todo-status in_progress --then "清单已生成"
dshctl mock run --session $S --command "/plan 做一个测试页面"
dshctl mock run --session $S --spec scene.json --title "场景名" --open
```

`--title` 建议常带（mock 会话标题是回显，难看）。注入内容 GUI 实时可见。

### 浏览器查看/截图/交互

```bash
dshctl pw open                       # 创建或连接会话（保持打开）
dshctl pw run -- snapshot            # 取元素 ref
dshctl pw run -- click e5            # 按 ref 交互
dshctl pw run -- screenshot --filename out.png [--full-page]
dshctl pw run -- resize 390 844      # 切视口
dshctl pw status / pw close
```

### dev 实例启停

```bash
dshctl dev up [--fast]     # 完整 up = 构建+重链+拉起；--fast 只拉起进程
dshctl dev restart [--fast]
dshctl dev down            # 一键停 mock-llm 与 dev web
dshctl dev status / dev logs [-n 行数]
```

改了 packages 源码必须完整 `dev up` 才生效。

## 深入细节

mock 条目完整语法（match/error/thinking）、spec 文件结构、故障排查表见
`references/commands.md`；仓库内部权威文档是 `docs/ops/开发实例与会话mock.md`（如随仓库分发）。

## 生产分发与回归（dsh-plus 仓库）

```bash
dshctl lint [--write]                             # test/finish 守门第 0 步
dshctl smoke-prod [--linker hoisted|isolated]    # 生产布局回归（不碰生产，零费用）
dshctl install-prod <包> [--dry-run] [--restart]
dshctl uninstall-prod <包>
dshctl doctor [--release]
```

红线：平台包（`@deepseek-ai/*`、`@earendil-works/pi-ai`）必须声明为
`peerDependencies` + `devDependencies` 双写，严禁进 `dependencies`
（事故沉淀见 `docs/repo/adr/0001`）。改依赖声明或 dsh rc 升级后必跑 `smoke-prod`。

## 注意

- mock 脚本队列是全局单文件，避免并发执行多个 `mock run`/`hl`。
- mock 的 match 是请求体原文子串匹配：prompt/match 里避免英文双引号和换行。
- 新会话首轮标题为回显属正常；用 `--title` 改名。
- 截图等产物统一落 `output/playwright/`（已 gitignore）。
- 成功输出已精简为一行；需要子命令原始输出时 `DSHCTL_VERBOSE=1`。
