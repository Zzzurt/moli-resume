import { useEffect, useRef, useState, type RefObject } from 'react'
import type { Editor } from '@tiptap/react'
import { Fragment, type Node as PMNode } from '@tiptap/pm/model'
import {
  GripVertical,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Type,
  List,
  ListOrdered,
  Quote,
  ArrowUp,
  ArrowDown,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'

/** 编辑器顶层块 DOM 列表（过滤 gapcursor 等临时装饰元素） */
export function getBlockEls(editor: Editor): HTMLElement[] {
  const pm = editor.view.dom
  return Array.from(pm.children).filter(
    (el) => !(el as HTMLElement).classList?.contains('ProseMirror-gapcursor')
  ) as HTMLElement[]
}

/** 顶层节点偏移量表（用于删除等整块操作） */
function blockOffsets(editor: Editor): { offset: number; node: PMNode }[] {
  const list: { offset: number; node: PMNode }[] = []
  editor.state.doc.forEach((node, offset) => list.push({ offset, node }))
  return list
}

/**
 * 移动顶层块：把 fromIndex 块移动到"原索引 targetIndex 之前"。
 * 通过整体重建文档内容实现，避免琐碎的偏移量计算。
 */
export function moveBlock(editor: Editor, fromIndex: number, targetIndex: number): void {
  const nodes: PMNode[] = []
  editor.state.doc.forEach((n) => nodes.push(n))
  if (fromIndex < 0 || fromIndex >= nodes.length || fromIndex === targetIndex) return
  const [moved] = nodes.splice(fromIndex, 1)
  const insertAt = Math.max(0, Math.min(targetIndex > fromIndex ? targetIndex - 1 : targetIndex, nodes.length))
  nodes.splice(insertAt, 0, moved)
  const tr = editor.state.tr
  tr.replaceWith(0, editor.state.doc.content.size, Fragment.fromArray(nodes))
  editor.view.dispatch(tr)
}

/** 把光标放到第 index 块内（供块类型转换命令使用） */
function focusBlock(editor: Editor, index: number): boolean {
  const els = getBlockEls(editor)
  const el = els[index]
  if (!el) return false
  try {
    const pos = editor.view.posAtDOM(el, 0)
    editor.chain().focus().setTextSelection(pos).run()
    return true
  } catch {
    return false
  }
}

interface DragHandleLayerProps {
  editor: Editor
  containerRef: RefObject<HTMLDivElement | null>
}

/**
 * 块级拖拽手柄层：
 * - hover 编辑块 → 左侧浮现 ⠿ 手柄
 * - 拖拽手柄 → 显示插入指示线，松开完成块移动
 * - 点击手柄 → 弹出块菜单（块类型转换 / 上移 / 下移 / 删除）
 */
export function DragHandleLayer({ editor, containerRef }: DragHandleLayerProps) {
  const [handle, setHandle] = useState<{ index: number; top: number; left: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [dropLine, setDropLine] = useState<{ y: number; left: number; width: number } | null>(null)
  const [menu, setMenu] = useState<{ index: number; x: number; y: number } | null>(null)

  const dragRef = useRef<{ fromIndex: number; startY: number; moved: boolean } | null>(null)
  const dropTargetRef = useRef<number | null>(null)

  /* 手柄跟随鼠标所在块 */
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const onMove = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      // 悬停在手柄/菜单自身时保持显示
      if (target.closest('.drag-handle') || target.closest('.block-menu')) return
      if (dragRef.current || menu) return
      // 存活范围 = 整个编辑面板（含左侧 gutter）：移向手柄途中不消失
      if (!container.contains(target)) {
        setHandle(null)
        return
      }
      const posInfo = editor.view.posAtCoords({ left: e.clientX, top: e.clientY })
      if (!posInfo) return
      const $pos = editor.state.doc.resolve(posInfo.pos)
      if ($pos.depth < 1) return
      const index = $pos.index(0)
      const el = getBlockEls(editor)[index]
      if (!el) return
      const rect = el.getBoundingClientRect()
      setHandle({ index, top: rect.top + rect.height / 2 - 11, left: Math.max(rect.left - 32, 2) })
    }
    container.addEventListener('mousemove', onMove)
    return () => container.removeEventListener('mousemove', onMove)
  }, [editor, containerRef, menu])

  /* 滚动时隐藏手柄（fixed 定位会失真） */
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const onScroll = () => setHandle(null)
    container.addEventListener('scroll', onScroll, { passive: true })
    return () => container.removeEventListener('scroll', onScroll)
  }, [containerRef])

  /* 菜单外点击关闭 */
  useEffect(() => {
    if (!menu) return
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.block-menu') && !(e.target as HTMLElement).closest('.drag-handle')) {
        setMenu(null)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menu])

  const onHandleDown = (e: React.MouseEvent) => {
    if (!handle) return
    e.preventDefault()
    const fromIndex = handle.index
    dragRef.current = { fromIndex, startY: e.clientY, moved: false }
    setDragging(true)

    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current
      if (!d) return
      if (Math.abs(ev.clientY - d.startY) > 4) d.moved = true
      if (!d.moved) return
      const els = getBlockEls(editor)
      if (els.length === 0) return
      let target = els.length
      for (let i = 0; i < els.length; i++) {
        const r = els[i].getBoundingClientRect()
        if (ev.clientY < r.top + r.height / 2) {
          target = i
          break
        }
      }
      dropTargetRef.current = target
      const container = containerRef.current
      if (container) {
        const y =
          target < els.length
            ? els[target].getBoundingClientRect().top - 2
            : els[els.length - 1].getBoundingClientRect().bottom + 2
        setDropLine({ y, left: container.getBoundingClientRect().left + 10, width: container.clientWidth - 20 })
      }
    }

    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      const d = dragRef.current
      dragRef.current = null
      setDragging(false)
      setDropLine(null)
      if (!d) return
      if (d.moved) {
        const target = dropTargetRef.current
        if (target !== null) moveBlock(editor, d.fromIndex, target)
      } else {
        // 点击 → 打开块菜单
        setMenu({ index: d.fromIndex, x: handle.left, y: handle.top })
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  /* ---------- 块菜单操作 ---------- */
  const convert = (index: number, run: (editor: Editor) => void) => {
    setMenu(null)
    if (focusBlock(editor, index)) run(editor)
  }
  const moveUp = (index: number) => {
    setMenu(null)
    moveBlock(editor, index, index - 1)
  }
  const moveDown = (index: number) => {
    setMenu(null)
    moveBlock(editor, index, index + 2)
  }
  const removeBlock = (index: number) => {
    setMenu(null)
    const info = blockOffsets(editor)[index]
    if (!info) return
    editor.chain().focus().deleteRange({ from: info.offset, to: info.offset + info.node.nodeSize }).run()
  }

  const currentType = menu ? blockOffsets(editor)[menu.index]?.node.type.name : ''

  return (
    <>
      {handle && !dragging && !menu && (
        <button
          className="drag-handle"
          title="拖拽移动 · 点击打开块菜单"
          aria-label="块操作：拖拽移动或点击打开菜单"
          style={{ left: handle.left, top: handle.top }}
          onMouseDown={onHandleDown}
        >
          <GripVertical className="size-3.5" />
        </button>
      )}

      {dropLine && <div className="drop-line" style={{ left: dropLine.left, top: dropLine.y, width: dropLine.width }} />}

      {menu && (
        <div className="block-menu" style={{ left: menu.x, top: menu.y - 6 }}>
          <div className="bm-title">转为（当前：{typeLabel(currentType)}）</div>
          <button onClick={() => convert(menu.index, (e) => e.chain().setNode('heading', { level: 1 }).run())}>
            <Heading1 className="size-4" /> 标题一
          </button>
          <button onClick={() => convert(menu.index, (e) => e.chain().setNode('heading', { level: 2 }).run())}>
            <Heading2 className="size-4" /> 标题二
          </button>
          <button onClick={() => convert(menu.index, (e) => e.chain().setNode('heading', { level: 3 }).run())}>
            <Heading3 className="size-4" /> 标题三
          </button>
          <button onClick={() => convert(menu.index, (e) => e.chain().setNode('heading', { level: 4 }).run())}>
            <Heading4 className="size-4" /> 标题四
          </button>
          <button onClick={() => convert(menu.index, (e) => e.chain().setNode('heading', { level: 5 }).run())}>
            <Heading5 className="size-4" /> 标题五
          </button>
          <button onClick={() => convert(menu.index, (e) => e.chain().setNode('heading', { level: 6 }).run())}>
            <Heading6 className="size-4" /> 标题六
          </button>
          <button onClick={() => convert(menu.index, (e) => e.chain().setParagraph().run())}>
            <Type className="size-4" /> 正文
          </button>
          <button onClick={() => convert(menu.index, (e) => e.chain().toggleBulletList().run())}>
            <List className="size-4" /> 无序列表
          </button>
          <button onClick={() => convert(menu.index, (e) => e.chain().toggleOrderedList().run())}>
            <ListOrdered className="size-4" /> 有序列表
          </button>
          <button onClick={() => convert(menu.index, (e) => e.chain().toggleBlockquote().run())}>
            <Quote className="size-4" /> 引用
          </button>
          <div className="bm-sep" />
          <button onClick={() => moveUp(menu.index)}>
            <ArrowUp className="size-4" /> 上移一块
          </button>
          <button onClick={() => moveDown(menu.index)}>
            <ArrowDown className="size-4" /> 下移一块
          </button>
          <button className={cn('danger')} onClick={() => removeBlock(menu.index)}>
            <Trash2 className="size-4" /> 删除此块
          </button>
        </div>
      )}
    </>
  )
}

function typeLabel(type: string): string {
  const map: Record<string, string> = {
    heading: '标题',
    paragraph: '正文',
    bulletList: '无序列表',
    orderedList: '有序列表',
    blockquote: '引用',
    horizontalRule: '分割线',
    table: '表格',
    image: '图片',
    codeBlock: '代码块',
  }
  return map[type] ?? type
}
