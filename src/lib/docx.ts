import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'
import type { JSONContent } from '@tiptap/react'
import { markdownToDoc } from '@/lib/editorSetup'
import { downloadBlob } from '@/lib/fileIO'

/**
 * Word（.docx）导出：把 Tiptap JSON 结构化映射为 docx 段落/表格。
 * 与 Markdown 导出互补——招聘平台上传 Word 场景；
 * 文字为真文本，可编辑可排版。
 */

/** 代码字体（等宽）与正文中文字体 */
const CODE_FONT = 'Consolas'
const CJK_FONT = '微软雅黑'

interface InlineLike {
  type: 'text' | 'inline'
  text?: string
  marks?: { type: string; attrs?: Record<string, unknown> }[]
  content?: JSONContent[]
}

/** 行内节点 → TextRun / ExternalHyperlink（处理 bold/italic/strike/code/link marks） */
function inlineRuns(node: InlineLike): (TextRun | ExternalHyperlink)[] {
  const text = node.text ?? ''
  // link 是包裹型 mark：内容为子文本节点
  const linkMark = (node.marks ?? []).find((m) => m.type === 'link')
  if (linkMark?.attrs?.href) {
    const children = (node.content ?? []).map((c) => c.text ?? '').join('') || text
    return [new ExternalHyperlink({ children: [new TextRun({ text: children || '链接' })], link: String(linkMark.attrs.href) })]
  }
  const marks = node.marks ?? []
  const isCode = marks.some((m) => m.type === 'code')
  return [
    new TextRun({
      text,
      bold: marks.some((m) => m.type === 'bold'),
      italics: marks.some((m) => m.type === 'italic'),
      strike: marks.some((m) => m.type === 'strike'),
      font: isCode ? { ascii: CODE_FONT, cs: CODE_FONT } : { ascii: CJK_FONT, eastAsia: CJK_FONT, cs: CJK_FONT },
    }),
  ]
}

/**
 * 递归收集块内的行内节点 → TextRun / ExternalHyperlink。
 * 段落、标题、引用、列表项共用（此前段落与标题各手写了一份同样的递归）。
 */
function collectRuns(nodes: JSONContent[] | undefined): (TextRun | ExternalHyperlink)[] {
  const runs: (TextRun | ExternalHyperlink)[] = []
  const walk = (list: JSONContent[] | undefined) => {
    for (const child of list ?? []) {
      if (child.type === 'text' || child.type === 'inline') runs.push(...inlineRuns(child as InlineLike))
      else walk(child.content)
    }
  }
  walk(nodes)
  return runs
}

/** 段落/列表项/引用 → Paragraph */
function blockParagraph(node: JSONContent, bullet?: boolean, numbering?: string, quote = false): Paragraph {
  const runs = collectRuns(node.content)
  if (node.type === 'codeBlock') {
    const lines = String((node.content ?? []).map((c) => c.text ?? '').join('') ?? '').split('\n')
    return new Paragraph({
      children: lines.map((l) => new TextRun({ text: l, font: { ascii: CODE_FONT, cs: CODE_FONT } })),
      shading: { fill: 'F5F5F5' },
      spacing: { before: 60, after: 120 },
    })
  }
  if (node.type === 'horizontalRule') {
    return new Paragraph({
      children: [new TextRun({ text: '', font: { ascii: CJK_FONT, eastAsia: CJK_FONT } })],
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '999999' } },
      spacing: { before: 80, after: 160 },
    })
  }
  return new Paragraph({
    children: runs.length ? runs : [new TextRun({ text: '', font: { ascii: CJK_FONT, eastAsia: CJK_FONT } })],
    bullet: bullet ? { level: 0 } : undefined,
    numbering: numbering ? { reference: 'rs-ordered', level: 0 } : undefined,
    // 引用：左缩进 + 浅底 + 左竖线（Word 常见引用样式）
    indent: quote ? { left: 720 } : undefined,
    shading: quote ? { fill: 'F6F8FA' } : undefined,
    border: quote
      ? { left: { style: BorderStyle.SINGLE, size: 24, color: '9CA3AF' } }
      : undefined,
    spacing: { before: 60, after: 120 },
  })
}

/** 递归把顶层/嵌套节点渲染为文档子项 */
function renderChildren(nodes: JSONContent[] | undefined): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = []
  for (const node of nodes ?? []) {
    switch (node.type) {
      case 'heading': {
        const level = Math.min(6, Math.max(1, (node.attrs?.level as number) ?? 1)) as 1 | 2 | 3 | 4 | 5 | 6
        const runs = collectRuns(node.content)
        out.push(
          new Paragraph({
            heading: ([HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6] as const)[level - 1],
            children: runs.length ? runs : [new TextRun({ text: '' })],
            spacing: { before: level <= 2 ? 260 : 200, after: 100 },
          })
        )
        break
      }
      case 'paragraph':
        out.push(blockParagraph(node))
        break
      case 'blockquote':
        out.push(blockParagraph(node, undefined, undefined, true))
        break
      case 'bulletList':
        for (const li of node.content ?? []) out.push(blockParagraph(li, true))
        break
      case 'orderedList':
        for (const li of node.content ?? []) out.push(blockParagraph(li, false, 'rs-ordered'))
        break
      case 'listItem': {
        // 兜底：裸 listItem（一般被列表容器包裹，不会走到这里）
        out.push(blockParagraph(node, true))
        break
      }
      case 'codeBlock':
        out.push(blockParagraph(node))
        break
      case 'horizontalRule':
        out.push(blockParagraph(node))
        break
      case 'table': {
        const rows: TableRow[] = (node.content ?? []).map((row, rIdx) => {
          const cells = (row.content ?? []).map((cell) => {
            const cellChildren = renderChildren(cell.content)
            return new TableCell({
              children: cellChildren.length ? (cellChildren as Paragraph[]) : [new Paragraph({ children: [] })],
            })
          })
          return new TableRow({ children: cells, tableHeader: rIdx === 0 })
        })
        out.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }))
        break
      }
      default:
        // 未知节点：渲染其文本内容（若有），避免静默丢内容
        if (node.text || (node.content?.length ?? 0) > 0) {
          out.push(blockParagraph(node))
        }
    }
  }
  return out
}

/** Tiptap JSON → docx 文档 */
function buildDocx(doc: JSONContent): Document {
  return new Document({
    numbering: {
      config: [
        {
          reference: 'rs-ordered',
          levels: [
            {
              level: 0,
              format: 'decimal',
              text: '%1.',
              alignment: AlignmentType.START,
              style: { paragraph: { indent: { left: 640, hanging: 320 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {},
        children: renderChildren(doc.content),
      },
    ],
  })
}

/** 导出 Word：content 为 Tiptap JSON 或旧版 Markdown（转换为 JSON 后结构化映射） */
export async function exportResumeDocx(content: string, filename: string): Promise<void> {
  const t = (content ?? '').trim()
  let doc: JSONContent | null = null
  if (t.startsWith('{')) {
    try {
      const parsed = JSON.parse(t) as JSONContent
      doc = parsed?.type === 'doc' ? parsed : null
    } catch {
      doc = null
    }
  }
  if (!doc) doc = markdownToDoc(content)
  const blob = await Packer.toBlob(buildDocx(doc))
  const name = filename.toLowerCase().endsWith('.docx') ? filename : `${filename}.docx`
  // 复用统一的下载实现（插入 DOM + 延迟回收 URL）：自己拼 anchor 时立即 revoke
  // 会让部分浏览器来不及取数据，下载被取消
  downloadBlob(blob, name)
}