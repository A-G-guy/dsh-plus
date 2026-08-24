/**
 * 双入口构建（与 packages/notify-email 同一约定）：
 * - src/index.ts → lib/index.js（ESM + dts，node 半）
 * - src/client/client.ts → lib/client.js（CJS factory bundle，浏览器半）
 * 浏览器半为 window.__ModuleLoader__.load({id, factory}) 形式。
 * 哨兵段保持零依赖（client.ts 不 import 包）；健康页经 require('./health-tab.js')
 * 延迟加载（rolldown 内联为同步 require，react 由外壳 seed 提供）。
 */
import { defineConfig } from 'tsdown'

const CLIENT_BANNER = `window.__ModuleLoader__.load({
	id: "@dsh-plus/lifeboat",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
`

const CLIENT_FOOTER = `		return module.exports;
	}
});
`

export default defineConfig([
  {
    entry: 'src/index.ts',
    format: 'esm',
    fixedExtension: false,
    dts: true,
    outDir: 'lib',
  },
  {
    entry: 'src/client/client.ts',
    format: 'cjs',
    fixedExtension: false,
    dts: true,
    outDir: 'lib',
    deps: {
      neverBundle: ['react', 'react/jsx-runtime'],
      alwaysBundle: ['@dsh-plus/shared/**'],
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: CLIENT_BANNER,
      footer: CLIENT_FOOTER,
    },
  },
])
