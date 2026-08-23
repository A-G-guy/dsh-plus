/**
 * 精选语言集：静态引入（宿主只服务 client.js 单文件，无法动态分包），
 * 按 LanguageDescription 形式供文件名匹配；load() 直接返回已就绪的支持。
 * @module @dsh-plus/web-files/panel/lang-data
 */

import { cpp } from '@codemirror/lang-cpp'
import { css } from '@codemirror/lang-css'
import { go } from '@codemirror/lang-go'
import { html } from '@codemirror/lang-html'
import { java } from '@codemirror/lang-java'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { php } from '@codemirror/lang-php'
import { python } from '@codemirror/lang-python'
import { rust } from '@codemirror/lang-rust'
import { sql } from '@codemirror/lang-sql'
import { xml } from '@codemirror/lang-xml'
import { yaml } from '@codemirror/lang-yaml'
import { LanguageDescription, type LanguageSupport, StreamLanguage } from '@codemirror/language'
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { toml } from '@codemirror/legacy-modes/mode/toml'

function ready(factory: () => LanguageSupport): () => Promise<LanguageSupport> {
  return () => Promise.resolve(factory())
}

/** 支持的文件名 → 语言支持映射。 */
export const supportedLanguages = [
  LanguageDescription.of({
    name: 'JavaScript',
    extensions: ['js', 'jsx', 'mjs', 'cjs'],
    load: ready(() => javascript()),
  }),
  LanguageDescription.of({
    name: 'TypeScript',
    extensions: ['ts', 'tsx', 'mts', 'cts'],
    load: ready(() => javascript({ typescript: true, jsx: true })),
  }),
  LanguageDescription.of({ name: 'Python', extensions: ['py'], load: ready(python) }),
  LanguageDescription.of({ name: 'Rust', extensions: ['rs'], load: ready(rust) }),
  LanguageDescription.of({ name: 'Go', extensions: ['go'], load: ready(go) }),
  LanguageDescription.of({ name: 'Java', extensions: ['java'], load: ready(java) }),
  LanguageDescription.of({
    name: 'C/C++',
    extensions: ['c', 'cc', 'cpp', 'cxx', 'h', 'hpp'],
    load: ready(cpp),
  }),
  LanguageDescription.of({ name: 'HTML', extensions: ['html', 'htm'], load: ready(() => html()) }),
  LanguageDescription.of({ name: 'CSS', extensions: ['css'], load: ready(css) }),
  LanguageDescription.of({ name: 'JSON', extensions: ['json'], load: ready(json) }),
  LanguageDescription.of({ name: 'YAML', extensions: ['yml', 'yaml'], load: ready(yaml) }),
  LanguageDescription.of({
    name: 'Markdown',
    extensions: ['md', 'markdown'],
    load: ready(() => markdown()),
  }),
  LanguageDescription.of({ name: 'SQL', extensions: ['sql'], load: ready(sql()) }),
  LanguageDescription.of({ name: 'XML', extensions: ['xml', 'svg'], load: ready(xml) }),
  LanguageDescription.of({ name: 'PHP', extensions: ['php'], load: ready(() => php()) }),
  LanguageDescription.of({
    name: 'Shell',
    extensions: ['sh', 'bash', 'zsh'],
    load: ready(() => new LanguageSupport(StreamLanguage.define(shell))),
  }),
  LanguageDescription.of({
    name: 'TOML',
    extensions: ['toml'],
    load: ready(() => new LanguageSupport(StreamLanguage.define(toml))),
  }),
  LanguageDescription.of({
    name: 'Dockerfile',
    filename: /^dockerfile$/i,
    load: ready(() => new LanguageSupport(StreamLanguage.define(dockerFile))),
  }),
]
