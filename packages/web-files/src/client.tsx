/**
 * 浏览器半：侧边栏 footer 入口按钮 + shell.overlay 文件管理面板。
 *
 * 模式与官方插件一致（参照 dsh-client-ui-cordis / dsh-client-ui-sidebar 产物）：
 * - 构建产物为 window.__ModuleLoader__.load({id, factory}) 形式的 CJS factory；
 * - react / primitives / slots 等经模块表 require（构建期 external）；
 * - 样式走 data-plugin / data-plugin-css 约定，dsh-client-hmr 热更时可卸载；
 * - slot 注入等任一环节因上游升级失配时静默降级（入口不出现），不影响原生 UI。
 *
 * 类型说明：0.1.2-alpha.1 起 dsh-client-runtime 删除，类型按包拆分——
 * ctx.slots 来自 ui-renderer、ctx.workspaces 来自 workspace-controller、
 * ctx.locale 来自 locale；「打开文件」接管挂在 ctx.remote.session 的
 * openWorkspacePath（官方 openFile 手势的落点）。
 * @module @dsh-plus/web-files/client
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveWorkspacePath } from '@deepseek-ai/dsh-util-workspace-path'
import { useSyncExternalStore } from 'react'

import { en, NS, zh } from './locales.ts'
import { FilePanel } from './panel/panel.tsx'
import { IconFolderOpenOutline16 } from './panel/primitives.ts'
import { createPanelController, type PanelController, type Translate } from './panel/types.ts'
import { webFilesCss } from './styles.ts'

export const name = 'dsh-plus-web-files'

/** 客户端 cordis 服务依赖（slots/locale 字典 + workspaces 服务；接管走 remote.session）。 */
export const inject = ['slots', 'locale', 'workspaces', 'remote', 'remote.session'] as const

const PLUGIN_ID = '@dsh-plus/web-files'
const STYLE_TAG_ID = `${PLUGIN_ID}/styles.css`

function injectStyle(): HTMLStyleElement | null {
  if (typeof document === 'undefined') return null
  if (document.querySelector(`style[data-plugin-css=${JSON.stringify(STYLE_TAG_ID)}]`) !== null) {
    return null
  }
  const tag = document.createElement('style')
  tag.dataset.plugin = PLUGIN_ID
  tag.dataset.pluginCss = STYLE_TAG_ID
  tag.textContent = webFilesCss
  document.head.appendChild(tag)
  return tag
}

interface EntryProps {
  files: PanelController
  t: Translate
  /** 侧边栏展开态（slot owner 传入）；折叠（rail）时仅渲染圆形图标。 */
  wide?: boolean
}

/**
 * 侧边栏 footer 入口：与原生「设置」入口同款（整行图标 + 文案；
 * rail 折叠态退化为居中圆形图标按钮）。
 */
function FilesEntryButton({ files, t, wide }: EntryProps) {
  const { open } = useSyncExternalStore(files.subscribe, files.getSnapshot)
  const rail = wide === false
  return (
    <button
      type="button"
      className={rail ? 'wf-entry wf-entry-rail' : 'wf-entry'}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={t('entry.label')}
      onClick={() => files.toggle()}
    >
      <IconFolderOpenOutline16 size={rail ? 18 : 16} />
      {!rail && <span className="wf-entry-label">{t('entry.label')}</span>}
    </button>
  )
}

/** shell.overlay 入口：常驻挂载，闭合时 FilePanel 内部渲染 null。 */
function FilesOverlayEntry({ files, t }: EntryProps) {
  return <FilePanel files={files} t={t} />
}

/**
 * `ctx.remote.session.openWorkspacePath` 的窄面：官方 openFile 手势的落点
 * （ui-chat 的 openFile → resolveWorkspacePath(cwd, path) → openWorkspacePath）。
 * 只声明本插件用到的形状，避免为构建期类型引入整条 typert 协议依赖树。
 */
interface OpenWorkspacePathRequest {
  path: string
}

interface RemoteSessionLike {
  openWorkspacePath(
    request: OpenWorkspacePathRequest,
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; value?: { opened: boolean }; error?: unknown }>
}

/**
 * 接管 `ctx.remote.session.openWorkspacePath`：GUI 内全部「打开文件」手势
 * （会话消息文件引用、附件等）不再走宿主 xdg-open（无桌面环境必然失败），
 * 改为在本插件面板中打开；非绝对路径（调用方缺少 cwd 上下文、服务器侧
 * 无法定位）回退原实现。
 * 原方法在 remote 命名空间对象上，恢复时 delete 自身属性即可还原。
 */
function takeOverOpenPath(ctx: Context, controller: PanelController): void {
  const session = (ctx as unknown as { remote: { session: RemoteSessionLike } }).remote.session
  const original = session.openWorkspacePath.bind(session)
  const holder = session as { openWorkspacePath?: RemoteSessionLike['openWorkspacePath'] }
  holder.openWorkspacePath = async (request) => {
    // 官方调用方（ui-chat openFile）已按会话 cwd 解析；此处兜底再解析一次
    // （cwd 未知时原样返回，与官方 openFile 同一路径拼写语义）。
    const path = resolveWorkspacePath(undefined, request.path)
    if (!path.startsWith('/')) {
      return original(request)
    }
    // 面板接管即视为已打开（宿主无桌面环境时 xdg-open 必然失败），
    // 返回 RemoteResult 成功面供调用方（openFile 的 result.ok 检查）消费。
    controller.requestOpen(path)
    return { ok: true, value: { opened: true } }
  }
  ctx.effect(
    () => () => {
      delete holder.openWorkspacePath
    },
    'web-files: openWorkspacePath takeover cleanup',
  )
}

export function apply(ctx: Context): void {
  const tag = injectStyle()
  const controller = createPanelController()
  takeOverOpenPath(ctx, controller)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'web-files: dictionaries')
  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.footer.action', () =>
        ctx.slots.register(
          {
            name: 'sidebar.footer.action',
            id: 'web-files-entry',
            locale: NS,
            inject: () => ({ files: controller }),
          },
          FilesEntryButton,
        ),
      ),
    'web-files: entry slot',
  )
  ctx.effect(
    () =>
      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register(
          {
            name: 'shell.overlay',
            id: 'web-files-panel',
            locale: NS,
            inject: () => ({ files: controller }),
          },
          FilesOverlayEntry,
        ),
      ),
    'web-files: overlay slot',
  )
  ctx.effect(
    () => () => {
      tag?.remove()
    },
    'web-files: cleanup',
  )
}
