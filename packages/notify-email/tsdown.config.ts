/**
 * 双入口构建（与 packages/ui-mobile-fit 同一约定）：
 * - src/index.ts → lib/index.js（ESM + dts，node 半）
 * - src/client/client.ts → lib/client.js（CJS factory bundle，浏览器半）
 *
 * 浏览器半必须是 window.__ModuleLoader__.load({id, factory}) 形式
 * （权威契约：dsh-client-modules README；参照官方 lib/client.js 产物）。
 * react / react/jsx-runtime 由外壳 ModuleLoader 提供，保持 external，
 * factory 体内经 require('react') 取得。
 */
import { defineConfig } from 'tsdown'

const CLIENT_BANNER = `window.__ModuleLoader__.load({
	id: "@dsh-custom/notify-email",
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
    external: ['react', 'react/jsx-runtime'],
    outputOptions: {
      entryFileNames: 'client.js',
      banner: CLIENT_BANNER,
      footer: CLIENT_FOOTER,
    },
  },
])
