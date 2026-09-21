# scripts/：search-services skill Python 脚本的项目维护副本

本目录是从 `~/.dsh/skills/search-services/scripts/` **原样复制**的单向副本
（标准库实现，无第三方依赖），供 `@dsh-plus/web-search-services` 插件经
`python3 search.py search ...` 子进程桥接调用。**skill 本体不受本仓维护影响。**

## 为什么是 Python 桥接（特例声明）

> **本插件是特例，不是先例。** dsh-plus 集成外部 HTTP 服务（provider、工具、
> webhook 等）**默认直接用 TS 原生实现**（进程内 fetch、编译期契约、无进程边界）。
> 仅当需求明确要求复用一套已存在、持续维护、且逻辑非平凡的外部编排
> （本例：search-services skill 的链内 fallback、`TAVILY_API_KEYS` 多 key
> 轮转、intent 服务链、per-service 参数细节）时，才允许整体桥接其脚本，
> 把外部实现当作单一事实源，本仓只维护「dsh-web 契约 ↔ CLI」薄适配层。

判定标准（新增集成时自检）：

1. 外部逻辑是否已在维护中且有独立演进（skill/CLI 工具）？——否则 TS 原生重写更便宜。
2. 桥接节省的是否是**编排逻辑**而非一个 POST 请求？——单接口直调一律 TS 原生。
3. 失败域、超时、密钥注入是否都能在薄适配层兜住？——兜不住则不桥接。

## 同步策略

- **单向**：skill → 本目录。skill 升级后人工比对同步（diff 后整体覆盖），
  不做自动同步、不做双向回写；本目录的定向修改（如有）须注释 `dsh-plus:`
  标记并记录在下表。
- 同步时复核文件清单：`search.py fetch.py fetch_playwright.py env_loader.py
  openai_chat.py context7.py exa.py tavily.py`（`__pycache__` 不入仓）。

## 本仓定向修改记录

| 日期 | 文件 | 修改 | 原因 |
|---|---|---|---|
| — | — | 暂无（verbatim 副本） | — |
