/**
 * 双入口构建（模式与 @dsh-plus/web-files 一致）：
 * - src/index.ts → lib/index.js（ESM + dts，node 半）
 * - src/client.tsx → lib/client.js（CJS factory bundle，浏览器半）
 *
 * 浏览器半必须是 window.__ModuleLoader__.load({id, factory}) 形式
 * （权威契约：dsh-client-modules README）。平台 seed 词（react、
 * react-dom、@deepseek-ai/cordis、@deepseek-ai/dsh-client-ui-primitives
 * 等）构建期 external，运行时由模块表供给；@dsh-plus/shared 按源码级
 * 打苞（shared 无 client bundle row）；xterm 及 addon 全量内联打包
 * （宿主只服务 client.js 单文件，禁止动态分包）。
 */
import { defineConfig } from 'tsdown'

const CLIENT_BANNER = `window.__ModuleLoader__.load({
	id: "@dsh-plus/web-terminal",
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
    entry: 'src/client.tsx',
    format: 'cjs',
    fixedExtension: false,
    dts: true,
    outDir: 'lib',
    deps: {
      neverBundle: [
        'react',
        'react/jsx-runtime',
        'react-dom',
        'react-dom/client',
        '@deepseek-ai/cordis',
        '@deepseek-ai/dsh-client-ui-slots',
        '@deepseek-ai/dsh-client-ui-primitives',
      ],
      // @dsh-plus/shared 无 client bundle row：按源码级打苞（与 usage-panel 同约定）。
      alwaysBundle: ['@dsh-plus/shared/**'],
    },
    outputOptions: {
      entryFileNames: 'client.js',
      // 宿主仅服务 /plugins/<id>/client.js 单文件：禁止动态分包
      inlineDynamicImports: true,
      banner: CLIENT_BANNER,
      footer: CLIENT_FOOTER,
    },
  },
])
