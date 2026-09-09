/**
 * 生图任务并发执行器：FIFO 队列 + 可配置并发上限（0 = 不限）。
 * 与业务解耦：任务体是注入的异步函数，本模块只管调度与状态；
 * 纯调度逻辑可单测（不触网）。
 * @module image-studio/task/runner
 */

/** 任务状态。 */
export type TaskState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

/** 任务记录（调度器视图）。 */
export interface TaskRecord<S> {
  id: string
  state: TaskState
  /** 排队/运行中的业务快照（提交时的请求摘要）。 */
  snapshot: S
  /** 成功结果（succeeded 时存在）。 */
  result: unknown | null
  /** 失败信息（failed/cancelled 时存在）。 */
  error: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

interface TaskEntry<S> {
  record: TaskRecord<S>
  run: (signal: AbortSignal) => Promise<unknown>
  controller: AbortController
}

export interface RunnerOptions {
  /** 并发上限（0 = 不限）。 */
  maxConcurrent: number
  /** 任务 id 生成器（缺省自增）。 */
  nextId?: () => string
}

/**
 * 并发任务执行器。
 * - submit 入队即返回记录引用（状态经 record 可变字段即时可见）；
 * - 每次完成自动拉起下一段（pump 链式，无定时器）；
 * - cancel 对 queued 置 cancelled、对 running 发 abort（任务体自行响应）。
 */
export class TaskRunner<S> {
  private readonly entries = new Map<string, TaskEntry<S>>()
  private readonly order: string[] = []
  private maxConcurrent: number
  private readonly nextId: () => string
  /** 完结任务保留条数（防 Map 膨胀；由调用方配置）。 */
  private readonly keepFinished: number

  constructor(options: RunnerOptions, keepFinished = 200) {
    this.maxConcurrent = Math.max(0, Math.floor(options.maxConcurrent))
    this.nextId = options.nextId ?? defaultIdCounter()
    this.keepFinished = keepFinished
  }

  /** 并发上限热更（配置热生效入口；进行中任务不受影响）。 */
  reconfigure(maxConcurrent: number): void {
    this.maxConcurrent = Math.max(0, Math.floor(maxConcurrent))
  }

  /** 提交任务：返回记录（后续状态经同一引用轮询）。 */
  submit(snapshot: S, run: (signal: AbortSignal) => Promise<unknown>): TaskRecord<S> {
    const controller = new AbortController()
    const record: TaskRecord<S> = {
      id: this.nextId(),
      state: 'queued',
      snapshot,
      result: null,
      error: null,
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
    }
    this.entries.set(record.id, { record, run, controller })
    this.order.push(record.id)
    void this.pump()
    return record
  }

  /** 单任务记录查询。 */
  get(id: string): TaskRecord<S> | null {
    return this.entries.get(id)?.record ?? null
  }

  /** 全部记录（完结在前端按需过滤）。 */
  list(): TaskRecord<S>[] {
    return this.order
      .map((id) => this.entries.get(id)?.record)
      .filter((record): record is TaskRecord<S> => record !== undefined)
  }

  /** 取消：queued 直接置 cancelled；running 发 abort（异步生效）。 */
  cancel(id: string): boolean {
    const entry = this.entries.get(id)
    if (entry === undefined) return false
    if (entry.record.state === 'queued') {
      entry.record.state = 'cancelled'
      entry.record.finishedAt = new Date().toISOString()
      this.prune()
      return true
    }
    if (entry.record.state === 'running') {
      entry.controller.abort()
      return true
    }
    return false
  }

  /** 活跃数（queued + running）。 */
  get activeCount(): number {
    let count = 0
    for (const entry of this.entries.values()) {
      if (entry.record.state === 'queued' || entry.record.state === 'running') count += 1
    }
    return count
  }

  /** 拉起可运行任务至并发上限。 */
  private async pump(): Promise<void> {
    for (;;) {
      const capacity =
        this.maxConcurrent === 0
          ? Number.POSITIVE_INFINITY
          : this.maxConcurrent - this.runningCount()
      if (capacity <= 0) return
      const next = this.order
        .map((id) => this.entries.get(id))
        .find((entry) => entry !== undefined && entry.record.state === 'queued')
      if (next === undefined) return
      this.start(next)
      if (this.maxConcurrent !== 0) return
    }
  }

  private start(entry: TaskEntry<S>): void {
    entry.record.state = 'running'
    entry.record.startedAt = new Date().toISOString()
    const signal = entry.controller.signal
    void entry
      .run(signal)
      .then((result) => {
        // abort 后 gate 仍可能正常 resolve：以 signal.aborted 为准判失败。
        if (signal.aborted) {
          entry.record.state = 'failed'
          entry.record.error = '任务已取消'
          entry.record.finishedAt = new Date().toISOString()
          return
        }
        if (entry.record.state !== 'running') return
        entry.record.state = 'succeeded'
        entry.record.result = result
        entry.record.finishedAt = new Date().toISOString()
      })
      .catch((error: unknown) => {
        if (entry.record.state === 'cancelled') return
        entry.record.state = 'failed'
        entry.record.error = error instanceof Error ? error.message : String(error)
        entry.record.finishedAt = new Date().toISOString()
      })
      .finally(() => {
        this.prune()
        void this.pump()
      })
  }

  private runningCount(): number {
    let count = 0
    for (const entry of this.entries.values()) {
      if (entry.record.state === 'running') count += 1
    }
    return count
  }

  /** 清理最旧完结条目（保持 Map 上限）。 */
  private prune(): void {
    const finished = this.order.filter((id) => {
      const state = this.entries.get(id)?.record.state
      return state === 'succeeded' || state === 'failed' || state === 'cancelled'
    })
    const overflow = finished.length - this.keepFinished
    if (overflow <= 0) return
    for (const id of finished.slice(0, overflow)) {
      this.entries.delete(id)
      const index = this.order.indexOf(id)
      if (index >= 0) this.order.splice(index, 1)
    }
  }
}

/** 缺省 id 计数器。 */
function defaultIdCounter(): () => string {
  let counter = 0
  return () => {
    counter += 1
    return `task-${counter}`
  }
}
