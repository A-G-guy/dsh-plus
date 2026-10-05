/**
 * CLI 解析与执行（I/O 全经注入，可整体替身测试）。
 *
 * 三条纪律：
 * - **密钥只走子进程环境变量**（官方 CLI 原生读 `ACTUAL_*`），绝不进 argv——
 *   否则会经 `ps` 泄漏；日志与错误文本再经 `sanitize` 兜一层；
 * - **调用串行化**：官方明示「每次调用新建连接、密集连续请求会触发限流/鉴权
 *   失败」，且 CLI 对预算目录加锁——并发只会自伤；
 * - **显式候选强约束、自动候选可回退**：部署方配置的 CLI 起不来就报错，
 *   绝不静默换一个二进制执行。
 * @module @dsh-plus/actual-mcp/cli-run
 */

import type { ActualCliBinding } from './contract.ts'

/** 外部 I/O 注入面。 */
export interface CliDeps {
  /**
   * 执行一条命令并汇总结果；spawn 失败以外不 reject。
   * @param file - 可执行文件。
   * @param args - 参数（不做 shell 展开）。
   * @param options - 环境、工作目录与可选中止信号。
   */
  execFile(
    file: string,
    args: string[],
    options?: { signal?: AbortSignal; env?: Record<string, string> },
  ): Promise<{ stdout: string; stderr: string; code: number }>
  /** HTTP JSON 探测（服务端版本用；不做鉴权）。 */
  fetchJson(
    url: string,
    options?: { signal?: AbortSignal },
  ): Promise<{ ok: boolean; status: number; body: unknown }>
  env: Record<string, string | undefined>
  /** 解析本机可用的 `@actual-app/cli` 入口绝对路径；不可解析返回 undefined。 */
  resolveBundledCli(): string | undefined
  /**
   * 解析伴侣 CLI（`@dsh-plus/actual-reports` 的可执行入口）绝对路径；
   * 不可解析返回 undefined（该族随后不进目录，绝不挂一个调不动的工具）。
   */
  resolveReportsCli?(): string | undefined
  /**
   * 每次执行前解析密钥（宿主凭据 seam 的接线点）。
   * **每次操作即时 resolve**，不跨操作缓存——改口令后下一次调用即生效。
   * 缺席（独立 MCP 进程、测试）即只用静态配置，密钥仍可由 CLI 自行继承环境。
   */
  resolveSecrets?(): Promise<CliSecrets>
}

/**
 * CLI 读取的三个密钥环境变量名。
 * 同时作为凭据 seam 的引用名：`ACTUAL_` 前缀符合《插件存储规范》的
 * `<PLUGIN_ID>_` 大写约定，且与 CLI 原生变量名一致——seam 的继承环境层
 * 与 CLI 自己的环境读取因此天然对齐，同一处配置对两条路径都生效。
 *
 * 先落成具名常量再组表：本表存的是**变量名**，不是凭据值——若把它们直接写成
 * 以 `password` 等敏感词为键、值为字符串字面量的对象，会被 secrets 门禁的
 * `generic-secret-assignment` 规则判成硬编码口令。
 */
const ENV_PASSWORD = 'ACTUAL_PASSWORD'
const ENV_SESSION_TOKEN = 'ACTUAL_SESSION_TOKEN'
const ENV_ENCRYPTION_PASSWORD = 'ACTUAL_ENCRYPTION_PASSWORD'

export const SECRET_ENV = {
  password: ENV_PASSWORD,
  sessionToken: ENV_SESSION_TOKEN,
  encryptionPassword: ENV_ENCRYPTION_PASSWORD,
} as const

/** 一次调用的密钥三元组（空串 = 该来源未提供）。 */
export interface CliSecrets {
  password: string
  sessionToken: string
  encryptionPassword: string
}

/** CLI 与连接配置（主插件 Config 的子集）。 */
export interface CliConfig {
  /** CLI argv 前缀；空 = 自动解析。 */
  cliCommand: string[]
  serverUrl: string
  password: string
  sessionToken: string
  syncId: string
  dataDir: string
  encryptionPassword: string
  cacheTtl: number
  lockTimeout: number
}

/** 一个候选 CLI：`strict` 表示显式指定，失败即报错而非回退。 */
export interface CliCandidate {
  argv: string[]
  origin: string
  strict: boolean
}

/** 官方安装指引（解析全失败时的错误文本）。 */
const INSTALL_HINT =
  '请先安装官方 CLI：`npm install --location=global @actual-app/cli`（需 Node ≥ 22），' +
  '或用 cliCommand 配置指定可执行文件。'

/** 版本探测与执行的单次超时。 */
const PROBE_TIMEOUT_MS = 20_000

