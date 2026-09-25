/**
 * sw.js 脚本生成：把安全决策（decision.ts 自包含纯函数）与缓存策略
 * 渲染成一份独立的 Service Worker 脚本，由 node 半的精确路由对外服务。
 *
 * 设计要点（全部保守取向，宁可少缓存不可错缓存）：
 * - 不 skipWaiting、不 clients.claim：新版本等所有标签页关闭后才接管，
 *   绝不在会话中途换实现；首次注册只从下一次导航开始接管。
 * - passthrough 一大类（RPC、SSE、token 交换、跨源、Range、非 GET）
 *   不调 respondWith = 浏览器原生行为，零干预。
 * - 只有 status 200、type basic、且 cache-control 不含 no-store/no-cache
 *   的响应才入库——token 页（no-store）与代理侧 no-store 的 index 天然
 *   免疫，认证内容永不落 Cache Storage。
 * - 入库前剥离 content-encoding/content-length/transfer-encoding/vary：
 *   fetch() 暴露的 body 已解码，复制编码头会造成「解码头 + 原始体」错配
 *   （经典 SW 缓存坑）；存 identity 体，下次命中由 SW 直接原样返回。
 * - 缓存名带版本（ns.ts 的 SW_CACHE_NAME），activate 清理同前缀旧版本；
 *   源码逻辑变更时手动 +1 即可全量换血。
 *
 * 安全边界：`decideFetchAction` 无闭包依赖，toString() 内嵌后行为与
 * node 侧单测完全一致（tests/sw-script.test.ts 同时断言编译与内嵌等价）。
 * @module @dsh-plus/web-shell-sw/sw-script
 */
import { decideFetchAction } from './decision.ts'
import { SW_CACHE_NAME, SW_CACHE_PREFIX } from './ns.ts'

/**
 * 生成完整的 sw.js 脚本文本（纯函数，同配置恒等输出）。
 * @returns 可直接作为 application/javascript 响应体的脚本源码。
 */
export function buildServiceWorkerScript(): string {
  return `'use strict';
const CACHE_NAME = ${JSON.stringify(SW_CACHE_NAME)};
const CACHE_PREFIX = ${JSON.stringify(SW_CACHE_PREFIX)};
const decideFetch = ${decideFetchAction.toString()};

self.addEventListener('install', function () {
  // 不 skipWaiting：新版本等待所有标签页关闭后接管，避免会话中途换实现。
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys
          .filter(function (key) { return key.indexOf(CACHE_PREFIX) === 0 && key !== CACHE_NAME; })
          .map(function (key) { return caches.delete(key); })
      );
    })
  );
});

self.addEventListener('fetch', function (event) {
  const request = event.request;
  let url;
  try {
    url = new URL(request.url);
  } catch (error) {
    return;
  }
  if (url.origin !== self.location.origin) return;
  const action = decideFetch(
    request.method,
    url.pathname,
    url.search !== '',
    request.headers.has('range')
  );
  if (action === 'passthrough') return;
  event.respondWith(
    action === 'cache-first' ? cacheFirst(request) : shellNetworkFirst(request)
  );
});

/** 剥离编码相关头后再入库：fetch 的 body 已解码，保留编码头会造成解码错配。 */
function normalizeForCache(response) {
  const headers = new Headers(response.headers);
  ['content-encoding', 'content-length', 'transfer-encoding', 'vary'].forEach(function (name) {
    headers.delete(name);
  });
  return response.arrayBuffer().then(function (body) {
    return new Response(body, { status: response.status, statusText: response.statusText, headers: headers });
  });
}

/** 仅 200/basic/未标 no-store 且未标 no-cache 的响应可入库。 */
function isStorable(response) {
  if (response.status !== 200 || response.type !== 'basic') return false;
  const cacheControl = (response.headers.get('cache-control') || '').toLowerCase();
  return cacheControl.indexOf('no-store') === -1 && cacheControl.indexOf('no-cache') === -1;
}

function putNormalized(cache, request, response) {
  return normalizeForCache(response).then(
    function (stored) { return cache.put(request, stored); },
    function (error) { console.warn('[web-shell-sw] cache.put failed', error); }
  );
}

/** 内容寻址资源：命中即回；未命中回源，可存则存（存失败不影响本次响应）。 */
function cacheFirst(request) {
  return caches.open(CACHE_NAME).then(function (cache) {
    return cache.match(request).then(function (hit) {
      if (hit !== undefined) return hit;
      return fetch(request).then(function (response) {
        if (isStorable(response)) putNormalized(cache, request, response.clone());
        return response;
      });
    });
  });
}

/** index：网络优先（在线恒用最新外壳）；仅网络失败时才用缓存兜底，无缓存则原生失败。 */
function shellNetworkFirst(request) {
  return caches.open(CACHE_NAME).then(function (cache) {
    return fetch(request).then(
      function (response) {
        if (isStorable(response)) putNormalized(cache, request, response.clone());
        return response;
      },
      function (error) {
        return cache.match(request).then(function (hit) {
          if (hit !== undefined) return hit;
          throw error;
        });
      }
    );
  });
}
`
}
