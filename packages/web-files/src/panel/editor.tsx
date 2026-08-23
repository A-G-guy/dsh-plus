/**
 * CodeMirror React 封装：按文件路径重建编辑实例（key 由调用方控制），
 * 语言包按文件名经 @codemirror/language-data 懒加载。
 * @module @dsh-plus/web-files/panel/editor
 */

import { LanguageDescription, type LanguageSupport } from '@codemirror/language'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { useEffect, useRef } from 'react'

import { dswEditorTheme, dswHighlight } from './cm-theme.ts'
import { supportedLanguages } from './lang-data.ts'

export interface CodeEditorProps {
  /** 初始文档内容（仅在挂载时采用，之后由编辑器自持）。 */
  value: string
  /** 文件名（用于语言识别与高亮）。 */
  filename: string
  readOnly: boolean
  /** 文档变更回调（脏标记）。 */
  onDocChanged: () => void
  /** Mod-S 保存快捷键回调（携带当前文档全文）。 */
  onSaveKey: (doc: string) => void
  /** 注册文档全文读取器（保存按钮使用）。 */
  registerDocGetter: (getter: (() => string) | null) => void
}

/** 按文件名解析语言支持；无匹配返回 null。 */
async function loadLanguage(filename: string): Promise<LanguageSupport | null> {
  const description = LanguageDescription.matchFilename(supportedLanguages, filename)
  if (description === undefined) return null
  try {
    return await description.load()
  } catch {
    return null
  }
}

/** 挂载一个 CodeMirror 实例；卸载时销毁。 */
export function CodeEditor({
  value,
  filename,
  readOnly,
  onDocChanged,
  onSaveKey,
  registerDocGetter,
}: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  // 回调引用保持稳定，避免每次渲染重建编辑器
  const callbacksRef = useRef({ onDocChanged, onSaveKey })
  callbacksRef.current = { onDocChanged, onSaveKey }

  useEffect(() => {
    const container = containerRef.current
    if (container === null) return
    const languageCompartment = new Compartment()
    const saveKeymap = keymap.of([
      {
        key: 'Mod-s',
        preventDefault: true,
        run: () => {
          callbacksRef.current.onSaveKey(view.state.doc.toString())
          return true
        },
      },
    ])
    const view = new EditorView({
      parent: container,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          saveKeymap,
          dswEditorTheme,
          dswHighlight,
          languageCompartment.of([]),
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) callbacksRef.current.onDocChanged()
          }),
        ],
      }),
    })
    viewRef.current = view
    registerDocGetter(() => view.state.doc.toString())
    let disposed = false
    void loadLanguage(filename).then((support) => {
      if (disposed || support === null) return
      view.dispatch({ effects: languageCompartment.reconfigure(support) })
    })
    return () => {
      disposed = true
      registerDocGetter(null)
      view.destroy()
      viewRef.current = null
    }
  }, [value, filename, readOnly, registerDocGetter])

  return <div className="wf-editor" ref={containerRef} />
}