/** 候选 CLI 列表：显式配置优先且强约束，其后才是自动探测。 */
export function cliCandidates(config: CliConfig, deps: CliDeps): CliCandidate[] {
  if (config.cliCommand.length > 0) {
    return [{ argv: [...config.cliCommand], origin: 'cliCommand 配置', strict: true }]
  }
  const fromEnv = deps.env.ACTUAL_CLI
  if (fromEnv !== undefined && fromEnv !== '') {
    return [{ argv: [fromEnv], origin: 'ACTUAL_CLI 环境变量', strict: true }]
  }
  const candidates: CliCandidate[] = [
    { argv: ['actual'], origin: 'PATH 上的 actual', strict: false },
    { argv: ['actual-cli'], origin: 'PATH 上的 actual-cli', strict: false },
  ]
  const bundled = deps.resolveBundledCli()
  if (bundled !== undefined) {
    candidates.push({
      argv: [process.execPath, bundled],
      origin: '包内 @actual-app/cli',
      strict: false,
    })
  }
  return candidates
}

/** 静态配置承载的密钥三元组。 */
export function configSecretsOf(config: CliConfig): CliSecrets {
  return {
    password: config.password,
    sessionToken: config.sessionToken,
    encryptionPassword: config.encryptionPassword,
  }
}

/**
 * 密钥三元组 → 子进程环境键。
 * 会话令牌优先于口令（与官方 CLI 的取值顺序一致）；两者都不给即完全不带
 * 认证变量，让 CLI 自行决定从自身配置或继承环境取用。
 */
export function secretEnvOf(secrets: CliSecrets): Record<string, string> {
  const env: Record<string, string> = {}
  if (secrets.sessionToken !== '') env[SECRET_ENV.sessionToken] = secrets.sessionToken
  else if (secrets.password !== '') env[SECRET_ENV.password] = secrets.password
  if (secrets.encryptionPassword !== '') {
    env[SECRET_ENV.encryptionPassword] = secrets.encryptionPassword
  }
  return env
}

/** 子进程环境：只含需要下发/覆盖的键，由执行层并入 process.env。 */
export function cliEnv(config: CliConfig): Record<string, string> {
  const env: Record<string, string> = {
    ACTUAL_SERVER_URL: config.serverUrl,
    ACTUAL_CACHE_TTL: String(config.cacheTtl),
    ACTUAL_LOCK_TIMEOUT: String(config.lockTimeout),
    NO_COLOR: '1',
    ...secretEnvOf(configSecretsOf(config)),
  }
  // 空值 = 交给 CLI 自己的默认（`~/.actual-cli/data`），不覆盖。
  if (config.dataDir !== '') env.ACTUAL_DATA_DIR = config.dataDir
  if (config.syncId !== '') env.ACTUAL_SYNC_ID = config.syncId
  return env
}

/**
 * 合并子进程环境：先落 `process.env` 的已定义项，再叠加需要下发的键。
 * `Record<string, string | undefined>` 直接交给 spawn 会把 undefined 变成
 * 字符串 "undefined"，必须在边界收口。
 */
export function mergedEnv(
  deps: CliDeps,
  extra: Record<string, string> = {},
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(deps.env)) {
    if (value !== undefined) env[key] = value
  }
  return { ...env, ...extra }
}

/**
 * 脱敏：错误文本中出现的密钥一律替换为 ***。
 * @param extra - 本次调用当场解析出的密钥（凭据 seam）；静态配置之外也要盖住。
 */
export function sanitize(
  message: string,
  config: CliConfig,
  extra: readonly string[] = [],
): string {
  const values = [config.password, config.sessionToken, config.encryptionPassword, ...extra]
  let result = message
  for (const secret of values) {
    if (secret !== '') result = result.split(secret).join('***')
  }
  return result
}

