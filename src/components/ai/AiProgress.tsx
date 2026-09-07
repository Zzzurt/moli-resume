import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface AiProgressProps {
  /** 主文案，如「正在通读整份简历…」 */
  label: string
  /** 已接收字符数；undefined 或 0 = 尚未收到首 token（显示已等待秒数） */
  chars?: number
  /** 紧凑模式：仅细进度条 + 一行状态（流式内容已可见时嵌在其上方） */
  compact?: boolean
}

/**
 * AI 进行中统一反馈（三个 AI 弹窗共用）：
 * - 顶部扫描式细进度条（流式总长未知，用扫描动画表达"进行中"而非虚假百分比）
 * - 等待首 token 阶段显示**已等待秒数**（消除"是不是卡了"的焦虑），
 *   流式阶段切换为**已生成字数**；副文案给预期管理（长文可能更久）。
 */
export function AiProgress({ label, chars, compact = false }: AiProgressProps) {
  const [elapsed, setElapsed] = useState(0)

  /* 等待计时：收到首 token（chars>0）后停止累计 */
  useEffect(() => {
    if (chars) return
    const t = window.setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => window.clearInterval(t)
  }, [chars])

  const stat = chars ? `已生成 ${chars} 字` : `已等待 ${elapsed} 秒`

  return (
    <div className={cn('flex w-full flex-col', compact ? 'gap-1.5' : 'items-center justify-center gap-3 p-4')}>
      <div className="ai-progress-track w-full" role="progressbar" aria-label={label}>
        <div className="ai-progress-bar" />
      </div>
      {compact ? (
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          <span>
            {label} · {stat}
          </span>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-1.5 text-center">
          <Loader2 className="size-5 animate-spin text-primary" />
          <p className="text-xs">{label}</p>
          <p className="text-[11px] text-muted-foreground">{stat} · 长文生成可能需要更久</p>
        </div>
      )}
    </div>
  )
}