/**
 * 文件系统核心操作：纯 node:fs/promises 实现，与 HTTP 层解耦以便单测。
 * 所有外部输入（路径、名字）在本模块边界校验；错误统一为 {@link FilesError}。
 * @module @dsh-plus/web-files/fs-core
 */
import { createWriteStream } from 'node:fs'
import {
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  rmdir,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import type { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import {
  BINARY_SNIFF_BYTES,
  type CrumbDto,
  type FilesErrorCode,
  type FsEntryDto,
  LIST_MAX_ENTRIES,
  type ListResponse,
  READ_MAX_BYTES,
  READ_TRUNCATE_BYTES,
  type ReadResponse,
  UPLOAD_MAX_BYTES,
  WRITE_MAX_BYTES,
  type WriteResponse,
} from './protocol.ts'

/** 携带业务错误码与 HTTP 状态的文件操作错误。 */
export class FilesError extends Error {
  readonly code: FilesErrorCode
  readonly status: number
  constructor(message: string, code: FilesErrorCode, status: number = 400) {
    super(message)
    this.name = 'FilesError'
    this.code = code
    this.status = status
  }
}

/** 校验绝对路径；非绝对直接拒绝（服务端不替客户端做相对解析）。 */
export function requireAbsolute(path: unknown): string {
  if (typeof path !== 'string' || path.length === 0 || !isAbsolute(path)) {
    throw new FilesError(
      `path must be an absolute path, got ${JSON.stringify(path)}`,
      'path-invalid',
    )
  }
  return resolve(path)
}

/** 校验单段条目名：非空、非 . / ..、不含路径分隔符。 */
export function requireEntryName(name: unknown): string {
  if (typeof name !== 'string' || name.length === 0 || name === '.' || name === '..') {
    throw new FilesError(
      `name must be a single entry name, got ${JSON.stringify(name)}`,
      'name-invalid',
    )
  }
  if (name.includes('/') || name.includes(sep) || name.includes('\0')) {
    throw new FilesError(
      `name must not contain path separators, got ${JSON.stringify(name)}`,
      'name-invalid',
    )
  }
  return name
}

/** 判断隐藏（POSIX 点前缀惯例；客户端决定是否展示）。 */
function isHidden(name: string): boolean {
  return name.startsWith('.') && name !== '.' && name !== '..'
}

/** lstat + 目标归类：symlink 按目标类型归 dir/file，断链归 other。 */
async function classify(
  path: string,
): Promise<{ kind: FsEntryDto['kind']; size: number; mtimeMs: number }> {
  const lst = await lstat(path)
  if (lst.isSymbolicLink()) {
    try {
      const target = await stat(path)
      return {
        kind: target.isDirectory() ? 'dir' : target.isFile() ? 'file' : 'other',
        size: target.size,
        mtimeMs: target.mtimeMs,
      }
    } catch {
      return { kind: 'other', size: 0, mtimeMs: lst.mtimeMs }
    }
  }
  if (lst.isDirectory()) return { kind: 'dir', size: 0, mtimeMs: lst.mtimeMs }
  if (lst.isFile()) return { kind: 'file', size: lst.size, mtimeMs: lst.mtimeMs }
  return { kind: 'other', size: 0, mtimeMs: lst.mtimeMs }
}

/** 从文件系统根到目标目录的面包屑链（每段可跳转）。 */
export function buildCrumbs(path: string): CrumbDto[] {
  const crumbs: CrumbDto[] = [{ name: sep, path: sep }]
  const parts = path.split(sep).filter((part) => part.length > 0)
  let current = sep
  for (const part of parts) {
    current = current === sep ? `${sep}${part}` : `${current}${sep}${part}`
    crumbs.push({ name: part, path: current })
  }
  return crumbs
}

/** 列一层目录：目录优先、名称排序，超 LIST_MAX_ENTRIES 截断。 */
export async function listDirectory(
  path: string | undefined,
  showHidden: boolean,
): Promise<ListResponse> {
  const target = path === undefined ? homedir() : requireAbsolute(path)
  let names: string[]
  try {
    names = await readdir(target)
  } catch (error) {
    throw toFilesError(error, target)
  }
  const rows: FsEntryDto[] = []
  let truncated = false
  for (const name of names) {
    if (!showHidden && isHidden(name)) continue
    if (rows.length >= LIST_MAX_ENTRIES) {
      truncated = true
      break
    }
    const child = join(target, name)
    try {
      const info = await classify(child)
      rows.push({
        name,
        path: child,
        kind: info.kind,
        hidden: isHidden(name),
        size: info.size,
        mtimeMs: info.mtimeMs,
      })
    } catch {
      // 竞态消失或权限不足的条目：跳过而非整列失败
    }
  }
  rows.sort((a, b) => {
    if (a.kind === 'dir' && b.kind !== 'dir') return -1
    if (a.kind !== 'dir' && b.kind === 'dir') return 1
    return a.name.localeCompare(b.name)
  })
  return { path: target, home: homedir(), crumbs: buildCrumbs(target), entries: rows, truncated }
}

/** 读 UTF-8 文本：二进制嗅探 + 大小上限 + fatal 解码校验。 */
export async function readFileText(path: string): Promise<ReadResponse> {
  const target = requireAbsolute(path)
  let info: { kind: FsEntryDto['kind']; size: number; mtimeMs: number }
  try {
    info = await classify(target)
  } catch (error) {
    throw toFilesError(error, target)
  }
  if (info.kind !== 'file') {
    throw new FilesError(`${target} is not a regular file`, 'not-a-file')
  }
  const truncated = info.size > READ_MAX_BYTES
  const handle = await open(target, 'r')
  let buffer: Buffer
  try {
    const length = truncated ? READ_TRUNCATE_BYTES : info.size
    buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, 0)
  } finally {
    await handle.close()
  }
  const sniff = buffer.subarray(0, Math.min(buffer.length, BINARY_SNIFF_BYTES))
  if (sniff.includes(0)) {
    throw new FilesError(`${target} looks like a binary file`, 'binary-file', 415)
  }
  let content: string
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    throw new FilesError(`${target} is not valid UTF-8 text`, 'non-utf8', 415)
  }
  return { content, size: info.size, mtimeMs: info.mtimeMs, truncated }
}

