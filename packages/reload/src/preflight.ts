/**
 * 重启预检：先做环境能力判定（桌面端 desktop profile / 非 Linux → 直接拒绝
 * 并给平台化理由，绝不触碰不存在的 systemctl/sudo），再确认本进程就是 systemd
 * 单元的主进程（MainPID 匹配）、目标单元处于 active、sudo 免密可用。任一失败
 * 都拒绝调度——非托管/非主进程环境（如 dev 实例、从服务内 shell 手动拉起的进程）
 * 重启后无人保证拉起，会把用户晾在死服务前；此时给出人工路径提示。
 * runner/pid/env 注入便于测试（禁真实 systemctl/sudo 调用）。
 * @module reload/preflight
 */
import { execFile } from 'node:child_process'

export interface PreflightResult {
  ok: boolean
  reasons: string[]
}

/** 环境事实（能力判定用）；platform/profileName 缺省取运行期真值，测试注入。 */
export interface PreflightEnv {
  platform?: string | undefined
  profileName?: string | undefined
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

/**
 * 环境能力判定：本环境是否具备 systemd 级重启能力；不具备时返回拒绝理由
 * （空数组 = 具备，继续三级 systemd 检查）。桌面端与非 Linux 平台优先给出
 * 平台化提示，不再暴露 ENOENT/journalctl 术语。
 */
export function systemdUnsupportedReasons(env: PreflightEnv = {}): string[] {
  const platform = env.platform ?? process.platform
  if (env.profileName === 'desktop') {
    return [
      '桌面端（desktop profile）由 Electron 应用管理生命周期，不提供系统级重启；请使用应用内更新/重启流程（配置类变更由 dsh-hmr 热生效）',
    ]
  }
  if (platform !== 'linux') {
    return [
      `当前平台 ${platform} 无 systemd，本插件的系统级重启不可用；配置类变更由 dsh-hmr 热生效，安装包变更请重启 dsh 宿主进程`,
    ]
  }
  return []
}

export async function runPreflight(
  unitName: string,
  pid: number,
  runner: Runner,
  env: PreflightEnv = {},
): Promise<PreflightResult> {
  const unsupported = systemdUnsupportedReasons(env)
  if (unsupported.length > 0) return { ok: false, reasons: unsupported }
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