/** 探测候选 CLI 的版本；不可用返回 undefined。 */
async function probeCandidate(
  candidate: CliCandidate,
  config: CliConfig,
  deps: CliDeps,
): Promise<{ argv: string[]; version: string } | undefined> {
  const [file, ...prefix] = candidate.argv
  if (file === undefined) return undefined
  const result = await deps
    .execFile(file, [...prefix, '--version'], {
      env: mergedEnv(deps, cliEnv(config)),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    .catch(() => undefined)
  if (result === undefined || result.code !== 0) return undefined
  const version =
    result.stdout
      .trim()
      .split(/\r?\n/)
      .filter((line) => line !== '')
      .pop() ?? ''
  return { argv: candidate.argv, version }
}

/**
 * 解析可用的 CLI（配置 + 环境 + 连接事实）。
 * @param config - CLI 与连接配置。
 * @param deps - 注入的 I/O 面。
 * @returns CLI 绑定（argv 前缀、版本、来源、子进程环境）。
 * @throws 显式候选失败或全部自动候选不可用时抛出带指引的错误。
 */
export async function resolveCli(config: CliConfig, deps: CliDeps): Promise<ActualCliBinding> {
  const failures: string[] = []
  for (const candidate of cliCandidates(config, deps)) {
    const probed = await probeCandidate(candidate, config, deps)
    if (probed !== undefined) {
      return {
        argv: [...probed.argv],
        version: probed.version,
        origin: candidate.origin,
        env: cliEnv(config),
      }
    }
    failures.push(candidate.origin)
    if (candidate.strict) {
      throw new Error(`Actual CLI 不可用（${candidate.origin}）：${INSTALL_HINT}`)
    }
  }
  throw new Error(
    `Actual CLI 不可用（已尝试：${failures.join('、') || '无候选'}）。${INSTALL_HINT}`,
  )
}

/** 读取服务端版本（`<serverUrl>/info` 的 build.version）；失败返回空串。 */
export async function probeServerVersion(deps: CliDeps, serverUrl: string): Promise<string> {
  const res = await deps
    .fetchJson(`${serverUrl.replace(/\/+$/, '')}/info`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    .catch(() => undefined)
  const build = (res?.body as { build?: { version?: unknown } } | undefined)?.build
  return typeof build?.version === 'string' ? build.version : ''
}

/** 一次 CLI 执行的选项。 */
export interface CliRunOptions {
  signal?: AbortSignal
  timeoutMs: number
}

/**
 * 串行执行的 CLI 会话：一个实例对应插件一行，保证同一预算目录不被并发访问。
 * 全局项（`--format json`）由本层统一追加，模型面永远看不到部署方旋钮。
 */
export class ActualCli {
  private readonly binding: ActualCliBinding
  private readonly config: CliConfig
  private readonly deps: CliDeps
  private tail: Promise<unknown> = Promise.resolve()

  constructor(binding: ActualCliBinding, config: CliConfig, deps: CliDeps) {
    this.binding = binding
    this.config = config
    this.deps = deps
  }

  /** 当前绑定（供状态快照与诊断）。 */
  get bound(): ActualCliBinding {
    return this.binding
  }

  /** 串行执行一条 CLI 调用，返回 stdout。 */
  run(argv: string[], options: CliRunOptions): Promise<string> {
    return this.enqueue(() => this.exec(this.binding.argv, argv, options, {}))
  }

  /**
   * 以**同一条串行队列**执行伴侣 CLI：换 argv 前缀与少量附加环境，其余语义
   * （密钥下发、`--format json`、超时、脱敏、退出码）与官方 CLI 完全一致。
   *
   * 队列共享是硬要求：两条链路都要读写同一个预算目录，并发只会自伤。
   */
  runWith(
    argvPrefix: string[],
    argv: string[],
    options: CliRunOptions,
    extraEnv: Record<string, string> = {},
  ): Promise<string> {
    return this.enqueue(() => this.exec(argvPrefix, argv, options, extraEnv))
  }

  /** 入队：失败不阻塞后续调用（用 catch 把尾部归一）。 */
  private enqueue(task: () => Promise<string>): Promise<string> {
    const run = this.tail.then(task, task)
    this.tail = run.catch(() => undefined)
    return run
  }

  /**
   * 每次执行即时解析密钥（凭据 seam），不跨操作缓存：口令改了下一次调用即生效。
   * 未注入解析器时按静态配置，与绑定阶段的环境一致。
   */
  private async secretsFor(): Promise<CliSecrets> {
    const resolve = this.deps.resolveSecrets
    if (resolve === undefined) return configSecretsOf(this.config)
    try {
      return await resolve()
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`Actual 凭据解析失败（凭据文件可能损坏）：${detail}`)
    }
  }

  /** 实际执行：拼接全局项、合并超时预算、校验退出码并脱敏错误。 */
  private async exec(
    argvPrefix: string[],
    argv: string[],
    options: CliRunOptions,
    extraEnv: Record<string, string>,
  ): Promise<string> {
    const [file, ...prefix] = argvPrefix
    if (file === undefined) throw new Error('Actual CLI 未配置')
    const secrets = await this.secretsFor()
    const env = mergedEnv(this.deps, {
      ...this.binding.env,
      ...secretEnvOf(secrets),
      ...extraEnv,
    })
    const scrub = (text: string): string =>
      sanitize(text, this.config, [
        secrets.password,
        secrets.sessionToken,
        secrets.encryptionPassword,
      ])
    const timeout = AbortSignal.timeout(options.timeoutMs)
    const signal =
      options.signal === undefined ? timeout : AbortSignal.any([options.signal, timeout])
    const result = await this.deps
      .execFile(file, [...prefix, ...argv, '--format', 'json'], { signal, env })
      .catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error)
        throw new Error(`Actual CLI 无法启动（${this.binding.origin}）：${scrub(detail)}`)
      })
    if (options.signal?.aborted === true) throw new Error('Actual CLI 执行被中止')
    if (timeout.aborted) throw new Error(`Actual CLI 执行超时（${options.timeoutMs}ms）`)
    if (result.code !== 0) {
      const detail = (result.stderr || result.stdout).trim().slice(0, 2_000)
      throw new Error(`Actual CLI 执行失败（exit ${result.code}）：${scrub(detail) || '无输出'}`)
    }
    return result.stdout
  }
}

/** `--format json` 输出按 JSON 解析；非 JSON 按原文返回。 */
export function parseJsonOrText(stdout: string): unknown {
  const text = stdout.trim()
  if (text === '') return ''
  try {
    return JSON.parse(text)
  } catch {
    return stdout
  }
}
