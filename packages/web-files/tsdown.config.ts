/**
 * 双入口构建（模式与 @dsh-plus/ui-mobile-fit 一致）：
 * - src/index.ts → lib/index.js（ESM + dts，node 半）
 * - src/client.ts → lib/client.js（CJS factory bundle，浏览器半）
 *
 * 浏览器半必须是 window.__ModuleLoader__.load({id, factory}) 形式
 * （权威契约：dsh-client-modules README）。平台 seed 词（react、
 * react-dom、@deepseek-ai/cordis、@deepseek-ai/dsh-client-ui-primitives
 * 等）构建期 external，运行时由模块表供给；CodeMirror 全量内联打包。
 */
import { defineConfig } from 'tsdown'

const CLIENT_BANNER = `window.__ModuleLoader__.load({
	id: "@dsh-plus/web-files",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
`

const CLIENT_FOOTER = `		return module.exports;
	}
});
`

/** 平台 seed 词与官方插件模块：构建期外置，运行时由 __ModuleLoader__ 模块表解析。 */
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  /^@deepseek-ai\/dsh-client-[a-z-]+\/client$/,
]

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
    external: CLIENT_EXTERNALS,
    deps: {
      // @deepseek-ai/dsh-util-workspace-path 无 client bundle 行（模块表无法
      // 应答它的 require），按源码级内联（master INLINE_SAFE 同款处理）；
      // 其余 peer 依赖保持默认外置（由外壳模块表供给）。
      alwaysBundle: ['@deepseek-ai/dsh-util-workspace-path'],
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
