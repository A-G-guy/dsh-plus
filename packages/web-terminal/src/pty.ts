/**
 * node-pty 薄适配：把原生 IPty 的最小面（spawn/onData/onExit/write/resize/
 * kill/pid）收敛为 PtyLike 接口，registry 依赖抽象而非实现（可注入假工厂单测）。
 * @module web-terminal/pty
 */
import * as nodePty from 'node-pty'

export interface PtySpawnSpec {
  argv: readonly string[]
  cwd: string
  env: Record<string, string>
  cols: number
  rows: number
  name?: string
}

/** registry 消费的最小 PTY 面；测试用 FakePty 实现同接口。 */
export interface PtyLike {
  readonly pid: number
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
  onData(listener: (data: string) => void): () => void
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): () => void
}

export type PtyFactory = (spec: PtySpawnSpec) => PtyLike

/** 生产工厂：node-pty spawn（真 shell）。 */
export const spawnNodePty: PtyFactory = (spec) => {
  const file = spec.argv[0] ?? '/bin/bash'
  const pty = nodePty.spawn(file, [...spec.argv.slice(1)], {
    name: spec.name ?? 'xterm-256color',
    cwd: spec.cwd,
    env: spec.env,
    cols: spec.cols,
    rows: spec.rows,
    // 交互会话独立进程组：Ctrl-C 走终端输入字节，信号投递不与宿主进程组纠缠。
    useConpty: false,
  })
  return {
    pid: pty.pid,
    write: (data) => pty.write(data),
    resize: (cols, rows) => pty.resize(cols, rows),
    kill: (signal) => pty.kill(signal),
    onData: (listener) => {
      const disposable = pty.onData(listener)
      return () => disposable.dispose()
    },
    onExit: (listener) => {
      const disposable = pty.onExit(({ exitCode, signal }) => listener({ exitCode, signal }))
      return () => disposable.dispose()
    },
  }
}
