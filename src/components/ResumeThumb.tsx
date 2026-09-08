import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { parseDoc, splitSidebarNodes, topNodes } from '@/lib/docUtils'
import { markdownToDoc } from '@/lib/editorSetup'
import { DocBlocks } from '@/components/preview/DocRenderer'
import type { TemplateId } from '@/types'

/** A4 @ 96dpi 宽（与 Preview 一致） */
const A4_W = 794

/**
 * 文档实时缩略卡片：把任意文档按指定模板渲染成 A4 整页等比缩进容器。
 * 复用场景：模板选择面板、列表页简历卡片。
 * - 固定纸宽 + transform scale，容器按 A4 比例裁切"恰好一页"缩略
 * - 不做智能一页密度分级（缩略图只需首屏形态）
 */
export function ResumeThumb({
  template,
  content,
  accentColor,
  emptyHint,
}: {
  template: TemplateId
  /** Tiptap JSON 字符串（空串 = 空白文档，显示占位） */
  content: string
  /** 主题色覆盖（作用到模板 --rs-accent）；空 = 模板默认色 */
  accentColor?: string
  /** 空文档时在纸张中央显示的提示文案 */
  emptyHint?: string
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0)

  /* 卡片宽度由网格决定 → ResizeObserver 实时算缩放比（卡宽/A4 宽） */
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setScale(el.clientWidth / A4_W))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const doc = useMemo(() => {
    const t = (content ?? '').trim()
    if (!t) return null
    /* 已是 Tiptap JSON：直接解析；旧版 Markdown（未迁移）经转换兜底，保证缩略图有内容 */
    const parsed = parseDoc(t)
    if (parsed) return parsed
    try {
      return markdownToDoc(content) ?? null
    } catch {
      return null
    }
  }, [content])
  const isEmpty = !doc || !doc.content || doc.content.length === 0
  const isSidebar = template === 'modern' || template === 'sleek'
  const split = useMemo(
    () => (isSidebar && doc ? splitSidebarNodes(doc) : null),
    [doc, isSidebar]
  )
  /* 主题色覆盖必须内联在 tpl-* 元素本身（与 Preview 同理） */
  const accentStyle = accentColor ? ({ ['--rs-accent']: accentColor } as CSSProperties) : undefined

  return (
    <div
      ref={boxRef}
      className="relative aspect-[210/297] w-full overflow-hidden bg-white"
      data-testid="resume-thumb"
    >
      {scale > 0 && (
        <div
          aria-hidden
          className="pointer-events-none absolute left-0 top-0 origin-top-left"
          style={{ width: A4_W, transform: `scale(${scale})` }}
        >
          {isEmpty ? (
            /* 空白文档占位：虚线 A4 轮廓 + 居中提示，让空态可感知 */
            <div
              className={isSidebar ? 'tpl-modern rs-body' : 'tpl-minimal'}
              style={{ width: A4_W, minHeight: 1123 }}
            >
              <div className="flex h-full items-center justify-center" style={{ minHeight: 1123 }}>
                <div className="mx-6 flex w-full flex-1 items-center justify-center rounded border border-dashed border-gray-200 dark:border-gray-700">
                  <span className="pb-1 text-sm text-gray-400 dark:text-gray-500">
                    {emptyHint ?? '空白简历'}
                  </span>
                </div>
              </div>
            </div>
          ) : isSidebar && split ? (
            <div className={`tpl-${template} rs-body`} style={accentStyle}>
              <div className="rs-sidebar">
                <DocBlocks nodes={split.sidebar} startIndex={0} />
              </div>
              <div className="rs-main">
                <DocBlocks nodes={split.main} startIndex={0} />
              </div>
            </div>
          ) : (
            <div className={`tpl-${template}`} style={accentStyle}>
              <DocBlocks nodes={doc ? topNodes(doc) : []} startIndex={0} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}