/**
 * sw.js 路由处理器：GET/HEAD 服务生成的 SW 脚本。
 *
 * 响应头三条缺一不可：
 * - content-type 必须是 JavaScript MIME（否则注册被浏览器拒）；
 * - service-worker-allowed: / 使 scope 覆盖全站（脚本挂在 /dsh-plus/ 下，
 *   默认 scope 只到 /dsh-plus/，管不到 /assets 与 /plugins）；
 * - cache-control: no-cache 让更新检查拿到最新脚本（现代浏览器主脚本本就
 *   绕过 HTTP 缓存，此头是显式语义与旧实现的双保险）。
 * @module @dsh-plus/web-shell-sw/route
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

import { buildServiceWorkerScript } from './sw-script.ts'

/**
 * 精确路由 handler（webserver.register kind:'exact'）。
 * @param req - 入站请求。
 * @param res - 出站响应（本 handler 拥有完整生命周期）。
 */
export function serveServiceWorker(req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, {
      'content-type': 'text/plain; charset=utf-8',
      allow: 'GET, HEAD',
    })
    res.end('method not allowed')
    return
  }
  const body = buildServiceWorkerScript()
  res.writeHead(200, {
    'content-type': 'text/javascript; charset=utf-8',
    'cache-control': 'no-cache',
    'service-worker-allowed': '/',
    'content-length': String(Buffer.byteLength(body)),
  })
  res.end(body)
}
