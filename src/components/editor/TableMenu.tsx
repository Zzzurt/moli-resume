import { useEffect, useState } from 'react'
import type { Editor } from '@tiptap/react'
import {
  ArrowDownToLine,
  ArrowRightToLine,
  Rows3,
  Columns3,
  Trash2,
  AlignLeft,
  AlignCenter,
  AlignRight,
} from 'lucide-react'

/**
 * 表格操作浮层：
 * 光标停留在表格内时浮在表格上方，提供行/列增删与单元格对齐。
 * 存在文字选区时隐藏（让位给格式悬浮工具栏，避免重叠）。
 */
export function TableMenu({ editor }: { editor: Editor }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const update = () => {
      const { $from, empty } = editor.state.selection
      // 有选区时让位给悬浮格式工具栏
      if (!empty) {
        setPos(null)
        return
      }
      let depth = -1
      for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type.name === 'table') {
          depth = d
          break
        }
      }
      if (depth < 0) {
        setPos(null)
        return
      }
      try {
        const tablePos = $from.before(depth + 1)
        const dom = editor.view.nodeDOM(tablePos) as HTMLElement | null
        if (!dom) {
          setPos(null)
          return
        }
        const rect = dom.getBoundingClientRect()
        const x = Math.max(12, Math.min(rect.left + rect.width / 2 - 170, window.innerWidth - 352))
        const y = rect.top > 96 ? rect.top - 34 : rect.bottom + 8
        setPos({ x, y })
      } catch {
        setPos(null)
      }
    }

    /* blur 处理器必须具名：Tiptap 的 EventEmitter.off(event) 不传 handler 时会
       delete callbacks[event]，把该 editor 上**所有** blur 监听一并解绑
       （包括 TiptapEditor 用来隐藏悬浮工具栏的那个） */
    const onBlur = () => setPos(null)

    update()
    editor.on('transaction', update)
    editor.on('selectionUpdate', update)
    editor.on('focus', update)
    editor.on('blur', onBlur)
    return () => {
      editor.off('transaction', update)
      editor.off('selectionUpdate', update)
      editor.off('focus', update)
      editor.off('blur', onBlur)
    }
  }, [editor])

  if (!pos) return null

  const setAlign = (align: 'left' | 'center' | 'right') => {
    editor
      .chain()
      .focus()
      .updateAttributes('tableCell', { align })
      .updateAttributes('tableHeader', { align })
      .run()
  }

  const item = (
    key: string,
    title: string,
    icon: React.ReactNode,
    label: string | null,
    run: () => void,
    disabled = false
  ) => (
    <button
      key={key}
      title={title}
      aria-label={title}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      {icon}
      {label && <span>{label}</span>}
    </button>
  )

  return (
    <div className="table-menu" style={{ left: pos.x, top: pos.y }} onMouseDown={(e) => e.preventDefault()}>
      {item('addRow', '在下方插入一行', <ArrowDownToLine className="size-3.5" />, '加行', () =>
        editor.chain().focus().addRowAfter().run()
      )}
      {item('addCol', '在右侧插入一列', <ArrowRightToLine className="size-3.5" />, '加列', () =>
        editor.chain().focus().addColumnAfter().run()
      )}
      {item('delRow', '删除当前行', <Rows3 className="size-3.5" />, '删行', () =>
        editor.chain().focus().deleteRow().run(),
        !editor.can().deleteRow()
      )}
      {item('delCol', '删除当前列', <Columns3 className="size-3.5" />, '删列', () =>
        editor.chain().focus().deleteColumn().run(),
        !editor.can().deleteColumn()
      )}
      {item('delTable', '删除整个表格', <Trash2 className="size-3.5" />, null, () =>
        editor.chain().focus().deleteTable().run(),
        !editor.can().deleteTable()
      )}
      <span className="tm-sep" />
      {item('al', '单元格左对齐', <AlignLeft className="size-3.5" />, null, () => setAlign('left'))}
      {item('ac', '单元格居中', <AlignCenter className="size-3.5" />, null, () => setAlign('center'))}
      {item('ar', '单元格右对齐', <AlignRight className="size-3.5" />, null, () => setAlign('right'))}
    </div>
  )
}
