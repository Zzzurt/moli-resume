import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

/**
 * 斜杠命令扩展：
 * 在块首输入 "/" 时触发回调（React 侧接管菜单渲染与后续输入过滤）。
 * 仅在光标前无其他字符时触发，避免误伤 URL 等场景。
 */
export interface SlashCallbacks {
  onOpen: (pos: number) => void
}

export function createSlashExtension(callbacks: SlashCallbacks) {
  return Extension.create({
    name: 'slashMenu',
    addProseMirrorPlugins() {
      return [
        new Plugin({
          props: {
            handleTextInput: (view, from, _to, text) => {
              if (text !== '/') return false
              return tryOpen(view, from, callbacks.onOpen)
            },
          },
          view(view) {
            // prosemirror-view 的 readDOMChange 仅当插入点已有文本节点时才回调
            // handleTextInput，空块首字符不触发 → 用 beforeinput 事件兜底覆盖
            const onBeforeInput = (e: InputEvent) => {
              if (e.inputType !== 'insertText' || e.data !== '/') return
              tryOpen(view, view.state.selection.from, callbacks.onOpen)
            }
            view.dom.addEventListener('beforeinput', onBeforeInput)
            return {
              destroy: () => view.dom.removeEventListener('beforeinput', onBeforeInput),
            }
          },
        }),
      ]
    },
  })
}

/** 光标前无其他字符（块首）时唤起菜单；始终返回 false，不拦截 "/" 的默认插入 */
function tryOpen(view: EditorView, from: number, onOpen: (pos: number) => void): boolean {
  const $from = view.state.doc.resolve(from)
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '\ufffc')
  if (before.trim() !== '') return false
  // 延迟到 DOM 更新后再回调，保证 coordsAtPos 可用；两条输入路径可能都触发，状态幂等
  window.setTimeout(() => {
    if (!view.isDestroyed) onOpen(from)
  }, 0)
  return false
}
