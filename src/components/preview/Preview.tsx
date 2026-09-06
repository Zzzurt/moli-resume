import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, RefObject } from 'react'
import { toast } from 'sonner'
import { parseDoc, splitSidebarNodes, topNodes } from '@/lib/docUtils'
import { DocBlocks } from './DocRenderer'
import { PhotoSpot } from './PhotoSpot'
import type { TemplateId } from '@/types'

/** A4 @ 96dpi */
const A4_W = 794
const A4_H = 1123

/** 智能一页排版密度：0 常规 / 1 紧凑 / 2 紧密（只收垂直节奏，字号不动） */
type Density = 0 | 1 | 2
const DENSITY_CLASS: Record<Density, string> = { 0: '', 1: 'rs-compact', 2: 'rs-tight' }
/** 密度压满后允许的最小缩放：低于此值放弃缩放，保留多页（可读性优先）。
    取 0.85：叠加在 tight 密度上字号仍 ≥85%，好过第二页只挂几行的孤儿页 */
const MIN_FIT_SCALE = 0.85

/** 单栏模板 → 模板类名（双栏模板在 renderBody 内直接拼 tpl-${template}） */
const SINGLE_COL_CLASS: Partial<Record<TemplateId, string>> = {
  minimal: 'tpl-minimal',
  classic: 'tpl-classic',
  tech: 'tpl-tech',
  elegant: 'tpl-elegant',
  business: 'tpl-business',
  pill: 'tpl-pill',
}

interface PhotoTransform {
  scale?: number
  pos?: { dx: number; dy: number }
}

interface PreviewProps {
  /** Tiptap JSON 字符串（块级文档） */
  content: string
  template: TemplateId
  photo?: string
  photoScale?: number
  photoPos?: { dx: number; dy: number }
  onPhotoChange: (photo: string | undefined) => void
  onPhotoScaleChange: (scale: number) => void
  onPhotoPosChange: (pos: { dx: number; dy: number }) => void
  /** 纸张 DOM 引用（供 PDF 导出截图） */
  paperRef: RefObject<HTMLDivElement>
  /** 点击预览块时回调对应块索引（与编辑器 data-index 对应） */
  onLineClick?: (index: number) => void
  /** 智能一页：内容超一页时自动缩放至恰好一页 */
  smartOnePage?: boolean
  /** 主题色覆盖（作用到模板 --rs-accent）；空 = 模板默认色 */
  accentColor?: string
}

/**
 * A4 纸张化预览：
 * - 纸张固定 794px 宽，随面板宽度整体缩放；分页线与 PDF 切割位置一致
 * - 与编辑器共享 Tiptap JSON 数据：切换模板仅换 CSS 类，不动数据
 * - 智能一页：内容超过一页时自动缩放内容层至恰好一页（可关）
 * - 点击内容块（data-index）→ 编辑器滚动到对应块
 * - 证件照：现代模板显示在侧栏顶部，其他模板浮动右上；可拖动/缩放
 */
