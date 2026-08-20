/**
 * 重启预检：确认本进程就是 systemd 单元的主进程（MainPID 匹配）、目标单元
 * 处于 active、sudo 免密可用。任一失败都拒绝调度——非托管/非主进程环境
 * （如 dev 实例、从服务内 shell 手动拉起的进程）重启后无人保证拉起，
 * 会把用户晾在死服务前；此时给出人工路径提示。
 * runner/pid 注入便于测试（禁真实 systemctl/sudo 调用）。
 * @module reload/preflight
 */
import { execFile } from 'node:child_process'

export interface PreflightResult {
  ok: boolean
  reasons: string[]
}

export interface RunOutput {
  code: number
  stdout: string
}

export type Runner = (cmd: string, args: string[]) => Promise<RunOutput>

/** 生产 runner：捕获退出码而非抛异常（is-active 对 inactive 返回非零是正常信号）。 */
export const systemRunner: Runner = (cmd, args) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 5000 }, (error, stdout) => {
      if (error && typeof error.code !== 'number') {
        reject(new Error(`无法执行 ${cmd}: ${error.message}`))
        return
      }
      resolve({
        code: typeof error?.code === 'number' ? error.code : 0,
        stdout: String(stdout),
      })
    })
  })

export async function runPreflight(
  unitName: string,
  pid: number,
  runner: Runner,
): Promise<PreflightResult> {
  const reasons: string[] = []

  // INVOCATION_ID/cgroup 会被服务内派生的子进程继承，不可作判据；
  // 唯一权威：本进程必须是 systemd 单元的 MainPID（重启才由单元拉起）。
  try {
    const main = await runner('systemctl', ['show', '-p', 'MainPID', '--value', unitName])
    if (Number(main.stdout.trim()) !== pid) {
      reasons.push(
        `本进程不是 systemd 单元 ${unitName} 的主进程（MainPID 不匹配），重启后不会自动拉起；请改用人工重启（如 dshctl restart-prod）`,
      )
    }
  } catch (error) {
    reasons.push(error instanceof Error ? error.message : String(error))
  }

  try {
    const active = await runner('systemctl', ['is-active', unitName])
    if (active.stdout.trim() !== 'active') {
      reasons.push(
        `systemd 单元 ${unitName} 非 active（is-active: ${active.stdout.trim() || `exit ${active.code}`}）`,
      )
    }
  } catch (error) {
    reasons.push(error instanceof Error ? error.message : String(error))
  }

  try {
    const sudo = await runner('sudo', ['-n', 'true'])
    if (sudo.code !== 0) {
      reasons.push('sudo 免密校验失败（sudo -n true 非零退出），无法执行 systemctl restart')
    }
  } catch (error) {
    reasons.push(error instanceof Error ? error.message : String(error))
  }

  return { ok: reasons.length === 0, reasons }
}
