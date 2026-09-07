import type { JSONContent } from '@tiptap/react'

/**
 * Tiptap JSON 文档工具：
 * - 新旧内容格式判断（旧 = Markdown 字符串）
 * - "现代"模板侧栏拆分（按第一个水平线节点）
 * - 列表页摘要提取
 */

/** 解析 Tiptap JSON 文档：非 JSON 或结构不符时返回 null（仅解析一次） */
export function parseDoc(raw: string): JSONContent | null {
  const t = raw.trim()
  if (!t.startsWith('{')) return null
  try {
    const parsed = JSON.parse(t) as JSONContent
    return parsed?.type === 'doc' ? parsed : null
  } catch {
    return null
  }
}

/** 判断存储内容是否已是 Tiptap JSON 文档 */
export function isTiptapDoc(raw: string): boolean {
  return parseDoc(raw) !== null
}

/** 文档顶层节点数组（= 编辑器/预览的块序列） */
export function topNodes(doc: JSONContent): JSONContent[] {
  return doc.content ?? []
}

/** 按第一个 horizontalRule 拆分顶层节点：之前进侧栏、之后进主栏（现代模板） */
export function splitSidebarNodes(doc: JSONContent): {
  sidebar: JSONContent[]
  main: JSONContent[]
  /** 分界 hr 在顶层块序列中的索引，-1 表示无分界 */
  hrIndex: number
} {
  const nodes = topNodes(doc)
  const hrIndex = nodes.findIndex((n) => n.type === 'horizontalRule')
  if (hrIndex < 0) return { sidebar: [], main: nodes, hrIndex: -1 }
  return {
    sidebar: nodes.slice(0, hrIndex),
    main: nodes.slice(hrIndex + 1),
    hrIndex,
  }
}

/** 递归提取节点内全部纯文本 */
export function nodeText(node: JSONContent): string {
  if (node.type === 'text') return node.text ?? ''
  return (node.content ?? []).map(nodeText).join('')
}

/**
 * 剥离 Markdown 语法标记（列表/有序/标题/引用前缀 + 加粗/斜体/行内码/删除线）。
 * 用于"AI 复制的 Markdown 源码片段"与"渲染后的纯文本"之间的鲁棒匹配：
 * AI 的锚点片段来自 Markdown 源码（带 `- `、`**` 等符号），纯文本里没有这些字符。
 */
export function stripMdSyntax(s: string): string {
  return s
    .replace(/^[ \t]{0,3}[-*+][ \t]+/gm, '')
    .replace(/^[ \t]{0,3}\d+\.[ \t]+/gm, '')
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]{0,3}>[ \t]?/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
}

/** 列表页摘要：旧 Markdown 或新 JSON 的第一个标题/段落 */
export function docFirstLine(raw: string): string | null {
  const doc = parseDoc(raw)
  if (doc) {
    for (const node of topNodes(doc)) {
      if (node.type === 'heading' || node.type === 'paragraph') {
        const text = nodeText(node).trim()
        if (text) return text
      }
    }
    return null
  }
  // 旧格式兜底：逐行找第一个非空行
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t) continue
    return t.replace(/^#+\s*/, '').replace(/^[-*]\s*/, '')
  }
  return null
}