export function Preview({
  content,
  template,
  photo,
  photoScale,
  photoPos,
  onPhotoChange,
  onPhotoScaleChange,
  onPhotoPosChange,
  paperRef,
  onLineClick,
  smartOnePage = true,
  accentColor,
}: PreviewProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  /** 测量分身：固定纸宽渲染同一份内容，专供智能一页取自然高度 */
  const measureRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const [paperHeight, setPaperHeight] = useState(A4_H)
  /** 智能一页：密度分级 + 轻度缩放；overflow=true 表示放弃缩放、保留分页 */
  const [density, setDensity] = useState<Density>(0)
  const [contentFit, setContentFit] = useState<{ scale: number; fit: boolean; overflow: boolean }>({
    scale: 1,
    fit: false,
    overflow: false,
  })
  /** 各密度档的自然高度缓存（仅当前内容有效，换档/改内容后失效） */
  const heightsRef = useRef<Partial<Record<Density, number>>>({})
  const lastMeasureRef = useRef<{ h: number; d: Density } | null>(null)
  const wasOverflowRef = useRef(false)

  const setFitState = useCallback(
    (next: { scale: number; fit: boolean; overflow: boolean }) => {
      setContentFit((prev) =>
        prev.scale === next.scale && prev.fit === next.fit && prev.overflow === next.overflow
          ? prev
          : next
      )
    },
    []
  )

  const doc = useMemo(() => parseDoc(content), [content])
  const split = useMemo(
    () => (doc ? splitSidebarNodes(doc) : { sidebar: [], main: [], hrIndex: -1 }),
    [doc]
  )
  /** 双栏模板：第一个 `---` 之前的内容进侧栏 */
  const isSidebarTemplate = template === 'modern' || template === 'sleek'
  const sidebarNodes = isSidebarTemplate ? split.sidebar : []
  const mainNodes = isSidebarTemplate ? split.main : doc ? topNodes(doc) : []
  // 主栏起始索引：有分界 hr 时跳过侧栏块与 hr 本身，无 hr 则从 0 起，保持与编辑器块序列对齐
  const mainStart = isSidebarTemplate && split.hrIndex >= 0 ? split.sidebar.length + 1 : 0

  /** 当前密度档的类名（纸张内容与测量分身同挂，保证测量与渲染一致） */
  const densityClass = DENSITY_CLASS[density]

  const photoTransform: PhotoTransform = { scale: photoScale, pos: photoPos }
  const onPhotoTransform = {
    scale: onPhotoScaleChange,
    pos: onPhotoPosChange,
  }

  /* 面板宽度 → 缩放比例 */
  useEffect(() => {
    const vp = viewportRef.current
    if (!vp) return
    const ro = new ResizeObserver(() => {
      const w = vp.clientWidth - 56
      setScale(Math.min(1, Math.max(0.32, w / A4_W)))
    })
    ro.observe(vp)
    return () => ro.disconnect()
  }, [])

  /* 智能一页 v2：先分级收紧排版密度（字号不动），密度压满仍放不下才轻度缩放
     （不低于 MIN_FIT_SCALE），再多就放弃缩放、保留分页。测量在固定纸宽的分身上
     进行（宽度恒定 → 无"缩放→重排→再缩放"反馈循环导致页面横跳）。
     密度升降档带迟滞：只有低档实测放不下时才保持高档，避免临界内容来回抖动 */
  useEffect(() => {
    const el = measureRef.current
    if (!smartOnePage || !el) {
      heightsRef.current = {}
      lastMeasureRef.current = null
      wasOverflowRef.current = false
      setDensity(0)
      setFitState({ scale: 1, fit: false, overflow: false })
      return
    }
    const measure = () => {
      const naturalH = el.scrollHeight
      const last = lastMeasureRef.current
      // RO 回声：同内容同密度不重复决策
      if (last && last.h === naturalH && last.d === density) return
      // 注意：不因内容变化清空缓存——过期的「低档通过」记录会被重测纠正，
      // 过期的「低档失败」记录只会让高档多留一档（保守方向），整体仍然收敛
      lastMeasureRef.current = { h: naturalH, d: density }
      heightsRef.current[density] = naturalH

      if (naturalH <= A4_H) {
        const lower = (density - 1) as Density
        const lowerH = heightsRef.current[lower]
        if (density > 0 && (lowerH === undefined || lowerH <= A4_H)) {
          // 不变量：fit/scale 只属于最高密度档，任何换档先重置缩放
          setFitState({ scale: 1, fit: false, overflow: false })
          setDensity(lower)
          return
        }
        setFitState({ scale: 1, fit: false, overflow: false })
        return
      }
      if (density < 2) {
        setFitState({ scale: 1, fit: false, overflow: false })
        setDensity((density + 1) as Density)
        return
      }
      const s = Math.min(1, (A4_H - 2) / naturalH)
      if (s >= MIN_FIT_SCALE) {
        setFitState({ scale: s, fit: true, overflow: false })
      } else {
        setFitState({ scale: 1, fit: false, overflow: true })
        if (!wasOverflowRef.current) {
          toast.info('内容较多，已保留多页排版：可精简内容，或关闭「智能一页」手动调整', {
            id: 'onepage-fallback',
          })
        }
      }
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    measure()
    return () => ro.disconnect()
  }, [smartOnePage, density])

  /** 纸张实际高度（分页线数量）：
     - 适配成功（缩放或密度收紧后恰好一页）：A4
     - 放弃缩放（overflow）：内容自然高度（内容层无缩放，scale 恒为 1）
     - 常规：内容自然高度（不足一页时纸张保持一页） */
  useEffect(() => {
    let visualH: number
    if (!smartOnePage) {
      visualH = paperRef.current?.scrollHeight ?? A4_H
    } else if (contentFit.fit) {
      visualH = A4_H
    } else {
      visualH = (contentRef.current?.scrollHeight ?? A4_H) * contentFit.scale
    }
    setPaperHeight(Math.max(A4_H, Math.round(visualH)))
    // density 变化会改变内容层实际高度（同 contentFit 值不变时也要重算占位）
  }, [paperRef, content, template, photo, photoScale, photoPos, contentFit, smartOnePage, density])

  const pageCount = Math.max(1, Math.ceil((paperHeight - 1) / A4_H))
  const fitActive = smartOnePage && contentFit.fit && contentFit.scale < 1

  /* 事件委托：data-index → 块索引 */
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!onLineClick) return
      const target = (e.target as HTMLElement).closest('[data-index]')
      if (target) {
        const index = Number(target.getAttribute('data-index'))
        if (Number.isFinite(index) && index >= 0) onLineClick(index)
      }
    },
    [onLineClick]
  )

  /* 主题色覆盖：必须内联在 tpl-* 元素本身——tpl-* 类在自身上定义了 --rs-accent，
     挂在祖先上的覆盖会被近处定义赢过 */
  const accentStyle = accentColor ? ({ ['--rs-accent']: accentColor } as CSSProperties) : undefined

  const renderBody = () =>
    isSidebarTemplate ? (
      <div className={`tpl-${template} rs-body ${densityClass}`} style={accentStyle}>
        <div className="rs-sidebar">
          <PhotoSpot
            variant="sidebar"
            photo={photo}
            scale={photoTransform.scale}
            pos={photoTransform.pos}
            onChange={onPhotoChange}
            onChangeScale={onPhotoTransform.scale}
            onChangePos={onPhotoTransform.pos}
          />
          <DocBlocks nodes={sidebarNodes} startIndex={0} />
        </div>
        <div className="rs-main">
          <DocBlocks nodes={mainNodes} startIndex={mainStart} />
        </div>
      </div>
    ) : (
      <div
        className={(SINGLE_COL_CLASS[template] ?? 'tpl-minimal') + (densityClass ? ` ${densityClass}` : '')}
        style={accentStyle}
      >
        <PhotoSpot
          variant="float"
          photo={photo}
          scale={photoTransform.scale}
          pos={photoTransform.pos}
          onChange={onPhotoChange}
          onChangeScale={onPhotoTransform.scale}
          onChangePos={onPhotoTransform.pos}
        />
        <DocBlocks nodes={mainNodes} startIndex={0} />
      </div>
    )

  return (
    <div
      ref={viewportRef}
      className="relative h-full overflow-auto bg-muted/40 scrollbar-thin dark:bg-black/30"
      onClick={handleClick}
    >
      {/* 智能一页测量分身：固定纸宽渲染同一份内容（含当前密度档）；隐藏、不可交互、不在导出纸张内。
          关键在于它的宽度恒定，测得的高度不随缩放变化，消除反馈循环 */}
      {smartOnePage && (
        <div
          ref={measureRef}
          aria-hidden
          className={densityClass}
          style={{
            position: 'absolute',
            left: -99999,
            top: 0,
            width: A4_W,
            visibility: 'hidden',
            pointerEvents: 'none',
          }}
        >
          {renderBody()}
        </div>
      )}
      <div className="mx-auto" style={{ width: A4_W * scale, height: paperHeight * scale }}>
        {/* 缩放占位容器：纸张本体 transform 缩放 */}
        <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}>
          <div
            ref={paperRef}
            className="resume-paper"
            style={{ minHeight: A4_H, height: fitActive ? A4_H : undefined }}
            data-testid="resume-paper"
          >
            {/* 智能一页内容层：scale 压缩高度，宽度反向放大保证铺满纸面 */}
            <div
              ref={contentRef}
              style={{
                transform: fitActive ? `scale(${contentFit.scale})` : undefined,
                transformOrigin: 'top left',
                width: fitActive ? `${100 / contentFit.scale}%` : undefined,
              }}
            >
              {renderBody()}
            </div>

            {/* 分页指示线：仅预览，导出时隐藏 */}
            {Array.from({ length: pageCount - 1 }, (_, i) => (
              <div
                key={i}
                className="page-break-line"
                style={{ top: (i + 1) * A4_H }}
                data-label={`第 ${i + 2} 页`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
