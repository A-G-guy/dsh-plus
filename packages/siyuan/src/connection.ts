/**
 * 本机 SiYuan 安装的连接解析：docker / 原生 / 纯 HTTP 三种形态下，
 * 自动推导 MCP 端点、API token 来源与 CLI 前缀（全部经注入依赖，可单测）。
 * @module @dsh-plus/siyuan/connection
 */
import type { SiyuanConnection } from './contract.ts'

/** 外部 I/O 注入面（docker exec / 文件读 / HTTP 探测 / 环境变量）。 */
export interface ConnectionDeps {
  /**
   * 执行一条命令并汇总结果；spawn 失败以外不 reject。
   * @param file - 可执行文件。
   * @param args - 参数（不做 shell 展开）。
   * @param options - 可选中止信号。
   */
  execFile(
    file: string,
    args: string[],
    options?: { signal?: AbortSignal },
  ): Promise<{ stdout: string; stderr: string; code: number }>
  readFile(path: string): Promise<string>
  fetchJson(
    url: string,
    options?: { signal?: AbortSignal },
  ): Promise<{ ok: boolean; status: number; body: unknown }>
  env: Record<string, string | undefined>
}

/** 连接解析所需的配置面（主插件 Config 的子集）。 */
export interface ConnectionConfig {
  mode: 'auto' | 'docker' | 'native' | 'http'
  endpoint: string
  container: string
  cliCommand: string[]
  cliWorkspace: string
  token: string
}

/** 默认容器内工作区路径（b3log/siyuan 镜像约定）。 */
const DOCKER_WORKSPACE = '/siyuan/workspace'
/** 默认原生安装工作区（`~/SiYuan`）。 */
const NATIVE_WORKSPACE = 'SiYuan'

/** 从 `docker ps` 输出中挑选 SiYuan 容器名；无匹配返回 undefined。 */
export function pickContainer(psOutput: string, preferred: string): string | undefined {
  const rows = psOutput
    .split(/\r?\n/)
    .map((line) => line.split('\t'))
    .filter((cells): cells is [string, string] => cells.length >= 2 && cells[0] !== undefined)
  if (preferred !== '') {
    const exact = rows.find(([name]) => name === preferred)
    if (exact !== undefined) return exact[0]
    return undefined
  }
  return rows.find(([name, image]) => /siyuan/i.test(`${name} ${image}`))?.[0]
}

/** 从 workspace/conf/conf.json 文本提取 API token；缺失/形状不符返回空串。 */
export function parseApiToken(confJson: string): string {
  try {
    const parsed: unknown = JSON.parse(confJson)
    if (typeof parsed !== 'object' || parsed === null) return ''
    const api = (parsed as { api?: unknown }).api
    if (typeof api !== 'object' || api === null) return ''
    const token = (api as { token?: unknown }).token
    return typeof token === 'string' ? token : ''
  } catch {
    return ''
  }
}

/** docker 命令失败（未安装/被拒）统一降级为 code=1 空输出，绝不上抛。 */
function failedExec(): { stdout: string; stderr: string; code: number } {
  return { stdout: '', stderr: '', code: 1 }
}

/** `docker ps` 容器清单；docker 不可用时按空清单处理。 */
async function dockerPs(
  deps: ConnectionDeps,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return await deps
    .execFile('docker', ['ps', '--format', '{{.Names}}\t{{.Image}}'])
    .catch(failedExec)
}

/** 自动判定形态：docker 容器在跑 → docker；显式 CLI 命令 → native；否则 http。 */
async function detectMode(
  config: ConnectionConfig,
  deps: ConnectionDeps,
): Promise<'docker' | 'native' | 'http'> {
  const ps = await dockerPs(deps)
  if (ps.code === 0 && pickContainer(ps.stdout, config.container) !== undefined) return 'docker'
  if (config.cliCommand.length > 0) return 'native'
  return 'http'
}

/** docker 形态：容器名、CLI 前缀与容器内 conf.json 的 token。 */
async function resolveDocker(
  config: ConnectionConfig,
  deps: ConnectionDeps,
): Promise<SiyuanConnection> {
  const ps = await dockerPs(deps)
  const container =
    config.container !== ''
      ? pickContainer(ps.stdout, config.container)
      : pickContainer(ps.stdout, '')
  if (container === undefined)
    throw new Error('SiYuan docker 模式：docker ps 未发现运行中的 SiYuan 容器')
  const workspace = config.cliWorkspace !== '' ? config.cliWorkspace : DOCKER_WORKSPACE
  let token = config.token
  if (token === '') {
    const conf = await deps
      .execFile('docker', ['exec', container, 'cat', `${workspace}/conf/conf.json`])
      .catch(failedExec)
    token = conf.code === 0 ? parseApiToken(conf.stdout) : ''
  }
  if (token === '' && deps.env.SIYUAN_TOKEN !== undefined) token = deps.env.SIYUAN_TOKEN
  return {
    mode: 'docker',
    endpoint: config.endpoint,
    token,
    cli: ['docker', 'exec', container, '/opt/siyuan/kernel'],
    workspace,
    container,
  }
}

/** 原生形态：显式 CLI 命令 + 本机工作区 conf.json 的 token。 */
function resolveNative(config: ConnectionConfig, deps: ConnectionDeps): SiyuanConnection {
  const workspace =
    config.cliWorkspace !== '' ? config.cliWorkspace : `${deps.env.HOME ?? '~'}/${NATIVE_WORKSPACE}`
  let token = config.token
  if (token === '' && deps.env.SIYUAN_TOKEN !== undefined) token = deps.env.SIYUAN_TOKEN
  return {
    mode: 'native',
    endpoint: config.endpoint,
    token,
    cli: [...config.cliCommand],
    workspace,
  }
}

/**
 * 解析连接事实（结果由调用方缓存；失败抛出带上下文的错误）。
 * @param config - 连接配置。
 * @param deps - 注入的 I/O 面。
 * @returns 连接描述；`cli` 为空数组表示无 CLI 兜底面。
 */
export async function resolveConnection(
  config: ConnectionConfig,
  deps: ConnectionDeps,
): Promise<SiyuanConnection> {
  const mode = config.mode === 'auto' ? await detectMode(config, deps) : config.mode
  if (mode === 'docker') return await resolveDocker(config, deps)
  if (mode === 'native') {
    const connection = resolveNative(config, deps)
    if (connection.token === '' && connection.cli.length > 0) {
      const conf = await deps
        .readFile(`${connection.workspace}/conf/conf.json`)
        .catch(() => undefined)
      if (conf !== undefined) connection.token = parseApiToken(conf)
    }
    return connection
  }
  const token = config.token !== '' ? config.token : (deps.env.SIYUAN_TOKEN ?? '')
  return { mode: 'http', endpoint: config.endpoint, token, cli: [], workspace: '' }
}
