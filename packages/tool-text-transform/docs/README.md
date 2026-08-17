---
last_modified: "2026-08-17 16:37"
---

# @dsh-plus/tool-text-transform

纯函数演示工具插件：注册 `text_transform` 工具（uppercase/lowercase/reverse/length）。
无网络、无文件副作用，用作本仓库插件链路（注册 → 构建 → link → 加载 → 调用）的
参考实现与冒烟对象。

**dev-only**：本包不登记进 bundle-main，不随 bundle 进生产（避免无效占用模型上下文）；
仅在开发时经 profile 的 `cordis.patch.yml` 用户补丁层注入（`dsh plugin add link:<路径>`）。

## 工具契约

- 参数：`text: string`（必填）、`op: uppercase|lowercase|reverse|length`（必填）。
- 输出：`{ result: string }`；`reverse`/`length` 按 Unicode code point 处理。
- `timeoutMs: 5000`，`isConcurrencySafe: true`（纯函数，可并行）。

## 开发

- 纯逻辑在 `@dsh-plus/shared`（`transformText`），本包只做注册与边界声明。
- 测试：`tests/tool.test.ts`（fake ctx 断言注册形状与执行结果）。
