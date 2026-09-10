/**
 * 「打开文件」手势接管：`ctx.remote.session.openWorkspacePath` 的窄面接管。
 *
 * 背景：GUI 内全部「打开文件」手势（ui-chat openFile → resolveWorkspacePath(cwd,
 * path) → openWorkspacePath RPC）在宿主无桌面环境时必然走到 xdg-open 并失败
 * （`path open failed: Command failed: xdg-open …`）。本模块把该远端方法替换为
 * 本地实现：绝对路径交给文件面板打开，非绝对路径（调用方缺少 cwd 上下文、
 * 服务器侧无法定位）回退原 RPC 实现。
 *
 * 为什么必须 defineProperty：上游 dsh-api-gateway 的 RemoteNamespaceService
 * 用 `Object.defineProperty(this, method, { configurable: true, get: … })`
 * 安装命名空间方法——一个【只有 getter】的访问器属性。插件 client bundle 是
 * CJS factory 形态（无 "use strict"），对 getter-only 属性做普通赋值会在
 * 非严格模式下【静默失败】：接管看似存在、实际从未生效，调用仍走宿主 xdg-open。
 * 属性 configurable，因此用 defineProperty 重定义即可可靠接管；卸载时恢复
 * 原 RPC 函数（不是删除属性——删除会让后续调用直接缺方法）。
 * @module @dsh-plus/web-files/open-path
 */

import { resolveWorkspacePath } from '@deepseek-ai/dsh-util-workspace-path'

/** 面板控制器的窄面（仅本模块用到的形状）。 */
export interface OpenPathPanel {
  requestOpen(path: string): void
}

/** `openWorkspacePath` RPC 的请求/结果形状。 */
export interface OpenWorkspacePathRequest {
  path: string
}

export interface OpenWorkspacePathResult {
  ok: boolean
  value?: { opened: boolean }
  error?: unknown
}

/** 远端会话命名空间窄面。 */
export interface RemoteSessionLike {
  openWorkspacePath(
    request: OpenWorkspacePathRequest,
    signal?: AbortSignal,
  ): Promise<OpenWorkspacePathResult>
}

/**
 * 接管 `remote.session.openWorkspacePath`。返回卸载函数（恢复原 RPC 实现）。
 * 面板接管即视为已打开（宿主无桌面环境时 xdg-open 必然失败），返回 RemoteResult
 * 成功面供调用方（openFile 的 result.ok 检查）消费。
 */
export function takeOverOpenPath(
  session: RemoteSessionLike,
  panel: OpenPathPanel,
  warn: (message: string) => void = (message) => console.warn(message),
): () => void {
  const holder = session as {
    openWorkspacePath?: RemoteSessionLike['openWorkspacePath']
  }
  const original =
    typeof session.openWorkspacePath === 'function'
      ? session.openWorkspacePath.bind(session)
      : undefined
  const wrapped: RemoteSessionLike['openWorkspacePath'] = async (request, signal) => {
    // 官方调用方（ui-chat openFile）已按会话 cwd 解析；此处兜底再解析一次
    // （cwd 未知时原样返回，与官方 openFile 同一路径拼写语义）。
    const path = resolveWorkspacePath(undefined, request.path)
    if (!path.startsWith('/')) {
      if (original === undefined)
        return { ok: false, error: new Error('openWorkspacePath is unavailable') }
      return original(request, signal)
    }
    panel.requestOpen(path)
    return { ok: true, value: { opened: true } }
  }
  const descriptor = Object.getOwnPropertyDescriptor(holder, 'openWorkspacePath')
  if (descriptor !== undefined) {
    try {
      // 上游访问器属性（configurable）→ 重定义替换；卸载时还原原 RPC 函数。
      Object.defineProperty(holder, 'openWorkspacePath', {
        configurable: true,
        // 条件展开：PropertyDescriptor.enumerable 不接受显式 undefined，
        // 且「省略该键」本就是原语义（保留描述符默认）。
        ...(descriptor.enumerable === undefined ? {} : { enumerable: descriptor.enumerable }),
        writable: true,
        value: wrapped,
      })
      return () => {
        Object.defineProperty(holder, 'openWorkspacePath', {
          configurable: true,
          ...(descriptor.enumerable === undefined ? {} : { enumerable: descriptor.enumerable }),
          writable: true,
          value: original,
        })
      }
    } catch {
      // 属性不可配置：落到普通赋值路径，由自检决定是否告警。
    }
  }
  // 属性缺失（旧平台/测试替身）或不可配置：普通赋值 + 生效自检。
  // 生产 bundle 为 CJS 非严格模式，getter-only 赋值【静默失败】——
  // 自检 + 显式告警避免"接管看似存在、实际未生效"的回归。
  try {
    holder.openWorkspacePath = wrapped
  } catch {
    // 严格模式（测试等）下 getter-only 赋值抛 TypeError，与静默失败等价。
  }
  if (holder.openWorkspacePath !== wrapped) {
    warn(
      '[web-files] openWorkspacePath takeover failed: namespace method is not replaceable; file opens will fall back to the host opener',
    )
    return () => {}
  }
  return () => {
    if (holder.openWorkspacePath === wrapped && original !== undefined) {
      holder.openWorkspacePath = original
    }
  }
}
