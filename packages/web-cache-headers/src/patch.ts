/**
 * 进程级 `http.ServerResponse.prototype.writeHead` 增量补丁。
 *
 * 选型理由（对比"注册 /assets 前缀路由自行服务文件"）：
 * - 零路由注册 —— core 未来若注册同名路由不会撞车 throw；
 * - 零文件服务/MIME/穿越防护/dist 路径知识 —— core 服务文件的任何改动无需同步；
 * - 唯一耦合点是 `/assets/` 路径约定与 core 经 writeHead 写响应（node:http
 *   全代码库统一用法），是跟随 dsh 更新维护成本最低的切面。
 *
 * 正确性约束：
 * - 纯增量：仅当决策命中且响应未带 cache-control 时 setHeader 一个头，
 *   绝不改写既有头、绝不改状态码/响应体；
 * - writeHead 全重载形态兼容（statusCode | +headers | +statusMessage+headers），
 *   头对象中的 cache-control（大小写不敏感）同样被尊重；
 * - 决策异常被吞掉并原样委托 —— 补丁处于所有响应的关键路径，绝不能让
 *   加头逻辑影响响应写入；
 * - 模块级引用计数：多实例（多 profile / live reload 先装后卸）可叠加安装，
 *   计数归零才还原原型。
 * @module @dsh-plus/web-cache-headers/patch
 */
import type { ServerResponse } from 'node:http'
import http from 'node:http'

import { decideCacheControl } from './decision.ts'

type WriteHeadFn = ServerResponse['writeHead']

let originalWriteHead: WriteHeadFn | undefined
let installs = 0

/** 取 writeHead 可变参末位的头对象（不存在则 undefined；数组形态不支持也返回 undefined）。 */
function headersObjectOf(args: unknown[]): Record<string, unknown> | undefined {
  if (args.length < 2) return undefined
  const last = args[args.length - 1]
  if (last !== null && typeof last === 'object' && !Array.isArray(last)) {
    return last as Record<string, unknown>
  }
  return undefined
}

/** 头对象内是否已声明 cache-control（HTTP 头名大小写不敏感）。 */
function objectHasCacheControl(headers: Record<string, unknown> | undefined): boolean {
  if (headers === undefined) return false
  return Object.keys(headers).some((name) => name.toLowerCase() === 'cache-control')
}

/** 安装补丁（幂等，引用计数叠加）。 */
export function installImmutableAssetsPatch(): void {
  installs += 1
  if (originalWriteHead !== undefined) return
  originalWriteHead = http.ServerResponse.prototype.writeHead
  const original = originalWriteHead

  const patched = function (this: ServerResponse, ...args: unknown[]) {
    try {
      const statusCode = typeof args[0] === 'number' ? args[0] : 0
      const method = this.req?.method ?? ''
      const url = this.req?.url ?? ''
      const hasCacheControl =
        this.getHeader('cache-control') !== undefined ||
        objectHasCacheControl(headersObjectOf(args))
      const header = decideCacheControl(method, url, statusCode, hasCacheControl)
      if (header !== undefined) this.setHeader('cache-control', header)
    } catch {
      // 决策失败绝不阻断响应写入（补丁位于所有 HTTP 响应的关键路径）。
    }
    return (original as unknown as (...inner: unknown[]) => unknown).apply(this, args)
  }

  http.ServerResponse.prototype.writeHead = patched as unknown as WriteHeadFn
}

/** 卸下补丁（引用计数归零才还原原型；超额调用安全）。 */
export function uninstallImmutableAssetsPatch(): void {
  if (installs > 0) installs -= 1
  if (installs > 0 || originalWriteHead === undefined) return
  http.ServerResponse.prototype.writeHead = originalWriteHead
  originalWriteHead = undefined
}
