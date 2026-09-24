---
last_modified: "2026-09-24 18:29"
---

# @dsh-plus/error-retry

把**按模糊模式匹配的特定 LLM 报错**纳入 dsh 上游重试——命中即放行，
重试本身（发送、指数退避、持久事件、次数预算、取消）**全部仍由官方
`@deepseek-ai/dsh-llm-retry` 执行**，本插件零重试机制、不发任何模型请求。

## 要解决的问题

上游 `dsh-llm-retry` 的 normal 模式只重试 `retryableCodes` 名单内的 code
（默认 `EMPTY_RESPONSE`、`RATE_LIMIT`、`SERVER`、`TIMEOUT`、`TRANSPORT`）。
名单外的失败**一次命中即终止轮次**，其中典型的是 pi-ai 适配器
`classifyPiAiError` 的兜底归类 `PI_AI_ERROR`——例如内容审核拦截时的

```
Provider finish_reason: content_filter
```

（注意是下划线 `content_filter`；模糊匹配对 `content-filter` 等写法均覆盖。）

原生近似能力是逐 provider 手工把 `PI_AI_ERROR` 加进
`retryPolicy.retryableCodes`，但它只能按 code 粗粒度纳入、需逐路由配置，
且 `PI_AI_ERROR` 是兜底 code，会连带重试全部未分类错误。本插件按
**报错消息**匹配，粒度到「哪种错误」，全 provider 生效，次数可配。

## 配置

```yaml
- name: '@dsh-plus/error-retry'
  config:
    enabled: true        # 总开关（false = 不注册监听，等价插件未安装）
    maxRetries: 5        # 匹配报错的重试次数上限（每次重试 = 一次计费请求）
    patterns:            # 命中 failure.message 即纳入重试；空数组 = 不匹配
      - content-filter   # 模糊子串：大小写不敏感，空格/连字符/下划线等价
      - /tim(?:ed)?\s*out/i  # /.../ 形式按正则解释（未带 i 时自动补 i）
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `enabled` | `true` | 总开关；false 时零副作用 |
| `maxRetries` | `5` | 匹配报错的重试次数上限（1–50；写入改写后策略的 `maxRetries`） |
| `patterns` | `["content-filter"]` | `failure.message` 匹配模式列表（见下） |

### 匹配语义

- **模糊子串形**（默认）：模式与消息统一「小写 + 空格/连字符/下划线折叠为
  单个 `_`」后做包含判断——`content-filter`、`CONTENT_FILTER`、
  `finish reason` 均可命中实际消息 `Provider finish_reason: content_filter`；
- **正则形**：`/source/flags`（以 `/` 起止且非空）；未携带 `i` 时自动补 `i`。
  正则语法错误在**插件装载期即抛错**（配置问题不静默）；
- 只匹配 `failure.message`，**不含 `code`**——code 是全大写下划线形态
  （如 `PI_AI_ERROR`），子串匹配极易误命中。

## 机制

本插件以 `prepend: true` 注册 `agent/request-error` waterfall 监听
（cordis 事件链中先于 `dsh-llm-retry` 执行），命中模式时：

1. **只改写载荷的 `retryPolicy` 引用**：原策略对象 `Object.freeze`，改写是
   spread 出的新副本——`retryableCodes` 并入 `failure.code`（Set 去重、
   顺序确定），`maxRetries` 取插件配置，backoff 三元组原样保留；
2. `failure` 本身**绝不改写**（原始失败事实与 `llm/retry` 事件记录不受影响）；
3. 随即 `next()`——此后的退避计算、`llm/retry`/`llm/retry-started` 持久事件、
   会话投影内的次数预算、可取消等待，全部仍由上游 `dsh-llm-retry` 执行。

改写是 `(原策略, code, 模式, 次数)` 的纯函数 → 同一失败反复到达时产出相同的
`retryPolicyKey`（上游以 `(provider, policyKey)` 为键计数），**次数预算跨
attempt 正确累积**，耗尽后由上游 `next()` 走 `LlmError` 终态收口。

### 旁路（上游行为原样不变）

| 场景 | 原因 |
|---|---|
| 模式未命中 | 不属于「特定报错」 |
| `retryPolicy` 缺席 | 适配器选择前的失败，无 provider 策略可挂靠 |
| `mode: always` | 上游本就无条件重试一切 |
| `code` 已在 `retryableCodes` | 上游预算已覆盖，不越权改上游次数 |
| `enabled: false` | 等价插件缺席 |

## 失败与恢复

- 本插件**依赖 `@deepseek-ai/dsh-llm-retry` 已挂载**（默认 `dsh-base` 层已含）；
  上游缺席时改写无人执行，行为退回现状（不重试），不会报错。
- 每次重试都是一次**新的 provider 请求**（重复输入 token 计费）；用
  `maxRetries` 与模式列表控制成本，默认 5 次对齐上游 normal 模式默认值。
- 模式写得过宽（如裸 `error`）可能连带命中不该重试的失败（认证、配额、
  无效请求）——按消息特征精确书写。
- 重试事件、延迟、提供方错误对模型不可见；失败分片绝不进入派生消息
  （上游 llm-retry 的既有语义，本插件不改变）。

## 已知限制

- 只覆盖经 agent loop 的轮次请求；直接 `ctx.llm.stream()` 调用仍是单次尝试
  （上游 llm-retry 的既有边界）。
- 改写以载荷就地 mutation 完成，依赖 cordis waterfall 同引用传递与
  `prepend` 次序；上游若改为此事件引入载荷深拷贝，需同步调整本插件
  （单测的 `prepend` 断言可捕获次序回归）。
