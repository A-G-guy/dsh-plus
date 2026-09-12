/**
 * 引导脚本生成：把「官方 loadBundle 缝的零缓存重试包装」渲染成一段内联
 * classic script，经 `webserver/index-inject` 注入到 index.html 的 head。
 *
 * 为什么必须是内联 classic 脚本（注入时序，实测于 0.1.5-rc.2）：
 * index.html 的 head 里依次是
 *   1) 模块表引导队列（inline classic）
 *   2) application 批次 <link rel=preload as=script>    ← 预加载在此启动
 *   3) bootstrap 批次 <script src=/plugins/...>           ← 模块系统在此就绪
 *   4) __DSH_BOOT__ 启动图（inline classic）
 *   5) 本插件的注入行（位于 head 末段：结构化注入行渲染在 head 开头，
 *      而 index 自带的外壳标签跟在其后）
 *   6) 外壳 <script type="module" src=/assets/index-*.js>
 *
 * 关键在 6) 是 `type=module`：按 HTML 规范 module 脚本默认 defer，文档解析
 * 完成后才执行；而本行是 classic inline，解析到即执行。因此无论注入行落在
 * head 的哪一段，都必然早于外壳执行——官方 `dsh-client-web` 正是在外壳运行时
 * 才读取 `globalThis.__DSH_TRANSPORT__?.loadBundle`，赋值必然被读到。
 *
 * 覆盖边界（重要）：第 3 步 bootstrap 脚本是 parser-blocking 且位置早于本行，
 * 若它加载失败，本插件兜不住（官方在此处也没有重试）。该文件是
 * `@deepseek-ai/dsh-client-modules` 单模块 combo，实测 gzip 约 6.4 KB，
 * 体积小、失败概率远低于 62 模块的 application 批次。
 * 不为此增加复杂度：要覆盖第 3 步只能改 index 渲染顺序或另加路由，
 * 收益与风险不成比例。
 *
 * 第 2 步的 `<link rel=preload as=script>` 只是提示：预取失败是静默的、
 * 不产生致命错误；真正的执行路径始终是 `loadBundle(url)` 新建的 `<script>`
 * 元素（见 client-modules 的 arrive → loadBundle）。因此 application 批次的
 * 实际加载——无论缓存命中与否——全部落在本包装内。
 *
 * 为什么只重试、零缓存：外壳调用 loadBundle(url) 后 await，官方随即校验
 * 「该 url 必须已通过 __ModuleLoader__.load 注册工厂」。重试 = 丢弃失败的
 * <script> 元素并新建一个同 URL 的新元素；URL 不变，故 HMR 的
 * invalidate→prefetch 语义完全不受影响（rev 变则 url 变，必然取新字节）。
 * 本脚本不读取、不存储、不重放任何响应体。
 * @module @dsh-plus/boot-retry/boot-script
 */

/** 注入脚本占用的全局名（哨兵，用于幂等判定）。 */
export const SENTINEL = '__DSH_PLUS_BOOT_RETRY__'

/**
 * 官方 loadBundle 的契约：返回 Promise，load 时 resolve 且脚本须已完成
 * 工厂注册；失败时 reject。classic script + async 的执行语义与官方
 * `defaultLoadBundle` 逐条对齐。
 * @param url - 官方给出的 bundle URL（含内容寻址 rev）。
 * @returns 脚本 load 后 resolve，error 后 reject。
 */
export type LoadBundle = (url: string) => Promise<void>

/** 生成内联引导脚本正文。 */
export function bootRetryScript(config: {
  maxAttempts: number
  backoffMs: number[]
  retryShellScript: boolean
  shellMaxAttempts: number
}): string {
  const params = JSON.stringify({
    maxAttempts: config.maxAttempts,
    backoff: config.backoffMs,
    retryShell: config.retryShellScript,
    shellMaxAttempts: config.shellMaxAttempts,
  })
  return `(() => {
  const SENTINEL = ${JSON.stringify(SENTINEL)}
  if (globalThis[SENTINEL] === true) return
  globalThis[SENTINEL] = true
  const cfg = ${params}

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const backoffFor = (attempt) => {
    const list = cfg.backoff
    if (!Array.isArray(list) || list.length === 0) return 0
    return list[Math.min(attempt, list.length - 1)]
  }

  /**
   * 加载一个 classic script；失败时移除元素、退避后原样重试。
   * 不做任何缓存与响应体读取：每次尝试都是一次全新的同 URL 请求。
   */
  const loadWithRetry = (url, maxAttempts) => new Promise((resolve, reject) => {
    let attempt = 0
    const spawn = () => {
      attempt += 1
      const el = document.createElement('script')
      el.async = true
      el.src = url
      const cleanup = () => { el.remove() }
      el.addEventListener('load', () => { cleanup(); resolve() }, { once: true })
      el.addEventListener('error', () => {
        cleanup()
        if (attempt >= maxAttempts) {
          reject(new Error('boot-retry: script ' + url + ' failed after ' + String(attempt) + ' attempt(s)'))
          return
        }
        console.warn('[boot-retry] ' + url + ' failed (attempt ' + String(attempt) + '/' + String(maxAttempts) + '), retrying')
        sleep(backoffFor(attempt - 1)).then(spawn)
      }, { once: true })
      document.head.append(el)
    }
    spawn()
  })

  // 1) 官方缝：外壳读 globalThis.__DSH_TRANSPORT__.loadBundle。
  //    已存在则完全不接管（尊重未来官方或他方实现）。
  const transport = (globalThis.__DSH_TRANSPORT__ ??= {})
  if (transport.loadBundle === undefined) {
    transport.loadBundle = (url) => loadWithRetry(url, cfg.maxAttempts)
  }

  // 2) 外壳 module 脚本兜底：<script type=module> 失败不会自动重试，
  //    且其 error 事件在 window 上以捕获阶段冒泡到达。
  if (cfg.retryShell === true) {
    const isShellAsset = (url) => /\\/assets\\/index-[^/]+\\.js(?:[?#]|$)/.test(url)
    let shellRetries = 0
    globalThis.addEventListener('error', (event) => {
      const target = event.target
      if (target === null || target === undefined) return
      if (target.tagName !== 'SCRIPT') return
      const src = target.src
      if (typeof src !== 'string' || !isShellAsset(src)) return
      if (shellRetries >= cfg.shellMaxAttempts) return
      shellRetries += 1
      const url = new URL(src, location.href)
      // 换一个查询参数强制新建一个 module script（同 src 的 module 只会执行一次）。
      url.searchParams.set('__dsh_retry', String(shellRetries))
      console.warn('[boot-retry] shell script failed, retry ' + String(shellRetries) + '/' + String(cfg.shellMaxAttempts))
      const next = document.createElement('script')
      next.type = 'module'
      next.crossOrigin = target.crossOrigin
      next.src = url.href
      target.remove()
      document.head.append(next)
    }, true)
  }
})()`
}
