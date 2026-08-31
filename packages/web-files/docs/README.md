---
last_modified: "2026-08-31 15:30"
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
  `sidebar.footer.action` 入口（与原生「设置」入口同款：展开态整行
  图标+文案，rail 折叠态居中圆形图标）与 `shell.overlay` 常驻面板；
  react / primitives / slots 为构建期 external（平台模块表供给），
  CodeMirror 及精选语言包静态内联（宿主只服务 client.js 单文件，
  禁止动态分包，见 tsdown.config.ts）。
- 样式 `src/styles.ts`：构建期内联字符串 + `data-plugin` /
  `data-plugin-css` style 标签约定（HMR 可卸载）；全部颜色引用
  `--dsw-*` 设计令牌，深浅色主题零成本跟随；圆角对齐官方扁平风格
  （面板 r24、行/入口 r12、图标按钮圆形、按钮胶囊）；断点 767px 与
  ui-mobile-fit 对齐，移动端 `position:fixed; inset:0` 真全屏 +
  列表/编辑单栏切换。
- 浏览导航（`src/panel/panel.tsx`）：目录历史栈支持后退/前进
  （重复路径去重、刷新不入栈）；面包屑每段点击直接跳转对应目录
  （不提供路径手输编辑，有意收窄交互面）；主页按钮一键回家目录
  （/list 缺省 path 即 home）。
- GUI 内文件链接接管（`src/client.tsx`）：包裹 `ctx.remote.session.openWorkspacePath`
  （0.1.2-alpha 线起官方 openFile 手势的落点——ui-chat openFile →
  resolveWorkspacePath(cwd, path) → openWorkspacePath；workspaces.openPath
  已从 IWorkspaces 移除），会话消息/附件的「打开文件」手势不再走宿主
  xdg-open（无桌面环境必然失败），改为 /stat 判定落点后在面板内打开
  （目录直接导航、文件先定位父目录再打开）；非绝对路径回退原实现，
  卸载时 delete 自身属性还原 remote 命名空间方法。
- 列表排序（`src/panel/sort.ts` 纯函数 + 单测）：名称/大小/修改时间
  × 升/降序，目录恒优先，平手回退名称升序；工具栏下拉选择
  （`src/panel/toolbar-menus.tsx`，与新建菜单同处）。排序按目录
  单独记忆（`src/prefs.ts` 服务端落盘 `~/.dsh/web-files/prefs.json`，
  跨设备共享），未记忆的目录回退默认名称升序。
- 面板偏好跨设备记忆（`src/prefs.ts` + `/prefs/get` `/prefs/set`）：
  showHidden 与按目录排序服务端持久化，读改写内存队列串行化 +
  tmp+rename 原子落盘，损坏回退默认；排序表上限 500 目录，
  超限逐出最久未更新项。面板打开时先拉取偏好再首次列目录，
  保证 showHidden 首列即正确；补丁为合并语义（仅出现的字段更新），
  服务端旧值打底、加载间隙的本地改动优先。
- 上传（`src/panel/browser.tsx`）：`<input type="file">` 显式
  `accept="*/*"`——移动端缺省 accept 会被部分浏览器/WebView 收窄为
  相册（仅照片），显式任意类型触发系统级文件选择器。
- 新建：加号下拉支持新建文件（/mkfile 空文件原子落盘，返回条目 DTO
  直接打开进入预览）与新建文件夹。
- i18n：命名空间 `dsh-plus-web-files` 合并进 LocaleNamespaceMap
  （`src/panel/types.ts`），zh/en 字典在 `src/locales.ts`。
- 图标：primitives 图标集缺失的 upload / home / sort 由
  `src/panel/icons.tsx` 本地补齐（16 视窗、currentColor，视觉对齐官方）。

## HTTP 端点（`src/protocol.ts` 为线协议单一事实源）

| 端点 | 方法 | 语义 |
|---|---|---|
| `/list` | POST | 单层列举：目录优先排序、hidden 标记、crumbs、超 2000 截断 |
| `/read` | POST | UTF-8 文本；NUL 嗅探拒二进制（415）；>2MB 截断为前 256KB |
| `/stat` | POST | 单条目探测（外部打开请求的落点判定），返回 FsEntryDto |
| `/write` | POST | 原子写（tmp+rename）；`baseMtimeMs` 乐观锁，失配 409 |
| `/mkdir` / `/mkfile` / `/rename` | POST | 单段名称校验（禁分隔符）；mkfile 空文件、重名 409 |
| `/delete` | POST | **仅单文件或空目录**，非空目录拒绝（不递归，数据安全底线） |
| `/upload` | POST raw | 流式落盘，上限 50MB |
| `/download` | GET | attachment 流式下载，RFC 5987 文件名编码 |
| `/prefs/get` | POST | 读取跨设备面板偏好（showHidden + 按目录排序） |
| `/prefs/set` | POST | 合并偏好补丁（仅出现的字段更新），返回合并后完整偏好 |

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
