import { useCallback, useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

interface ResizerProps {
  /** 拖动结束时回调左侧面板宽度占比（0-1） */
  onResize: (ratio: number) => void
  /** 当前占比（用于计算像素） */
  ratio: number
}

/** 左右分栏的可拖动分割线 */
export function Resizer({ onResize, ratio }: ResizerProps) {
  const dragging = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const onPointerMove = useCallback(
    (e: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return
      const parent = containerRef.current.parentElement
      if (!parent) return
      const rect = parent.getBoundingClientRect()
      const next = (e.clientX - rect.left) / rect.width
      onResize(Math.min(0.72, Math.max(0.22, next)))
    },
    [onResize]
  )

  const stop = useCallback(() => {
    dragging.current = false
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
      className={cn(
        'group relative z-10 w-px shrink-0 cursor-col-resize bg-border transition-colors hover:bg-primary/60',
        dragging.current && 'bg-primary'
      )}
      onMouseDown={(e) => {
        e.preventDefault()
        dragging.current = true
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
          dragging.current && 'opacity-100'
        )}
      >
        <span className="h-3 w-0.5 rounded-full bg-muted-foreground/50" style={{ transform: `scaleX(${ratio})` }} />
      </span>
    </div>
  )
}
