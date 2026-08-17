/**
 * 双入口构建：
 * - src/index.ts → lib/index.js（ESM + dts，node 半）
 * - src/client.ts → lib/client.js（CJS factory bundle，浏览器半）
 *
 * 浏览器半必须是 window.__ModuleLoader__.load({id, factory}) 形式
 * （权威契约：dsh-client-modules README；参照官方 lib/client.js 产物）。
 * 用 banner/footer 把 tsdown 的 CJS 输出包进 factory 体：CJS 输出只引用
 * exports / module / require 三个自由变量，全部由 factory 外壳提供。
 * 客户端半零运行时依赖（样式为构建期内联的 TS 模板串），factory 内
 * 不会真实调用 require。
 */
import { defineConfig } from 'tsdown'

const CLIENT_BANNER = `window.__ModuleLoader__.load({
	id: "@dsh-custom/ui-mobile-fit",
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
    entry: 'src/client.ts',
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
