import type { ReactNode } from 'react'
import type { JSONContent } from '@tiptap/react'

/**
 * Tiptap JSON → React 渲染器（预览侧）。
 * 与编辑器共享同一份数据模型，保证"所见即所得"；
 * 仅顶层块绑定 data-index（与编辑器块序列一一对应），嵌套内容不绑定，
 * 点击嵌套元素时通过 closest 上溯到所属顶层块。
 */

/**
 * 条目标题拆分：按最后一个 `|` 把 `主体 | 日期` 拆成左右两段（日期右对齐），
 * 分隔符本身丢弃。仅处理纯文本内联内容；结构不支持（如加粗跨节点数组边界
 * 复杂交错）时按保守方式拆分文本，无法拆时返回 null，按普通标题渲染。
 */
function splitEntryHeading(nodes: JSONContent[]): { main: JSONContent[]; date: JSONContent[] } | null {
  const texts = nodes.map((n) => (typeof n.text === 'string' ? n.text : null))
  if (texts.some((t) => t === null)) return null
  const full = texts.join('')
  const m = full.match(/^(.*\S)\s*\|\s*(\S[^|]*)$/)
  if (!m) return null
  const mainLen = m[1].length // 主体结束位置
  const dateStart = full.length - m[2].length // 日期开始位置
  if (dateStart <= mainLen) return null

  const main: JSONContent[] = []
  const date: JSONContent[] = []
  let consumed = 0
  for (const n of nodes) {
    const text = n.text ?? ''
    const start = consumed
    const end = consumed + text.length
    consumed = end
    if (end <= mainLen) {
      main.push(n)
    } else if (start >= dateStart) {
      date.push(n)
    } else if (start >= mainLen && end <= dateStart) {
      /* 落在分隔符区间内的节点：丢弃 */
    } else {
      // 跨边界的文本节点：切成主体/日期两半，分隔符区间丢弃
      const mainPart = text.slice(0, Math.max(0, Math.min(text.length, mainLen - start)))
      const datePart = text.slice(Math.max(0, Math.min(text.length, dateStart - start)))
      if (mainPart) main.push({ ...n, text: mainPart })
      if (datePart) date.push({ ...n, text: datePart })
    }
  }
  if (!main.length || !date.length) return null
  return { main, date }
}

/** 顶层块渲染（带 data-index） */
export function DocBlocks({ nodes, startIndex = 0 }: { nodes: JSONContent[]; startIndex?: number }) {
  return (
    <>
      {nodes.map((node, i) => (
        <Block key={startIndex + i} node={node} index={startIndex + i} indexed />
      ))}
    </>
  )
}

/** 嵌套块渲染（列表项 / 引用内部，不绑定索引） */
function NestedBlocks({ nodes }: { nodes: JSONContent[] }) {
  return (
    <>
      {nodes.map((node, i) => (
        <Block key={i} node={node} index={-1} />
      ))}
    </>
  )
}

function Block({ node, index, indexed = false }: { node: JSONContent; index: number; indexed?: boolean }) {
  const di = indexed ? { 'data-index': index } : {}

  switch (node.type) {
    case 'heading': {
      const level = Math.min(Math.max(Number(node.attrs?.level ?? 2), 1), 6)
      const inner = renderInline(node.content)
      if (level === 1) return <h1 {...di}>{inner}</h1>
      // h2 文本包一层 span：胶囊等模板需要「标题居中 + 左右细线」的弹性布局锚点
      if (level === 2)
        return (
          <h2 {...di}>
            <span className="h2-inner">{inner}</span>
          </h2>
        )
      if (level === 3) {
        // 条目标题约定：`公司 · 职位 | 2022.03 - 至今` → 主体靠左、日期靠右
        const entry = splitEntryHeading(node.content ?? [])
        if (entry) {
          return (
            <h3 {...di} className="entry-head">
              <span className="entry-main">{renderInline(entry.main)}</span>
              <span className="entry-date">{renderInline(entry.date)}</span>
            </h3>
          )
        }
        return <h3 {...di}>{inner}</h3>
      }
      if (level === 4) return <h4 {...di}>{inner}</h4>
      if (level === 5) return <h5 {...di}>{inner}</h5>
      return <h6 {...di}>{inner}</h6>
    }
    case 'paragraph':
      return <p {...di}>{renderInline(node.content)}</p>
    case 'bulletList':
      return (
        <ul {...di}>
          {(node.content ?? []).map((li, i) => (
            <li key={i}>
              <NestedBlocks nodes={li.content ?? []} />
            </li>
          ))}
        </ul>
      )
    case 'orderedList':
      return (
        <ol {...di}>
          {(node.content ?? []).map((li, i) => (
            <li key={i}>
              <NestedBlocks nodes={li.content ?? []} />
            </li>
          ))}
        </ol>
      )
    case 'blockquote':
      return (
        <blockquote {...di}>
          <NestedBlocks nodes={node.content ?? []} />
        </blockquote>
      )
    case 'horizontalRule':
      return <hr {...di} />
    case 'image':
      return <img {...di} src={node.attrs?.src} alt={node.attrs?.alt ?? ''} />
    case 'codeBlock':
      return (
        <pre {...di}>
          <code>{(node.content ?? []).map((n) => n.text ?? '').join('')}</code>
        </pre>
      )
    case 'table':
      return (
        <table {...di}>
          <tbody>
            {(node.content ?? []).map((row, ri) => (
              <tr key={ri}>
                {(row.content ?? []).map((cell, ci) => {
                  const align = (cell.attrs?.align as string | undefined) ?? undefined
                  const cellStyle = align ? { textAlign: align as React.CSSProperties['textAlign'] } : undefined
                  return cell.type === 'tableHeader' ? (
                    <th key={ci} style={cellStyle}>
                      <NestedBlocks nodes={cell.content ?? []} />
                    </th>
                  ) : (
                    <td key={ci} style={cellStyle}>
                      <NestedBlocks nodes={cell.content ?? []} />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )
    default:
      return null
  }
}

/** 行内内容渲染（含 marks 样式） */
function renderInline(nodes: JSONContent[] = []): ReactNode[] {
  return nodes.map((n, i) => {
    if (n.type === 'hardBreak') return <br key={i} />
    if (n.type === 'image') return <img key={i} src={n.attrs?.src} alt={n.attrs?.alt ?? ''} />
    if (n.type !== 'text') return null
    return (
      <Marks key={i} marks={n.marks ?? []}>
        {n.text ?? ''}
      </Marks>
    )
  })
}

/** 仅放行安全协议：文档可能来自导入的备份文件，须拦截 javascript: 等注入 */
function safeHref(href: unknown): string | null {
  if (typeof href !== 'string') return null
  const trimmed = href.trim()
  if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed
  // 无协议的相对路径/锚点同样放行
  if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed
  return null
}

function Marks({ marks, children }: { marks: JSONContent[]; children: ReactNode }) {
  let el: ReactNode = children
  let key = 0
  for (const m of marks) {
    const k = `m${key++}`
    switch (m.type) {
      case 'bold':
        el = <strong key={k}>{el}</strong>
        break
      case 'italic':
        el = <em key={k}>{el}</em>
        break
      case 'strike':
        el = <s key={k}>{el}</s>
        break
      case 'code':
        el = <code key={k}>{el}</code>
        break
      case 'underline':
        el = <u key={k}>{el}</u>
        break
      case 'link': {
        const href = safeHref(m.attrs?.href)
        if (href) el = <a key={k} href={href} target="_blank" rel="noreferrer">{el}</a>
        break
      }
    }
  }
  return <>{el}</>
}
