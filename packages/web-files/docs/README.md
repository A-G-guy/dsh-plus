---
last_modified: "2026-08-24 01:27"
---

# @dsh-plus/web-files

DSH Web GUI 内嵌的类 SFTP 文件浏览与编辑插件。面向远程/移动端访问场景：
此时 `host.openPath`（xdg-open 本地编辑器接力）在无桌面环境必然失败，
本插件提供浏览器内的全文件系统浏览、预览与编辑作为替代入口。

## 契约

- node 半 `src/index.ts`：`ctx.inject(['webServer'])` 后注册
  `/dsh-plus/web-files` 前缀路由（`src/files-api.ts`），文件语义在
  `src/fs-core.ts`（纯 node:fs/promises，可脱离 HTTP 单测）。
- 浏览器半 `src/client.tsx`：`dsh.client` 声明装载，注册
  `sidebar.footer.action` 入口按钮与 `shell.overlay` 常驻面板；
  react / primitives / slots 为构建期 external（平台模块表供给），
  CodeMirror 及精选语言包静态内联（宿主只服务 client.js 单文件，
  禁止动态分包，见 tsdown.config.ts）。
- 样式 `src/styles.ts`：构建期内联字符串 + `data-plugin` /
  `data-plugin-css` style 标签约定（HMR 可卸载）；全部颜色引用
  `--dsw-*` 设计令牌，深浅色主题零成本跟随；断点 767px 与
  ui-mobile-fit 对齐，移动端为全屏抽屉 + 列表/编辑单栏切换。
- i18n：命名空间 `dsh-plus-web-files` 合并进 LocaleNamespaceMap
  （`src/panel/types.ts`），zh/en 字典在 `src/locales.ts`。

## HTTP 端点（`src/protocol.ts` 为线协议单一事实源）

| 端点 | 方法 | 语义 |
|---|---|---|
| `/list` | POST | 单层列举：目录优先排序、hidden 标记、crumbs、超 2000 截断 |
| `/read` | POST | UTF-8 文本；NUL 嗅探拒二进制（415）；>2MB 截断为前 256KB |
| `/write` | POST | 原子写（tmp+rename）；`baseMtimeMs` 乐观锁，失配 409 |
| `/mkdir` / `/rename` | POST | 单段名称校验（禁分隔符） |
| `/delete` | POST | **仅单文件或空目录**，非空目录拒绝（不递归，数据安全底线） |
| `/upload` | POST raw | 流式落盘，上限 50MB |
| `/download` | GET | attachment 流式下载，RFC 5987 文件名编码 |

## 安全接缝

本插件不做鉴权。每个请求先经 `web-files/access` serial 事件（
`src/files-api.ts`），监听器抛错即 403——统一安全围栏由后续安全插件
以监听器形式实现。暴露面与 dsh web 同源 GUI 其余部分一致。

## 编辑冲突语义

读取时记录 `mtimeMs`，保存携带为 `baseMtimeMs`；磁盘已被外部修改则
409 `mtime-conflict`，客户端弹 RiskConfirmation，确认后强制覆盖
（不传 baseMtimeMs）。冲突放弃后如需磁盘新内容，关闭文件重新打开。

## 降级原则

slot 注入 / primitives / 语言包任一环节因上游升级失配时静默降级
（入口不出现、高亮退化为纯文本），不破坏原生 UI。