/** 原子写：临时文件 + rename；baseMtimeMs 乐观锁防覆盖他人改动。 */
export async function writeFileText(
  path: string,
  content: string,
  baseMtimeMs?: number,
): Promise<WriteResponse> {
  const target = requireAbsolute(path)
  if (Buffer.byteLength(content, 'utf8') > WRITE_MAX_BYTES) {
    throw new FilesError(`content exceeds ${String(WRITE_MAX_BYTES)} bytes`, 'file-too-large', 413)
  }
  const existing = await lstat(target).catch(() => undefined)
  if (existing !== undefined && !existing.isFile() && !existing.isSymbolicLink()) {
    throw new FilesError(`${target} is not a regular file`, 'not-a-file')
  }
  if (baseMtimeMs !== undefined) {
    if (existing === undefined) {
      throw new FilesError(`${target} vanished since it was read`, 'mtime-conflict', 409)
    }
    if (Math.abs(existing.mtimeMs - baseMtimeMs) > 1) {
      throw new FilesError(`${target} changed on disk since it was read`, 'mtime-conflict', 409)
    }
  }
  const tmp = `${target}.web-files-${String(process.pid)}-${String(Date.now())}.tmp`
  try {
    await writeFile(tmp, content, 'utf8')
    await rename(tmp, target)
  } catch (error) {
    await unlink(tmp).catch(() => {})
    throw toFilesError(error, target)
  }
  const written = await lstat(target)
  return { mtimeMs: written.mtimeMs, size: written.size }
}

/** 新建子目录。 */
export async function makeDirectory(parent: string, name: string): Promise<{ path: string }> {
  const dir = join(requireAbsolute(parent), requireEntryName(name))
  try {
    await mkdir(dir)
  } catch (error) {
    throw toFilesError(error, dir)
  }
  return { path: dir }
}

