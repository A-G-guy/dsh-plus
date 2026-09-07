/**
 * 纯 host 半构建（无浏览器 client bundle）。
 * @module @dsh-plus/subagent-model/tsdown
 */
import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: 'src/index.ts',
  format: 'esm',
  fixedExtension: false,
  dts: true,
  outDir: 'lib',
})
