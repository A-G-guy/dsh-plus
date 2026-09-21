/**
 * search.py 子命令参数组装（纯函数）。
 * 优先级直接透传 --service：search.py 自带链内 fallback 与 Tavily 多 key 轮转，
 * 插件不重复实现回退编排。
 * @module web-search-services/args
 */
import type { WebSearchRequest } from '@deepseek-ai/dsh-web'

import type { WebSearchServicesConfig } from './config.ts'

/** dsh-tool-web 之外的调用方未给 maxResults 时的请求层缺省。 */
export const FALLBACK_MAX_RESULTS = 8

/** 由 web 请求 + 插件配置生成 search.py 的 argv（不含解释器与脚本路径）。 */
export function buildSearchArgv(cfg: WebSearchServicesConfig, request: WebSearchRequest): string[] {
  const query = request.query.trim()
  if (query === '') {
    throw new Error('query must be a non-empty string')
  }
  const maxResults = request.maxResults ?? FALLBACK_MAX_RESULTS
  return [
    'search',
    '--query',
    query,
    '--service',
    cfg.priority.join(','),
    '--max-results',
    String(maxResults),
  ]
}
