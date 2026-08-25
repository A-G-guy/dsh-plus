/**
 * 会话输出环形缓冲：行数与字节双上限，超限从最旧行整行淘汰。
 * 字节上限按 UTF-8 计（终端输出即字节流语义）；淘汰以行为单位，
 * 保证 replay 永远从完整行边界开始（回放不产生断头行）。
 * 纯函数 + 可变缓冲实体，可脱离 node-pty 单测。
 * @module web-terminal/scrollback
 */

export interface ScrollbackOptions {
  maxLines: number
  maxBytes: number
}

interface Entry {
  text: string
  bytes: number
}

export class Scrollback {
  private readonly maxLines: number
  private readonly maxBytes: number
  private readonly chunks: Entry[] = []
  private totalBytes = 0

  constructor(options: ScrollbackOptions) {
    this.maxLines = Math.max(1, options.maxLines)
    this.maxBytes = Math.max(1024, options.maxBytes)
  }

  /** 追加一段输出（可含多行/局部行，按 \n 分块追加分摊字节记账）。 */
  append(text: string): void {
    if (text.length === 0) return
    const parts = text.split('\n')
    for (let i = 0; i < parts.length; i += 1) {
      // 重组：块与块之间补回被 split 吃掉的换行（最后一块不带）。
      const piece = i < parts.length - 1 ? `${parts[i]}\n` : parts[i]
      if (piece === undefined || piece.length === 0) continue
      const bytes = byteLength(piece)
      this.chunks.push({ text: piece, bytes })
      this.totalBytes += bytes
    }
    this.evict()
  }

  /** 当前保留的完整 replay 文本（chronological）。 */
  replay(): string {
    return this.chunks.map((chunk) => chunk.text).join('')
  }

  /** 当前保留行数（末尾未闭合行计 1 行）。 */
  lines(): number {
    if (this.chunks.length === 0) return 0
    return this.chunks.reduce((sum, chunk) => sum + lineCount(chunk.text), 0)
  }

  currentBytes(): number {
    return this.totalBytes
  }

  /** 淘汰最旧行直至两个上限都满足；字节数不达上限时不淘汰（保行完整性优先于字节精度）。 */
  private evict(): void {
    while (
      this.chunks.length > 0 &&
      (this.lines() > this.maxLines || this.totalBytes > this.maxBytes)
    ) {
      const head = this.chunks[0]
      if (head === undefined) break
      this.totalBytes -= head.bytes
      this.chunks.shift()
    }
  }
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

/** 一段文本的行数：换行符计一行，末尾残行补 1（终端 viewport 语义）。 */
function lineCount(text: string): number {
  if (text.length === 0) return 0
  const newlines = countChar(text, '\n')
  return text.endsWith('\n') ? newlines : newlines + 1
}

function countChar(text: string, ch: string): number {
  let count = 0
  for (const c of text) if (c === ch) count += 1
  return count
}

/** 会话事件扇出：registry/session 把输出与退出广播给挂载连接。 */
export interface SessionSink {
  output(data: string): void
  exit(exitCode: number | null, signal: string | null): void
}
