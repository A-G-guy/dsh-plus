/**
 * 解释器发现单测：候选链顺序（配置 → 捆绑运行时 → PATH → 兜底）与
 * win32 形态（.exe 后缀、py -3 前缀）在 Linux 上经注入 fs 覆盖。
 * @module @dsh-plus/web-search-services/tests/python
 */
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'

import { type PythonDiscoveryEnv, type PythonFs, pythonCandidates } from '../src/python.ts'

/** 内存文件系统视图：entries = 绝对路径 → 是否目录（缺省视为不存在/文件）。 */
function fakeFs(entries: Record<string, boolean>): PythonFs {
  return {
    exists: (path) => path in entries,
    list: (path) => {
      const prefix = path.endsWith('/') ? path : `${path}/`
      const out: { name: string; dir: boolean }[] = []
      for (const [key, dir] of Object.entries(entries)) {
        if (key.startsWith(prefix) && !key.slice(prefix.length).includes('/')) {
          out.push({ name: key.slice(prefix.length), dir })
        }
      }
      return out
    },
  }
}

function envOf(overrides: Partial<PythonDiscoveryEnv> = {}): PythonDiscoveryEnv {
  return {
    platform: 'linux',
    pathValue: '/usr/bin:/bin',
    bundledRoot: undefined,
    fs: fakeFs({ '/usr/bin': true, '/usr/bin/python3': false }),
    ...overrides,
  }
}

test('given explicit config with args, when resolving, then it is the only candidate', () => {
  const candidates = pythonCandidates(envOf(), 'py -3')
  assert.equal(candidates.length, 1)
  assert.deepEqual(candidates[0], { command: 'py', argsPrefix: ['-3'], source: 'config' })
})

test('given python3 in PATH, when resolving, then path hit precedes unverified fallbacks', () => {
  const candidates = pythonCandidates(envOf(), '')
  assert.equal(candidates[0]?.source, 'path')
  assert.equal(candidates[0]?.command, '/usr/bin/python3')
  assert.ok(candidates.some((candidate) => candidate.source === 'fallback'))
})

test('given empty config, when resolving on win32 PATH with python.exe, then exe candidates use PATHEXT names', () => {
  // 键与被测实现同用 join 拼接（宿主是 Linux 时 join 插入 /，语义一致即可）。
  const fs = fakeFs({
    'C:\\Windows': true,
    [join('C:\\Windows', 'python.exe')]: false,
  })
  const candidates = pythonCandidates(
    envOf({ platform: 'win32', pathValue: 'C:\\Windows', fs }),
    '',
  )
  assert.equal(candidates[0]?.command, join('C:\\Windows', 'python.exe'))
  assert.ok(candidates.some((c) => c.command === 'py' && c.argsPrefix.includes('-3')))
})

test('given no verified interpreter, when resolving, then only fallback candidates remain (available = false signal)', () => {
  const candidates = pythonCandidates(
    envOf({ pathValue: '/empty-dir', fs: fakeFs({ '/empty-dir': true }) }),
    '',
  )
  assert.ok(candidates.length > 0)
  assert.ok(candidates.every((candidate) => candidate.source === 'fallback'))
})

test('given a bundled runtime layout, when resolving, then the bundled interpreter wins over PATH', () => {
  const fs = fakeFs({
    '/home/u/.dsh/dsh-runtimes/dsh-primary-runtime': true,
    '/home/u/.dsh/dsh-runtimes/dsh-primary-runtime/bin': true,
    '/home/u/.dsh/dsh-runtimes/dsh-primary-runtime/bin/python3': false,
  })
  const candidates = pythonCandidates(
    envOf({ bundledRoot: '/home/u/.dsh/dsh-runtimes/dsh-primary-runtime', fs }),
    '',
  )
  assert.equal(candidates[0]?.source, 'bundled')
  assert.equal(candidates[0]?.command, '/home/u/.dsh/dsh-runtimes/dsh-primary-runtime/bin/python3')
})

test('given a bundled root whose tree hides the interpreter under noise dirs only, when resolving, then no bundled candidate', () => {
  const fs = fakeFs({
    '/rt': true,
    '/rt/Lib': true,
    '/rt/Lib/site-packages': true,
    '/rt/Lib/site-packages/python': false,
  })
  const candidates = pythonCandidates(envOf({ bundledRoot: '/rt', fs }), '')
  assert.ok(candidates.every((candidate) => candidate.source !== 'bundled'))
})

test('given a missing bundled root, when resolving, then discovery skips BFS without error', () => {
  const candidates = pythonCandidates(
    envOf({
      bundledRoot: '/absent-root',
      fs: fakeFs({ '/usr/bin': true, '/usr/bin/python3': false }),
    }),
    '',
  )
  assert.equal(candidates[0]?.source, 'path')
})
