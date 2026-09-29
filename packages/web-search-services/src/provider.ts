/**
 * dsh-web 搜索 provider：把 ctx.web.search 桥接到 search-services skill 的
 * search.py（Tavily / Exa / OpenAI Chat 免费额度后端）。官方 web_search 工具、
 * 渲染与提示词零修改——本 provider 只产出标准 WebSearchResult，格式化天然一致。
 * @module web-search-services/provider
 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web'
import { WebError } from '@deepseek-ai/dsh-web'

import { buildSearchArgv } from './args.ts'
import type { SearchBackend, WebSearchServicesConfig } from './config.ts'
import { expandHome, loadEnvFile } from './env-file.ts'
import { normalizeSearchOutput } from './normalize.ts'
import {
  type PythonCandidate,
  type PythonDiscoveryEnv,
  pythonCandidates,
  realPythonFs,
} from './python.ts'
import { isAbortError, runProcess, type SpawnFn } from './runner.ts'

export const PROVIDER_ID = 'search-services'

/**
 * scriptPath 解析：空串 = 随包内置脚本副本（tgz 内 scripts/search.py，与 lib/
 * 同级；src 直跑时为包根 scripts/）。非空按 ~ 展开。
 */
export function resolveScriptPath(scriptPath: string): string {
  if (scriptPath.trim() !== '') return expandHome(scriptPath)
  return fileURLToPath(new URL('../scripts/search.py', import.meta.url))
}

/** 各后端在合并环境（进程 env ⊕ envFile ⊕ 行级 keys）中的可用性判定变量。 */
const BACKEND_KEY_VARS: Readonly<Record<SearchBackend, readonly string[]>> = {
  tavily: ['TAVILY_API_KEY', 'TAVILY_API_KEYS'],
  exa: ['EXA_API_KEY'],
  'openai-chat': ['SEARCH_OPENAI_API_KEY'],
}

/** 行级 keys 覆盖 → 子进程环境变量；空串不注入（保持 envFile 单事实源优先）。 */
export function keyOverridesEnv(keys: WebSearchServicesConfig['keys']): Record<string, string> {
  const out: Record<string, string> = {}
  if (keys.tavily !== '') out.TAVILY_API_KEY = keys.tavily
  if (keys.exa !== '') out.EXA_API_KEY = keys.exa
  if (keys.openaiApiKey !== '') out.SEARCH_OPENAI_API_KEY = keys.openaiApiKey
  if (keys.openaiBaseUrl !== '') out.SEARCH_OPENAI_BASE_URL = keys.openaiBaseUrl
  if (keys.openaiModel !== '') out.SEARCH_OPENAI_MODEL = keys.openaiModel
  return out
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * 判定「解释器缺失」类失败（spawn ENOENT，runProcess 包装时保留 cause）：
 * 候选链据此换下一个解释器；其余错误照常上抛。
 */
function isMissingInterpreter(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const cause = err.cause as { code?: unknown } | undefined
  return cause?.code === 'ENOENT'
}

function toWebError(err: unknown): WebError {
  if (err instanceof WebError) return err
  if (isAbortError(err)) return new WebError('搜索已取消', 'WEB_ABORTED', { cause: err })
  return new WebError(`search-services 搜索失败: ${messageOf(err)}`, 'WEB_PROVIDER_ERROR', {
    cause: err,
  })
}

export class SearchServicesProvider implements WebSearchProvider {
  readonly id = PROVIDER_ID

  private readonly current: () => WebSearchServicesConfig
  private readonly spawnFn: SpawnFn | undefined
  private readonly discovery: () => PythonDiscoveryEnv
  /** 候选链按 `${python}|${bundledRoot}` 记忆：PATH 与捆绑布局在进程内静态。 */
  private readonly candidateCache = new Map<string, PythonCandidate[]>()

  constructor(
    current: () => WebSearchServicesConfig,
    spawnFn?: SpawnFn | undefined,
    discovery?: (() => PythonDiscoveryEnv) | undefined,
  ) {
    this.current = current
    this.spawnFn = spawnFn
    this.discovery =
      discovery ??
      (() => ({
        platform: process.platform,
        pathValue: process.env.PATH ?? process.env.Path,
        bundledRoot: dshHomePath('dsh-runtimes', 'dsh-primary-runtime'),
        fs: realPythonFs(),
      }))
  }

  /** 解释器候选链（有序、记忆化）。 */
  private candidates(): PythonCandidate[] {
    const cfg = this.current()
    const env = this.discovery()
    const key = `${cfg.python}|${env.bundledRoot ?? ''}`
    const cached = this.candidateCache.get(key)
    if (cached !== undefined) return cached
    const resolved = pythonCandidates(env, cfg.python)
    this.candidateCache.set(key, resolved)
    return resolved
  }

  /**
   * 廉价本地检查：脚本存在 + 至少一个【已验证】解释器候选（配置/捆绑/PATH，
   * 未验证兜底名不算）+ 优先级内至少一个后端有 key；不做网络调用、不 spawn。
   */
  available(): boolean {
    const cfg = this.current()
    if (!existsSync(resolveScriptPath(cfg.scriptPath))) return false
    if (!this.candidates().some((candidate) => candidate.source !== 'fallback')) return false
    const env = this.childEnv(cfg)
    return cfg.priority.some((backend) =>
      BACKEND_KEY_VARS[backend].some((name) => (env[name]?.trim() ?? '') !== ''),
    )
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const cfg = this.current()
    const argv = buildSearchArgv(cfg, request)
    const stdout = await this.run(cfg, argv, signal)
    return this.normalize(stdout)
  }

  private childEnv(cfg: WebSearchServicesConfig): NodeJS.ProcessEnv {
    const fromFile = cfg.envFile.trim() === '' ? {} : loadEnvFile(cfg.envFile)
    return { ...process.env, ...fromFile, ...keyOverridesEnv(cfg.keys) }
  }

  private async run(
    cfg: WebSearchServicesConfig,
    argv: string[],
    signal: AbortSignal | undefined,
  ): Promise<string> {
    const script = resolveScriptPath(cfg.scriptPath)
    const env = this.childEnv(cfg)
    let lastMissing: unknown
    // 候选链逐个尝试：仅解释器缺失（ENOENT）换下一个，其余错误立即上抛。
    for (const candidate of this.candidates()) {
      try {
        return await runProcess({
          command: candidate.command,
          args: [...candidate.argsPrefix, script, ...argv],
          env,
          timeoutMs: cfg.timeoutMs,
          ...(signal !== undefined ? { signal } : {}),
          ...(this.spawnFn !== undefined ? { spawnFn: this.spawnFn } : {}),
        })
      } catch (err) {
        if (!isMissingInterpreter(err)) throw toWebError(err)
        lastMissing = err
      }
    }
    throw toWebError(
      lastMissing ?? new Error('未找到可用的 python 解释器（配置 python 或安装 python3）'),
    )
  }

  private normalize(stdout: string): WebSearchResult {
    let raw: unknown
    try {
      raw = JSON.parse(stdout)
    } catch (err) {
      const preview = stdout.trim().slice(-200)
      throw new WebError(`search.py 输出非 JSON: …${preview}`, 'WEB_PROVIDER_ERROR', {
        cause: err,
      })
    }
    try {
      return normalizeSearchOutput(raw)
    } catch (err) {
      throw new WebError(`search.py 结果归一化失败: ${messageOf(err)}`, 'WEB_PROVIDER_ERROR', {
        cause: err,
      })
    }
  }
}
