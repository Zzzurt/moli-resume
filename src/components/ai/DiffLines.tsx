import { diffLines } from 'diff'
import { cn } from '@/lib/utils'

export interface DiffPart {
  text: string
  type: 'same' | 'added' | 'removed'
}

/** 行级 diff（LCS）：返回 same/added/removed 分段 */
export function lineParts(a: string, b: string): DiffPart[] {
  return diffLines(a, b).map((p) => ({
    text: p.value,
    type: p.added ? 'added' : p.removed ? 'removed' : 'same',
  }))
}

/**
 * diff 分行渲染：added/removed 行加背景标注（空行占位保持行结构）。
 * side='before' 只显示 same+removed（红 = 移除/改前）；'after' 只显示 same+added（绿 = 新增/改后）。
 * PolishDialog（AI 对照）与 JdMatchDialog（建议改写预览）共用。
 */
export function DiffLines({
  parts,
  side,
  className,
}: {
  parts: DiffPart[]
  side: 'before' | 'after'
  className?: string
}) {
  const lines: { text: string; type: DiffPart['type'] }[] = []
  for (const part of parts) {
    if (side === 'after' && part.type === 'removed') continue
    if (side === 'before' && part.type === 'added') continue
    const segs = part.text.split('\n')
    segs.forEach((text, i) => {
      if (i === segs.length - 1 && text === '' && segs.length > 1) return
      lines.push({ text: text || ' ', type: part.type })
    })
  }
  return (
    <div className={cn('flex flex-col', className)}>
      {lines.map((l, i) => (
        <div
          key={i}
          className={cn(
            '-mx-2 whitespace-pre-wrap break-words px-2',
            l.type === 'added' && 'bg-success/15 text-diff-add',
            l.type === 'removed' &&
              'bg-destructive/10 text-diff-del/70 line-through decoration-destructive/50'
          )}
        >
          {l.text}
        </div>
      ))}
    </div>
  )
}