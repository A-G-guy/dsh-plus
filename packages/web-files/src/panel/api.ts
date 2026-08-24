/**
 * 文件 API 的浏览器侧 fetch 封装：同源裸 fetch（与官方 WebApiClient 同款
 * 暴露面），错误体解析为携带 code 的 {@link FilesApiError}。
 * @module @dsh-plus/web-files/panel/api
 */
import type {
  ApiErrorBody,
  FilesErrorCode,
  ListRequest,
  ListResponse,
  MkfileResponse,
  ReadRequest,
  ReadResponse,
  StatRequest,
  StatResponse,
  WriteRequest,
  WriteResponse,
} from '../protocol.ts'
import { ROUTE_PREFIX } from '../protocol.ts'

/** 携带服务端错误码的 API 错误（客户端据 code 分支冲突/二进制等）。 */
export class FilesApiError extends Error {
  constructor(
    message: string,
    readonly code: FilesErrorCode | undefined,
    readonly status: number,
  ) {
    super(message)
    this.name = 'FilesApiError'
  }
}

async function post<TReq, TRes>(endpoint: string, body: TReq): Promise<TRes> {
  const response = await fetch(`${ROUTE_PREFIX}${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    throw await toError(response)
  }
  return (await response.json()) as TRes
}

async function toError(response: Response): Promise<FilesApiError> {
  let body: ApiErrorBody | undefined
  try {
    body = (await response.json()) as ApiErrorBody
  } catch {
    body = undefined
  }
  return new FilesApiError(
    body?.error ?? `HTTP ${String(response.status)}`,
    body?.code,
    response.status,
  )
}

export function list(req: ListRequest): Promise<ListResponse> {
  return post<ListRequest, ListResponse>('/list', req)
}

export function read(req: ReadRequest): Promise<ReadResponse> {
  return post<ReadRequest, ReadResponse>('/read', req)
}

export function stat(req: StatRequest): Promise<StatResponse> {
  return post<StatRequest, StatResponse>('/stat', req)
}

export function write(req: WriteRequest): Promise<WriteResponse> {
  return post<WriteRequest, WriteResponse>('/write', req)
}

export function mkdir(parent: string, name: string): Promise<{ path: string }> {
  return post('/mkdir', { parent, name })
}

export function mkfile(parent: string, name: string): Promise<MkfileResponse> {
  return post('/mkfile', { parent, name })
}

export function rename(path: string, newName: string): Promise<{ path: string }> {
  return post('/rename', { path, newName })
}

export function remove(path: string): Promise<{ deleted: true }> {
  return post('/delete', { path })
}

/** 上传：raw body 流（query 携带目录与文件名）。 */
export async function upload(dir: string, file: File): Promise<{ path: string; size: number }> {
  const query = new URLSearchParams({ dir, name: file.name })
  const response = await fetch(`${ROUTE_PREFIX}/upload?${query.toString()}`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: file,
  })
  if (!response.ok) {
    throw await toError(response)
  }
  return (await response.json()) as { path: string; size: number }
}

/** 下载地址（浏览器原生 attachment 下载）。 */
export function downloadUrl(path: string): string {
  return `${ROUTE_PREFIX}/download?${new URLSearchParams({ path }).toString()}`
}
