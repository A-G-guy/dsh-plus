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
	id: "@dsh-plus/notify-email",
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
    // react 由外壳 ModuleLoader 提供（seed）；@dsh-plus/shared 按源码级打苞进
    // 本插件 bundle（shared 无 client bundle row，不能作为动态 external）。
    // tsdown deps：neverBundle 只留 react 系；alwaysBundle 需通配子路径
    // （picomatch 裸包名不匹配 `pkg/subpath`）。
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
