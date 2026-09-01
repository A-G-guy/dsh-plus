/**
 * shell-env contributor 登记簿（从 service 拆出，规约模块规模）：
 * 受管与继承两条线共用一张表，注册表要求一键一主——受管注册前
 * 同名继承 contributor 先让位；继承只在「宿主环境有该名且未被索引」时存在。
 * 所有屏蔽判定都下沉到 resolve 回调（由 service 注入），登记簿只管生命周期。
 * @module secret-env/contributors
 */
import type { ToolExecution } from '@deepseek-ai/dsh-tools'

import { SecretEnvError } from './errors.ts'
import { envNameOf } from './names.ts'

/** 受管键（结构等价 dsh-shell 的 DshEnvironmentKey，避免仅为类型多挂一个依赖）。 */
type ManagedKey = `DSH_${string}`

/** dsh-shell-env 注册面的结构子集。 */
export interface ShellEnvLike {
  register(spec: {
    name: string
    variables: Readonly<Record<string, { description: string }>>
    resolve(execution: ToolExecution): Readonly<Record<string, string>>
  }): () => void
}

export interface ContributorBookDeps {
  readonly shellEnv: ShellEnvLike
  /** 受管变量描述（注册表拒绝空描述，调用方已做回落）。 */
  describeManaged(suffix: string): string
  /** 受管值解析：undefined = 本次执行不设置。 */
  resolveManaged(suffix: string, execution: ToolExecution): string | undefined
  /** 继承 contributor 是否应存在（宿主环境有该名且未被索引）。 */
  shouldForwardInherited(suffix: string): boolean
  /** 继承值解析（屏蔽名单在此生效）：undefined/空串 = 不设置。 */
  resolveInherited(suffix: string, execution: ToolExecution): string | undefined
}

export class ContributorBook {
  private readonly managed = new Map<string, () => void>()
  private readonly inherited = new Map<string, () => void>()
  private readonly deps: ContributorBookDeps

  constructor(deps: ContributorBookDeps) {
    this.deps = deps
  }

  /** 受管登记：有任一来源值则注册，否则注销。 */
  syncManaged(suffix: string, hasValue: boolean): void {
    const envName = envNameOf(suffix)
    const registered = this.managed.has(envName)
    if (hasValue && !registered) {
      this.registerManaged(suffix, envName)
      return
    }
    if (!hasValue && registered) {
      this.managed.get(envName)?.()
      this.managed.delete(envName)
    }
  }

  /** 继承登记：按 shouldForwardInherited 现判注册/注销。 */
  syncInherited(suffix: string): void {
    const envName = envNameOf(suffix)
    const registered = this.inherited.get(envName)
    if (this.deps.shouldForwardInherited(suffix) && registered === undefined) {
      const dispose = this.deps.shellEnv.register({
        name: `secret-env-inherited:${suffix}`,
        variables: { [envName as ManagedKey]: { description: 'inherited variable' } },
        resolve: (execution: ToolExecution) => {
          const value = this.deps.resolveInherited(suffix, execution)
          return value === undefined || value === '' ? {} : { [envName as ManagedKey]: value }
        },
      })
      this.inherited.set(envName, dispose)
      return
    }
    if (!this.deps.shouldForwardInherited(suffix) && registered !== undefined) {
      registered()
      this.inherited.delete(envName)
    }
  }

  private registerManaged(suffix: string, envName: string): void {
    // 同名继承 contributor 先让位（一键一主），受管接管该变量。
    const inherited = this.inherited.get(envName)
    if (inherited !== undefined) {
      inherited()
      this.inherited.delete(envName)
    }
    try {
      const dispose = this.deps.shellEnv.register({
        name: `secret-env:${suffix}`,
        variables: { [envName as ManagedKey]: { description: this.deps.describeManaged(suffix) } },
        resolve: (execution: ToolExecution) => {
          const value = this.deps.resolveManaged(suffix, execution)
          return value === undefined ? {} : { [envName as ManagedKey]: value }
        },
      })
      this.managed.set(envName, dispose)
    } catch (error) {
      throw new SecretEnvError(
        'conflict',
        `variable ${envName} conflicts with an existing contributor: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  dispose(): void {
    for (const dispose of this.managed.values()) dispose()
    this.managed.clear()
    for (const dispose of this.inherited.values()) dispose()
    this.inherited.clear()
  }
}
