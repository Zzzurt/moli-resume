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
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { createSlashExtension } from '@/components/editor/slashExtension'
import { createMarkdownInputRules } from '@/components/editor/markdownInputRules'

/** GFM 列对齐标记（表头下面那一行）：左 :--- / 中 :---: / 右 ---: */
const ALIGN_MARKER: Record<string, string> = { left: ':---', center: ':---:', right: '---:' }

/**
 * 单元格对齐：扩展 tableCell / tableHeader，携带 align 属性（预览与导出同步）。
 * parseHTML 同时认两种来源：
 * 1) 自家 HTML 的 `data-align`（renderHTML 产出）；
 * 2) markdown-it 解析 GFM 表格时写的 `style="text-align:right"`——不认这个，
 *    外部带对齐的 Markdown 导入后对齐就没了。
 */
function withCellAlign<T extends { extend: (config: object) => T }>(Cell: T): T {
  return Cell.extend({
    addAttributes() {
      return {
        // @ts-expect-error 展开父类属性
        ...this.parent?.(),
        align: {
          default: null as string | null,
          parseHTML: (el: HTMLElement) => {
            const own = el.getAttribute('data-align')
            if (own) return own
            const m = /text-align\s*:\s*(left|center|right|justify)/i.exec(el.getAttribute('style') ?? '')
            return m ? m[1].toLowerCase() : null
          },
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
 * 单元格 → 单行 Markdown 文本。
 * GFM 单元格不能跨行：多段落用空格连接，保证内容不被丢弃。
 * 这里自己拼行内文本而不复用 state.renderInline，是为了能转义 `|`——
 * 单元格里的竖线会撑破表格结构，而 prosemirror-markdown 的转义集里不含 `|`。
 */
function inlineMarkdown(node: ProseMirrorNode): string {
  if (node.type.name === 'hardBreak') return ' '
  // 单元格内的图片无法用 GFM 表格表达，导出侧忽略（预览/PDF 不受影响）
  if (node.type.name === 'image') return ''
  if (!node.isText) return node.textContent
  let out = (node.text ?? '').replace(/\|/g, '\\|').replace(/\s*\n+\s*/g, ' ')
  const has = (name: string) => node.marks.some((m) => m.type.name === name)
  if (has('code')) out = `\`${out}\``
  if (has('strike')) out = `~~${out}~~`
  if (has('bold')) out = `**${out}**`
  if (has('italic')) out = `*${out}*`
  const link = node.marks.find((m) => m.type.name === 'link')
  if (link?.attrs?.href) out = `[${out}](${String(link.attrs.href)})`
  return out
}

function cellMarkdown(cell: ProseMirrorNode): string {
  const blocks: string[] = []
  cell.forEach((block) => {
    const parts: string[] = []
    block.content.forEach((inline) => parts.push(inlineMarkdown(inline)))
    const text = parts.join('').trim()
    if (text) blocks.push(text)
  })
  return blocks.join(' ')
}

/** 只声明我们真正用到的 MarkdownSerializerState 能力，避免直接依赖 prosemirror-markdown 类型 */
interface MarkdownState {
  write: (text: string) => void
  ensureNewLine: () => void
  closeBlock: (node: ProseMirrorNode) => void
  inTable: boolean
}

/**
 * 表格的 Markdown 序列化（覆盖 tiptap-markdown 默认实现）。
 *
 * 默认实现只在「首行全为 tableHeader 且每格恰好一个段落」时才输出管道表格，
 * 否则退回 HTML 分支——而本项目 `html: false`，该分支**什么都不写**：
 * 实测表内某格多一个段落（在表格里按一次 Enter 就会出现）时，
 * 整张表会变成 `[table]` 占位符，单元格内容全部丢失。
 *
 * 这里改成任何情况都输出管道表格：
 * - 多段落单元格用空格连接（内容不丢）；
 * - 表头下方输出 GFM 列对齐标记，与 withCellAlign 的解析端配对，
 *   使「源码模式 / .md 导入导出」往返后对齐不丢。
 * 注：GFM 只有一行对齐声明，按列取表头行的 align（同一列各行不一致时以表头为准）。
 */
function serializeTable(state: MarkdownState, node: ProseMirrorNode): void {
  state.inTable = true
  node.forEach((row, _offset, rowIndex) => {
    state.write('| ')
    row.forEach((cell, _cellOffset, cellIndex) => {
      if (cellIndex) state.write(' | ')
      const text = cellMarkdown(cell)
      if (text) state.write(text)
    })
    state.write(' |')
    state.ensureNewLine()
    if (!rowIndex) {
      const delimiter: string[] = []
      row.forEach((cell) => {
        delimiter.push(ALIGN_MARKER[String(cell.attrs?.align ?? '')] ?? '---')
      })
      state.write(`| ${delimiter.join(' | ')} |`)
      state.ensureNewLine()
    }
  })
  state.closeBlock(node)
  state.inTable = false
}

const MarkdownTable = Table.extend({
  addStorage() {
    return {
      markdown: {
        // 覆盖默认 serialize；默认的 parse 由 tiptap-markdown 按扩展名合并保留
        serialize(this: unknown, state: MarkdownState, node: ProseMirrorNode) {
          serializeTable(state, node)
        },
      },
    }
  },
})

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
    MarkdownTable.configure({ resizable: false }),
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
