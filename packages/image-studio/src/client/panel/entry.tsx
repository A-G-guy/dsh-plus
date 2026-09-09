/**
 * 侧边栏 footer 入口按钮：与文件/终端入口同款（整行图标 + 文案；
 * rail 折叠态退化为居中圆形图标）。flex:1 由样式层与邻居等分行宽。
 * @module image-studio/client/panel/entry
 */
import { IconImage } from '@dsh-plus/shared/client'
import type { ReactElement } from 'react'
import { useSyncExternalStore } from 'react'
import type { Translate } from '../i18n.ts'
import type { PanelController } from './controller.ts'

interface EntryProps {
  studio: PanelController
  t: Translate
  /** 侧边栏展开态（slot owner 传入）；折叠（rail）时仅渲染圆形图标。 */
  wide?: boolean
}

export function StudioEntryButton({ studio, t, wide }: EntryProps): ReactElement {
  const { open } = useSyncExternalStore(studio.subscribe, studio.getSnapshot)
  const rail = wide === false
  return (
    <button
      type="button"
      className={rail ? 'ims-entry ims-entry-rail' : 'ims-entry'}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={t('entry.label')}
      onClick={() => studio.toggle()}
    >
      <IconImage size={rail ? 18 : 16} />
      {!rail && <span className="ims-entry-label">{t('entry.label')}</span>}
    </button>
  )
}
