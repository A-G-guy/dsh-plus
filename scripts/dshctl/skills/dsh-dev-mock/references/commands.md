# dsh-dev-mock 参考细节

SKILL.md 的展开版：mock 条目语法、spec 结构、故障排查。仓库内部权威文档
（如随仓库分发）：`docs/ops/开发实例与会话mock.md`。

## mock 脚本条目语法

`mock run`/`hl` 的便捷参数最终都会落成下述条目（spec 文件的 `entries`
数组元素同构）：

```json
{"match": "子串", "content": "脚本化终答", "thinking": "可选：思考内容"}
{"match": "子串", "tool_calls": [{"name": "工具名", "arguments": {"k": "v"}}]}
{"error": {"status": 400, "message": "模拟模型请求失败"}}
```

- `match`：对请求体**原文**的子串匹配，命中才消费该条目；不带 match 匹配
  任意请求。prompt/match 里避免英文双引号、反斜杠、换行（JSON 转义会破坏
  命中）。
- `thinking`：GUI 渲染为 Think 块。
- `tool_calls`：工具由 dsh 真实执行，结果回传后触发下一轮模型请求——通常
  需要第二条 `content` 条目接住（`--then`）。
- 会话标题请求永不消费脚本条目，只回显。

## spec 文件结构（mock run --spec / hl --spec）

```json
{
  "prompt": "触发该轮的用户消息",
  "entries": [ {"match": "...", "tool_calls": [...]}, {"content": "..."} ],
  "title": "完成后重命名会话（仅 mock run）",
  "marker": "完成后校验的子串"
}
```

`prompt`/`title`/`marker` 可省：prompt 缺省自动生成占位文本；marker 缺省取
末条 content 的前 40 字符。

## 故障排查

| 现象 | 排查 |
|---|---|
| RPC 连接拒绝/实例未监听 | `dshctl dev status`；会话类命令会自动拉起，仍失败则 `dshctl dev up` |
| mock 卡住直到超时 | `dshctl dev logs mock-llm`；多半是 match 未命中（检查引号/换行） |
| marker 校验失败 | 条目被别的请求抢走（避免并发 mock run/hl）或 match 未命中，重跑 |
| 标题是 `[mock] Generate the session title...` | 标题走回显属正常；`--title` 改名 |
| `session open` 没选中 | 无标题会话无法在侧边栏按文本定位，先改名或手动点击 |
| pw status 显示会话不存在 | 浏览器会话已被关闭，`pw open` 重建即可 |
| `pw run` 报元素 ref 失效 | 重新 `pw run -- snapshot` 取最新 ref |
