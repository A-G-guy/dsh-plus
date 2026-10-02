---
last_modified: "2026-10-01 20:52"
description: "开发实例与会话 mock"
---

# 开发实例与会话 mock

dshctl 的零费用调试体系：dev 实例（`~/.dsh-dev` + 本机 mock LLM + :3082）之上，
经 RPC 与 playwright 会话完成一键操作与会话内容注入。本文是命令手册。

## dev 实例启停

```bash
dshctl.py dev init            # 首次：初始化 dev home 与 profile
dshctl.py dev up              # 构建 + 重链 workspace 包 + 拉起 mock-llm 与 dev web
dshctl.py dev up --fast       # 只拉起进程（改了 packages 源码必须完整 up）
dshctl.py dev restart [--fast]
dshctl.py dev down            # 一键停 mock-llm 与 dev web
dshctl.py dev status
dshctl.py dev logs [mock-llm|dsh-web-dev] [-n 行数]   # 缺省两个都打
```

会话类命令（session/chat/mock/pw）在 dev 未启动时自动按 fast 路径拉起；
headless 类命令（hl/smoke/seed）自动拉起 mock-llm。

## 无头调试（hl）

不开 web 实例、不经浏览器：headless profile 直接跑一轮任务，终答打印到终端。

```bash
dshctl.py hl <任务...>                                # 回显模式（不带内容参数）
dshctl.py hl 转大写 --tool text_transform \
    --args '{"text":"abc","op":"uppercase"}' --then "工具返回 ABC"
dshctl.py hl 问点什么 --reply "脚本化终答" --thinking "思考过程"
dshctl.py hl 清单 --todo "任务A;任务B" --then "已生成"
dshctl.py hl --spec scene.json
```

内容参数（`--reply/--thinking/--tool/--args/--then/--todo/--todo-status/
--match/--then-match/--marker/--spec`）与 `mock run` 完全一致。
排障：`dshctl.py dev logs mock-llm` 可见 mock 收到的每次请求及可见工具名单。

## 会话/工作区操作（免 DOM 点击）

```bash
dshctl.py session list [--workspace 工作区]
dshctl.py session new --workspace <路径|标题> [--title 名]
dshctl.py session send <会话> 消息...           # 会话按 id 前缀或标题子串寻址
dshctl.py session open <会话>                   # 在 pw 浏览器会话中定位选中
dshctl.py chat -w <工作区> -m "消息" [--new] [--wait] [--open]
```

`chat` = 解析/创建工作区 → 取该工作区最新会话（`--new` 强制新建）→ 发送消息
→ `--wait` 等待执行完毕 → `--open` 浏览器定位。

## 会话内容 mock

```bash
dshctl.py mock run --session <会话> --prompt "问点什么" --reply "脚本化终答" \
    --thinking "模型的思考过程"
dshctl.py mock run --session <会话> --tool text_transform \
    --args '{"text":"abc","op":"uppercase"}' --then "工具返回了 ABC"
dshctl.py mock run --session <会话> --todo "任务A;任务B" --todo-status in_progress
dshctl.py mock run --session <会话> --command "/plan 做一个测试页面"
dshctl.py mock run --session <会话> --spec scene.json --title "场景名" --open
```

spec JSON 形如 `{"prompt": "...", "entries": [<mock 条目>...], "title": "...",
"marker": "..."}`。mock 条目语法：

- `{"match": "<子串>", "content": "..."}`：match 是请求体原文子串才消费该条目
- `{"tool_calls": [{"name": ..., "arguments": {...}}]}`：工具由 dsh 真实执行，
  结果回传后再触发一轮模型请求（用 `--then` 或第二条 content 条目接住）
- `{"thinking": "..."}`：GUI 渲染为模型思考块
- `{"error": {"status": 400, "message": "..."}}`：模拟模型请求失败
- 会话标题请求永不消费脚本条目，只回显——标题通常很难看，建议 `--title` 改名

## playwright 会话

```bash
dshctl.py pw open                 # 创建或连接 dev GUI 的浏览器会话（保持打开）
dshctl.py pw status / pw close
dshctl.py pw run -- <任意 playwright-cli 命令>   # 会话不存在则自动创建
```

常用：`pw run -- snapshot`（取元素 ref）、`pw run -- click e5`、
`pw run -- screenshot --filename out.png [--full-page]`（截图产物建议落
`output/playwright/`）、`pw run -- resize 390 844`（切视口）、
`pw run -- tracing-start/-stop`（UI 流程追踪）。

## 输出约定

- 成功：每命令一行；长命令输出摘要在 stderr（`✔ <命令> (耗时)`）。
- 警告/报错：按行原文汇总（完全相同的行去重并标注 ×N），完整输出落
  系统临时目录 `dshctl-logs/` 并提示路径。
- 需要子命令原始输出全文：`DSHCTL_VERBOSE=1`。

## 红线与护栏

- RPC 端口为生产端口（3080/3081）一律拒绝。
- 会触发模型调用的命令（session send / chat / mock run）先校验目标实例默认
  模型是本机 mock（`deepseek/deepseek-v4-flash`），否则拒绝。若修改 dev
  settings.yaml 的默认模型，需同步 `scripts/dshctl/rpc.py` 的
  MOCK_PROVIDER/MOCK_MODEL。
- mock 脚本队列是全局单文件（`~/.dsh-dev/run/mock-script.jsonl`），并发执行
  多个 mock run/hl 会互相抢条目。
- match 是请求体原文子串匹配：prompt/match 中避免引号/换行。

## 故障排查

| 现象 | 排查 |
|---|---|
| RPC 连接拒绝 | `dshctl.py dev status` 确认 dev 实例在跑 |
| mock 无响应/超时 | `dshctl.py dev logs mock-llm`；match 是否命中请求体 |
| 会话标题是 `[mock] Generate the session title...` | 标题走回显属正常，用 `--title` 改名 |
| marker 校验失败 | match 未命中或条目被抢占，重跑并避开并发 |
| pw 定位不到会话 | 侧边栏 treeitem 按标题文本匹配；无标题会话请先 `--title` 或手动点击 |
