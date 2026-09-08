import { useCallback, useEffect, useRef, useState } from 'react'
import { SpellCheck2, RefreshCw, Check, Wand2, Square } from 'lucide-react'
import { AiProgress } from '@/components/ai/AiProgress'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useSettings } from '@/hooks/useSettings'
import { aiErrorMessage, checkGrammar, isAbortedError } from '@/lib/aiService'
import type { GrammarSuggestion } from '@/types'
import { toast } from 'sonner'

interface GrammarDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  markdown: string
  /** 应用一条建议后的新全文 */
  onApply: (nextMarkdown: string) => void
}

type Phase = 'checking' | 'done' | 'error' | 'idle' | 'stopped'

/** 整份简历语法检查：逐条审阅、逐条应用 */
export function GrammarDialog({ open, onOpenChange, markdown, onApply }: GrammarDialogProps) {
  const { settings } = useSettings()
  const [phase, setPhase] = useState<Phase>('idle')
  const [suggestions, setSuggestions] = useState<GrammarSuggestion[]>([])
  const [appliedIds, setAppliedIds] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)
  /** 流式接收中的字数进度 */
  const [received, setReceived] = useState(0)
  /** 应用过程中的最新全文：每应用一条立即更新，避免后续建议基于过期快照互相覆盖 */
  const [currentMd, setCurrentMd] = useState(markdown)
  /** 当前检查的中止控制器（「停止」按钮触发 abort） */
  const abortRef = useRef<AbortController | null>(null)

  const run = useCallback(async () => {
    const ac = new AbortController()
    abortRef.current = ac
    setPhase('checking')
    setError(null)
    setAppliedIds(new Set())
    setCurrentMd(markdown)
    setReceived(0)
    try {
      const list = await checkGrammar(
        { baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel },
        markdown,
        { onDelta: (partial) => setReceived(partial.length), signal: ac.signal }
      )
      setSuggestions(list)
      setPhase('done')
    } catch (e) {
      if (isAbortedError(e)) setPhase('stopped')
      else {
        setError(aiErrorMessage(e))
        setPhase('error')
      }
    } finally {
      abortRef.current = null
    }
  }, [markdown, settings])

  useEffect(() => {
    if (open) void run()
  }, [open, run])

  const applyOne = (i: number, s: GrammarSuggestion) => {
    const idx = currentMd.indexOf(s.original)
    if (idx === -1) {
      toast.error('未能在原文中定位该片段')
      return
    }
    const next = currentMd.slice(0, idx) + s.suggestion + currentMd.slice(idx + s.original.length)
    setCurrentMd(next)
    onApply(next)
    setAppliedIds((prev) => new Set(prev).add(i))
    toast.success('已应用该修改')
  }

  const pending = suggestions.filter((_, i) => !appliedIds.has(i))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SpellCheck2 className="size-4 text-primary" />
            语法检查
          </DialogTitle>
          <DialogDescription>
            AI 审阅整份简历的错别字、语病与表达问题，逐条确认后应用。
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0">
          {phase === 'checking' && (
            <div className="flex flex-col items-center gap-3">
              <AiProgress
                label="正在通读整份简历，检查错别字、语病与表达问题…"
                chars={received > 0 ? received : undefined}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => abortRef.current?.abort()}
              >
                <Square className="size-3.5" /> 停止
              </Button>
            </div>
          )}

          {phase === 'stopped' && (
            <div className="flex h-32 flex-col items-center justify-center gap-3">
              <p className="text-xs text-muted-foreground">已停止检查</p>
              <Button size="sm" variant="outline" onClick={() => void run()}>
                <RefreshCw className="size-3.5" /> 重新检查
              </Button>
            </div>
          )}

          {phase === 'error' && (
            <div className="flex h-32 flex-col items-center justify-center gap-3">
              <p className="text-xs text-destructive">{error}</p>
              <Button size="sm" variant="outline" onClick={() => void run()}>
                <RefreshCw className="size-3.5" /> 重试
              </Button>
            </div>
          )}

          {phase === 'done' && (
            <div className="max-h-80 space-y-2 overflow-auto pr-1 scrollbar-thin">
              {suggestions.length === 0 ? (
                <div className="flex h-32 flex-col items-center justify-center gap-2 text-muted-foreground">
                  <Check className="size-6 text-primary" />
                  <p className="text-sm">未发现问题，简历表达很干净。</p>
                </div>
              ) : (
                suggestions.map((s, i) => {
                  const applied = appliedIds.has(i)
                  return (
                    <div
                      key={i}
                      className={
                        'rounded-md border p-3 transition-colors ' +
                        (applied ? 'border-primary/40 bg-primary/5 opacity-70' : 'bg-card')
                      }
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <p className="break-words text-xs">
                            <span className="rounded bg-destructive/10 px-1 py-0.5 font-mono text-destructive line-through decoration-destructive/40">
                              {s.original}
                            </span>
                            <span className="mx-1.5 text-muted-foreground">→</span>
                            <span className="rounded bg-primary/10 px-1 py-0.5 font-mono text-primary">
                              {s.suggestion}
                            </span>
                          </p>
                          <p className="text-[11px] leading-relaxed text-muted-foreground">
                            {s.reason}
                          </p>
                        </div>
                        {applied ? (
                          <span className="flex shrink-0 items-center gap-1 text-[11px] text-primary">
                            <Check className="size-3.5" /> 已应用
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 shrink-0 gap-1 text-xs"
                            onClick={() => applyOne(i, s)}
                          >
                            <Wand2 className="size-3" /> 应用
                          </Button>
                        )}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          )}
        </div>

        {phase === 'done' && suggestions.length > 0 && (
          <p className="text-right text-[11px] text-muted-foreground">
            共 {suggestions.length} 条建议 · 剩余 {pending.length} 条未应用
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
