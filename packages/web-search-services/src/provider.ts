/**
 * dsh-web 搜索 provider：把 ctx.web.search 桥接到 search-services skill 的
 * search.py（Tavily / Exa / OpenAI Chat 免费额度后端）。官方 web_search 工具、
 * 渲染与提示词零修改——本 provider 只产出标准 WebSearchResult，格式化天然一致。
 * @module web-search-services/provider
 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import type { WebSearchProvider, WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web'
import { WebError } from '@deepseek-ai/dsh-web'

import { buildSearchArgv } from './args.ts'
import type { SearchBackend, WebSearchServicesConfig } from './config.ts'
import { expandHome, loadEnvFile } from './env-file.ts'
import { normalizeSearchOutput } from './normalize.ts'
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

  constructor(current: () => WebSearchServicesConfig, spawnFn?: SpawnFn | undefined) {
    this.current = current
    this.spawnFn = spawnFn
  }

  /** 廉价本地检查：脚本存在 + 优先级内至少一个后端有 key；不做网络调用。 */
  available(): boolean {
    const cfg = this.current()
    if (!existsSync(resolveScriptPath(cfg.scriptPath))) return false
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
    try {
      return await runProcess({
        command: cfg.python,
        args: [resolveScriptPath(cfg.scriptPath), ...argv],
        env: this.childEnv(cfg),
        timeoutMs: cfg.timeoutMs,
        ...(signal !== undefined ? { signal } : {}),
        ...(this.spawnFn !== undefined ? { spawnFn: this.spawnFn } : {}),
      })
    } catch (err) {
      throw toWebError(err)
    }
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
