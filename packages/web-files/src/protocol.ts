/**
 * 宿主/浏览器两半共享的线协议：路由前缀、端点、DTO、错误码。
 * 客户端不拼路径（crumbs/entries 都携带绝对 path），两端仅通过本模块对齐。
 * @module @dsh-plus/web-files/protocol
 */

/** 路由前缀（webServer prefix 注册；避开 gateway 已占的 /api 围栏）。 */
export const ROUTE_PREFIX = '/dsh-plus/web-files'

/** 目录列举条数上限；超出截断并置 truncated。 */
export const LIST_MAX_ENTRIES = 2000
/** 可读文件硬上限（2MB）；超出返回前 READ_TRUNCATE_BYTES 并标记不可编辑。 */
export const READ_MAX_BYTES = 2 * 1024 * 1024
/** 超限文件返回的前缀字节数（256KB）。 */
export const READ_TRUNCATE_BYTES = 256 * 1024
/** 二进制嗅探窗口：前 8KB 含 NUL 即判定二进制。 */
export const BINARY_SNIFF_BYTES = 8 * 1024
/** 写入内容上限（4MB，UTF-8 编码后字节数）。 */
export const WRITE_MAX_BYTES = 4 * 1024 * 1024
/** 上传上限（50MB）。 */
export const UPLOAD_MAX_BYTES = 50 * 1024 * 1024

/** 一行目录条目（文件或目录）。 */
export interface FsEntryDto {
  /** 基名（客户端直接展示）。 */
  name: string
  /** 绝对路径（客户端不自行拼接）。 */
  path: string
  /** 目录 / 文件 / 其他（socket、断链 symlink 等）。symlink 按目标类型归类。 */
  kind: 'dir' | 'file' | 'other'
  /** 平台惯例隐藏（POSIX 点前缀）。 */
  hidden: boolean
  /** 字节数；目录为 0。 */
  size: number
  /** 修改时间（ms epoch）。 */
  mtimeMs: number
}

/** 面包屑一段。 */
export interface CrumbDto {
  name: string
  path: string
}

export interface ListRequest {
  /** 缺省列 home 目录。 */
  path?: string
  showHidden?: boolean
}

export interface ListResponse {
  path: string
  home: string
  /** 从文件系统根到当前目录（含）的祖先链，每段都是跳转目标。 */
  crumbs: CrumbDto[]
  /** 目录优先、名称排序。 */
  entries: FsEntryDto[]
  truncated: boolean
}

export interface ReadRequest {
  path: string
}

export interface ReadResponse {
  content: string
  size: number
  mtimeMs: number
  /** 内容被截断（文件超过 READ_MAX_BYTES）时为 true，此时不可编辑。 */
  truncated: boolean
}

export interface WriteRequest {
  path: string
  content: string
  /** 乐观锁：客户端读取时拿到的 mtimeMs；与现值不符返回 409 mtime-conflict。 */
  baseMtimeMs?: number
}

export interface WriteResponse {
  mtimeMs: number
  size: number
}

export interface MkdirRequest {
  parent: string
  name: string
}

export interface RenameRequest {
  path: string
  newName: string
}

export interface DeleteRequest {
  path: string
}

/** 统一的错误体；code 供客户端分支（冲突确认、二进制占位等）。 */
export interface ApiErrorBody {
  error: string
  code?: FilesErrorCode
}

export type FilesErrorCode =
  | 'path-invalid'
  | 'name-invalid'
  | 'not-found'
  | 'not-a-directory'
  | 'not-a-file'
  | 'entry-exists'
  | 'binary-file'
  | 'non-utf8'
  | 'file-too-large'
  | 'mtime-conflict'
  | 'dir-not-empty'
  | 'upload-too-large'
  | 'access-denied'
  | 'fs-error'
