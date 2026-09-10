import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

interface ResizerProps {
  /** 拖动结束时回调左侧面板宽度占比（0-1） */
  onResize: (ratio: number) => void
  /** 当前占比（用于计算像素） */
  ratio: number
}

/** 左右分栏的可拖动分割线 */
export function Resizer({ onResize, ratio }: ResizerProps) {
  /* 拖拽态要参与 className（高亮/把手常显），必须是 state：
     用 ref 的话改了不会重渲染，高亮永远不出现 */
  const [dragging, setDragging] = useState(false)
  const draggingRef = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const onPointerMove = useCallback(
    (e: MouseEvent) => {
      if (!draggingRef.current || !containerRef.current) return
      const parent = containerRef.current.parentElement
      if (!parent) return
      const rect = parent.getBoundingClientRect()
      const next = (e.clientX - rect.left) / rect.width
      onResize(Math.min(0.72, Math.max(0.22, next)))
    },
    [onResize]
  )

  const stop = useCallback(() => {
    draggingRef.current = false
    setDragging(false)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }, [])

  useEffect(() => {
    window.addEventListener('mousemove', onPointerMove)
    window.addEventListener('mouseup', stop)
    return () => {
      window.removeEventListener('mousemove', onPointerMove)
      window.removeEventListener('mouseup', stop)
    }
  }, [onPointerMove, stop])

  return (
    <div
      ref={containerRef}
      role="separator"
      aria-orientation="vertical"
      aria-label="调整编辑与预览的宽度比例"
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={22}
      aria-valuemax={72}
      className={cn(
        'group relative z-10 w-px shrink-0 cursor-col-resize bg-border transition-colors hover:bg-primary/60',
        dragging && 'bg-primary'
      )}
      onMouseDown={(e) => {
        e.preventDefault()
        draggingRef.current = true
        setDragging(true)
        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'
      }}
    >
      {/* 加宽的可点击热区 */}
      <span className="absolute inset-y-0 -left-2 -right-2" />
      {/* 中心把手 */}
      <span
        className={cn(
          'absolute left-1/2 top-1/2 flex h-8 w-3.5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border bg-background opacity-0 transition-opacity group-hover:opacity-100',
          dragging && 'opacity-100'
        )}
      >
        <span className="h-3 w-0.5 rounded-full bg-muted-foreground/50" style={{ transform: `scaleX(${ratio})` }} />
      </span>
    </div>
  )
}