/** 同目录改名/移动（新名为单段条目名）。 */
export async function renameEntry(path: string, newName: string): Promise<{ path: string }> {
  const source = requireAbsolute(path)
  const target = join(dirname(source), requireEntryName(newName))
  if (await exists(target)) {
    throw new FilesError(`${target} already exists`, 'entry-exists', 409)
  }
  try {
    await rename(source, target)
  } catch (error) {
    throw toFilesError(error, source)
  }
  return { path: target }
}

/** 删除：仅单文件 unlink 或空目录 rmdir，明确拒绝递归（数据安全底线）。 */
export async function deleteEntry(path: string): Promise<{ deleted: true }> {
  const target = requireAbsolute(path)
  const lst = await lstat(target).catch(() => undefined)
  if (lst === undefined) throw new FilesError(`${target} not found`, 'not-found', 404)
  try {
    if (lst.isDirectory()) await rmdir(target)
    else await unlink(target)
  } catch (error) {
    if (isErrno(error, 'ENOTEMPTY') || isErrno(error, 'EEXIST')) {
      throw new FilesError(
        `${target} is a non-empty directory; recursive delete is not supported`,
        'dir-not-empty',
        409,
      )
    }
    throw toFilesError(error, target)
  }
  return { deleted: true }
}

/** 流式上传落盘：临时文件 + rename，超 UPLOAD_MAX_BYTES 中止。 */
export async function saveUpload(
  parent: string,
  name: string,
  body: Readable,
): Promise<{ path: string; size: number }> {
  const dir = requireAbsolute(parent)
  const target = join(dir, requireEntryName(name))
  if (await exists(target)) {
    throw new FilesError(`${target} already exists`, 'entry-exists', 409)
  }
  const tmp = `${target}.web-files-${String(process.pid)}-${String(Date.now())}.tmp`
  let size = 0
  const counting = async function* (source: Readable): AsyncGenerator<Buffer> {
    for await (const chunk of source) {
      const buf = chunk as Buffer
      size += buf.length
      if (size > UPLOAD_MAX_BYTES) {
        throw new FilesError(
          `upload exceeds ${String(UPLOAD_MAX_BYTES)} bytes`,
          'upload-too-large',
          413,
        )
      }
      yield buf
    }
  }
  try {
    await pipeline(counting(body), createWriteStream(tmp))
    await rename(tmp, target)
  } catch (error) {
    await unlink(tmp).catch(() => {})
    if (error instanceof FilesError) throw error
    throw toFilesError(error, target)
  }
  return { path: target, size }
}

/** 下载前置校验：存在且为常规文件，返回大小与最终路径。 */
export async function statDownload(path: string): Promise<{ path: string; size: number }> {
  const target = requireAbsolute(path)
  const info = await classify(target).catch((error: unknown) => {
    throw toFilesError(error, target)
  })
  if (info.kind !== 'file') throw new FilesError(`${target} is not a regular file`, 'not-a-file')
  return { path: target, size: info.size }
}

async function exists(path: string): Promise<boolean> {
  return lstat(path).then(
    () => true,
    () => false,
  )
}

function isErrno(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === code
}

/** 将 node errno 异常翻译为业务错误。 */
function toFilesError(error: unknown, path: string): FilesError {
  if (error instanceof FilesError) return error
  if (isErrno(error, 'ENOENT')) return new FilesError(`${path} not found`, 'not-found', 404)
  if (isErrno(error, 'ENOTDIR'))
    return new FilesError(`${path} is not inside a directory`, 'not-a-directory')
  if (isErrno(error, 'EEXIST')) return new FilesError(`${path} already exists`, 'entry-exists', 409)
  if (isErrno(error, 'EACCES') || isErrno(error, 'EPERM')) {
    return new FilesError(`permission denied: ${path}`, 'access-denied', 403)
  }
  const message = error instanceof Error ? error.message : String(error)
  return new FilesError(`${message} (${path})`, 'fs-error', 500)
}
