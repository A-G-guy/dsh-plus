/**
 * 双入口构建（与 packages/notify-email 同一约定）：
 * - src/index.ts → lib/index.js（ESM + dts，node 半）
 * - src/client/client.ts → lib/client.js（CJS factory bundle，浏览器半哨兵）
 * 浏览器半为 window.__ModuleLoader__.load({id, factory}) 形式，零依赖。
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
    dts: true,
    outDir: 'lib',
  },
  {
    entry: 'src/client/client.ts',
    format: 'cjs',
    dts: true,
    outDir: 'lib',
    outputOptions: {
      entryFileNames: 'client.js',
      banner: CLIENT_BANNER,
      footer: CLIENT_FOOTER,
    },
  },
])
