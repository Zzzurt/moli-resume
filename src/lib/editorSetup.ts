import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import { Markdown } from 'tiptap-markdown'
import { Editor, Extension } from '@tiptap/core'
import type { JSONContent } from '@tiptap/react'
import { Plugin } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { createSlashExtension } from '@/components/editor/slashExtension'
import { createMarkdownInputRules } from '@/components/editor/markdownInputRules'

/** 单元格对齐：扩展 tableCell / tableHeader，携带 align 属性（预览与导出同步） */
function withCellAlign<T extends { extend: (config: object) => T }>(Cell: T): T {
  return Cell.extend({
    addAttributes() {
      return {
        // @ts-expect-error 展开父类属性
        ...this.parent?.(),
        align: {
          default: null as string | null,
          parseHTML: (el: HTMLElement) => el.getAttribute('data-align'),
          renderHTML: (attrs: { align?: string | null }) =>
            attrs.align ? { 'data-align': attrs.align, style: `text-align: ${attrs.align}` } : {},
        },
      }
    },
  })
}

const AlignableTableCell = withCellAlign(TableCell)
const AlignableTableHeader = withCellAlign(TableHeader)

/**
 * 块索引装饰器：
 * 为每个顶层块节点注入 data-index 属性（与预览块的索引一一对应）。
 * 用 ProseMirror Decoration 而非命令式 DOM 操作，保证任何重渲染后属性自动恢复。
 */
const BlockIndex = Extension.create({
  name: 'blockIndex',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations(state) {
            const decos: Decoration[] = []
            let index = 0
            state.doc.forEach((node, offset) => {
              decos.push(Decoration.node(offset, offset + node.nodeSize, { 'data-index': String(index) }))
              index++
            })
            return DecorationSet.create(state.doc, decos)
          },
        },
      }),
    ]
  },
})

/**
 * 编辑器扩展的统一装配：
 * 编辑器实例与 Markdown 转换（scratch editor）共用，保证行为一致。
 */
export function createEditorExtensions(onSlashOpen: (pos: number) => void) {
  return [
    StarterKit,
    Placeholder.configure({
      // 空文档时承担 Markdown 快捷输入的发现入口（原先常驻状态栏的语法提示已移除）
      placeholder: '输入 / 唤起块菜单，或直接打 # 标题、- 列表、**加粗** 即时转换…',
      showOnlyWhenEditable: true,
    }),
    Link.configure({ openOnClick: false }),
    Image.configure({ inline: false }),
    Table.configure({ resizable: false }),
    TableRow,
    AlignableTableHeader,
    AlignableTableCell,
    Markdown.configure({
      html: false,
      linkify: true,
      breaks: false,
      transformPastedText: true,
      transformCopiedText: false,
    }),
    BlockIndex,
    createSlashExtension({ onOpen: onSlashOpen }),
    createMarkdownInputRules(),
  ]
}

/** 无头编辑器：负责 Markdown ↔ Tiptap JSON 转换（导入 .md / AI 结果替换） */
let scratchEditor: Editor | null = null

function getScratch(): Editor {
  if (!scratchEditor) {
    scratchEditor = new Editor({
      content: '',
      extensions: createEditorExtensions(() => {}),
    })
  }
  return scratchEditor
}

/** Markdown 文本 → Tiptap JSON 文档 */
export function markdownToDoc(md: string): JSONContent {
  const scratch = getScratch()
  scratch.commands.setContent(md)
  return scratch.getJSON()
}

/** Tiptap JSON 文档 → Markdown 文本（复用无头编辑器，与导入导出行为一致） */
export function docToMarkdown(doc: JSONContent): string {
  const scratch = getScratch()
  scratch.commands.setContent(doc)
  const storage = scratch.storage as unknown as { markdown?: { getMarkdown: () => string } }
  return storage.markdown?.getMarkdown() ?? ''
}
