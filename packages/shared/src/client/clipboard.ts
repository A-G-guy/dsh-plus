/**
 * 剪贴板复制助手（浏览器半共享件）：`navigator.clipboard` 优先，
 * 非安全上下文（如非 localhost 直连的 HTTP 页面）无该 API 时退 `execCommand`。
 * @module @dsh-plus/shared/client/clipboard
 */

/** 复制文本到剪贴板；返回是否成功（失败静默，调用方自行决定是否提示）。 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // 回落：非安全上下文无 clipboard API。
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  }
}
