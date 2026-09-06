import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { JSONContent } from '@tiptap/react'
import { Check } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { parseDoc, splitSidebarNodes, topNodes } from '@/lib/docUtils'
import { DocBlocks } from '@/components/preview/DocRenderer'
import { TEMPLATES, type TemplateId } from '@/types'
import { cn } from '@/lib/utils'

/** A4 @ 96dpi 宽（与 Preview 一致） */
const A4_W = 794

/**
 * 模板实时缩放卡片：把当前文档按模板 t 渲染成 A4 整页，等比缩进卡片。
 * 与静态快照不同——卡片反映用户真实内容与当前主题色，选模板即所见。
 * 缩放方式与 Preview 相同（固定纸宽 + transform scale），容器按 A4 比例
 * 裁切出"恰好一页"的缩略；不做智能一页密度分级（预览面板不需要）。
 */
function TemplateThumb({
  template,
  doc,
  accentColor,
}: {
  template: TemplateId
  doc: JSONContent | null
  accentColor?: string
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

  const isSidebar = template === 'modern' || template === 'sleek'
  const split = useMemo(
    () => (isSidebar && doc ? splitSidebarNodes(doc) : null),
    [doc, isSidebar]
  )
  /* 主题色覆盖必须内联在 tpl-* 元素本身（与 Preview 同理） */
  const accentStyle = accentColor ? ({ ['--rs-accent']: accentColor } as CSSProperties) : undefined

  return (
    <div ref={boxRef} className="relative aspect-[210/297] w-full overflow-hidden bg-white">
      {scale > 0 && (
        <div
          aria-hidden
          className="pointer-events-none absolute left-0 top-0 origin-top-left"
          style={{ width: A4_W, transform: `scale(${scale})` }}
        >
          {isSidebar && split ? (
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

interface TemplatePickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 当前模板（高亮标记） */
  template: TemplateId
  /** 当前简历内容（Tiptap JSON，建议上层传防抖版本，避免输入期间高频重渲染 8 张卡片） */
  content: string
  /** 主题色覆盖（实时联动所有卡片） */
  accentColor?: string
  onSelect: (t: TemplateId) => void
}

/**
 * 模板选择面板（参考 Magic Resume 的 TemplateSheet，改用实时渲染）：
 * 4 列网格、当前模板高亮、点击即切换并关闭——与「切模板不动内容」语义一致。
 */
export function TemplatePickerDialog({
  open,
  onOpenChange,
  template,
  content,
  accentColor,
  onSelect,
}: TemplatePickerDialogProps) {
  const doc = useMemo(() => parseDoc(content), [content])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto scrollbar-thin">
        <DialogHeader>
          <DialogTitle>切换模板</DialogTitle>
          <DialogDescription>
            按当前简历内容与主题色实时预览；切换只换样式，内容保持不变。
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 pb-1 sm:grid-cols-4">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              data-testid={`picker-${t.id}`}
              onClick={() => {
                onSelect(t.id)
                onOpenChange(false)
              }}
              className={cn(
                'overflow-hidden rounded-lg border text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md',
                template === t.id
                  ? 'border-primary ring-1 ring-primary'
                  : 'border-border hover:border-primary/60'
              )}
            >
              <TemplateThumb template={t.id} doc={doc} accentColor={accentColor} />
              <div className="border-t bg-card px-2.5 py-2">
                <div className="flex items-center gap-1.5">
                  <span className={cn('size-2 shrink-0 rounded-[3px]', t.dotClass)} />
                  <span className="truncate text-xs font-semibold">{t.name}</span>
                  {template === t.id && <Check className="ml-auto size-3.5 shrink-0 text-primary" />}
                </div>
                <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{t.description}</p>
              </div>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}