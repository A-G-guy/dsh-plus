---
last_modified: "2026-10-02 22:40"
description: "ADR 0003：搜索 provider 默认 TS 原生，Python 桥接为例外"
---

# ADR 0003：搜索 provider 默认 TS 原生，Python 桥接为例外

- 状态：已采纳（2026-09-21）
- 背景事件：新增 `@dsh-plus/web-search-services`，经官方 `ctx.web` provider
  扩展点把 `web_search` 桥接到 search-services skill 的 Python 脚本
  （Tavily / Exa / OpenAI Chat 免费额度后端）。

## 背景

DSH 官方 web 搜索 provider（`deepseek-official`）按完整模型轮次计费。本机已有
search-services skill，维护了相当规模的搜索编排逻辑：链内 fallback、
`TAVILY_API_KEYS` 多 key 轮转、intent 服务链、per-service 参数细节
（约 4100 行 Python，标准库实现，持续使用演进中）。

## 决定

1. **默认 TS 原生**：dsh-plus 集成外部 HTTP 服务（provider / 工具 / webhook）
   默认在插件进程内用 fetch 直连，保持编译期契约、最低延迟、无进程边界。
2. **Python 桥接是例外，不是先例**：仅当需求明确要求复用一套已存在、持续维护、
   且逻辑非平凡的外部编排时，才允许整体桥接其脚本；本仓为此维护其单向副本
   （`packages/web-search-services/scripts/`，随包分发），外部实现仍是单一
   事实源，插件只维护「dsh-web 契约 ↔ CLI」薄适配层。
3. **例外判定标准**（新增集成时自检，三者缺一不可）：
   - 外部逻辑已在维护中且有独立演进（skill / CLI 工具），非一次性脚本；
   - 桥接节省的是**编排逻辑**而非单个 POST 请求——单接口直调一律 TS 原生；
   - 失败域、超时、密钥注入都能在薄适配层兜住（子进程隔离、杀进程组、
     env 注入、JSON 归一化容差）。
4. **标注义务**：采用桥接的插件必须在包 docs 与 `scripts/README.md` 声明
   特例身份、判定依据与同步策略；违反默认方向而不声明视为评审阻塞项。

## 后果

- `@dsh-plus/web-search-services` 成为当前唯一的桥接插件；后续新增搜索/
  抓取类集成优先评估 TS 原生（如仅需 Tavily 单后端 + 简单重试，应直接
  fetch，不引入 Python 进程）。
- skill 升级后对 vendored 副本做人工 diff 同步（单向，不回写 skill）。
