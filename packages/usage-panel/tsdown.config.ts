/**
 * 双入口构建（与 packages/notify-email 同一约定）：
 * - src/index.ts → lib/index.js（ESM + dts，node 半）
 * - src/client/client.ts → lib/client.js（CJS factory bundle，浏览器半）
 *
 * 浏览器半必须是 window.__ModuleLoader__.load({id, factory}) 形式
 * （权威契约：dsh-client-modules README）。react 由外壳 ModuleLoader 提供
 * （seed）；@dsh-plus/shared 按源码级打苞（shared 无 client bundle row）。
 */
import { defineConfig } from 'tsdown'

const CLIENT_BANNER = `window.__ModuleLoader__.load({
	id: "@dsh-plus/usage-panel",
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
      // 宿主只服务单文件 client.js：代码分割的 chunk 进不了模块表，必须内联。
      inlineDynamicImports: true,
    },
    // 浏览器无 process 全局：折叠打包依赖（scheduler/shiki 等）的 NODE_ENV 分支。
    define: { 'process.env.NODE_ENV': '"production"' },
  },
])
