/**
 * 内存环形 journal（最近 50 条），供卡片诊断区与告警正文取用。
 * 独立小模块：无依赖、可测。
 * @module feature-toggle/journal
 */

/** 单条 journal 记录。 */
export interface JournalEntry {
  at: string
  kind:
    | 'apply' // 执行了一批写入
    | 'verify' // 写入后验证结果
    | 'rollback' // 自动回退
    | 'reject' // 拒绝（lifeboat 冲突/非法键等）
    | 'error' // 异常
    | 'drift' // 启动期发现并自愈的漂移
    | 'preset' // 托管预设生命周期（创建/重建/移除/指针切换）
  detail: string
}

/** journal 上限。 */
const CAP = 50

export class Journal {
  private entries: JournalEntry[] = []

  record(kind: JournalEntry['kind'], detail: string): void {
    this.entries = [...this.entries, { at: new Date().toISOString(), kind, detail }].slice(-CAP)
  }

  recent(): readonly JournalEntry[] {
    return this.entries
  }
}
