import { useCallback, useEffect, useMemo, useState } from 'react'
import { diffLines } from 'diff'
import { Sparkles, RefreshCw, Loader2, ArrowRight, Send } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useSettings } from '@/hooks/useSettings'
import { aiErrorMessage, aiAssist, aiModeTitle, type AiMode } from '@/lib/aiService'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface PolishDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: AiMode
  original: string
  /** 确认应用：用处理结果替换原选区 */
  onApply: (polished: string) => void
}

const MODE_DESCRIPTIONS: Record<AiMode, string> = {
  polish: '在保持 Markdown 结构与原意不变的前提下润色表达，确认后替换选中内容。',
  optimize: '强化量化成果、修正语病，条目可增删合并，确认后替换选中内容。',
  condense: '压缩篇幅至 50%~70%，保留关键信息，确认后替换选中内容。',
  layout: '规范标题层级与条目格式、重点前置，确认后替换选中内容。',
  ask: '输入任意指令（如“翻译成英文”“改写成 STAR 结构”），AI 按指令处理选中内容。',
}

/* ---------- 行级 diff 渲染 ---------- */

interface DiffPart {
  text: string
  type: 'same' | 'added' | 'removed'
}

function lineParts(a: string, b: string): DiffPart[] {
  return diffLines(a, b).map((p) => ({
    text: p.value,
    type: p.added ? 'added' : p.removed ? 'removed' : 'same',
  }))
}

/** diff 分行渲染：added/removed 行加背景标注（空行占位保持行结构） */
function DiffLines({
  parts,
  side,
}: {
  parts: DiffPart[]
  side: 'before' | 'after'
}) {
  const lines: { text: string; type: DiffPart['type'] }[] = []
  for (const part of parts) {
    if (side === 'after' && part.type === 'removed') continue
    if (side === 'before' && part.type === 'added') continue
    // 保留尾部换行信息：按 \n 拆行后末段为空说明整段以换行结尾
    const segs = part.text.split('\n')
    segs.forEach((text, i) => {
      if (i === segs.length - 1 && text === '' && segs.length > 1) return // 尾部换行
      lines.push({ text: text || ' ', type: part.type })
    })
  }
  return (
    <div className="max-h-64 overflow-auto font-mono text-xs leading-relaxed scrollbar-thin">
      {lines.map((l, i) => (
        <div
          key={i}
          className={cn(
            '-mx-3 whitespace-pre-wrap break-words px-3',
            l.type === 'added' && 'bg-emerald-500/15 text-emerald-900 dark:text-emerald-200',
            l.type === 'removed' && 'bg-red-500/10 text-red-900/70 line-through decoration-red-400/60 dark:text-red-200/70'
          )}
        >
          {l.text}
        </div>
      ))}
    </div>
  )
}

/** AI 助手：润色 / 优化 / 精简 / 排版 / 提问，diff 对照（改动行高亮），确认后替换 */
export function PolishDialog({ open, onOpenChange, mode, original, onApply }: PolishDialogProps) {
  const { settings } = useSettings()
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [instruction, setInstruction] = useState('')
  /** 流式接收中的实时内容 */
  const [live, setLive] = useState<string | null>(null)

  const run = useCallback(async () => {
    if (mode === 'ask' && !instruction.trim()) {
      setError('请先输入处理指令')
      return
    }
    setLoading(true)
    setError(null)
    setLive(null)
    try {
      const polished = await aiAssist(
        { baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel },
        mode,
        original,
        instruction,
        { onDelta: (partial) => setLive(partial) }
      )
      setResult(polished)
    } catch (e) {
      setError(aiErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [mode, original, instruction, settings])

  useEffect(() => {
    if (open) {
      setResult(null)
      setError(null)
      setInstruction('')
      setLive(null)
      // 提问模式不自动执行（等用户输入指令），其余模式自动跑
      if (mode !== 'ask') void run()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const canApply = !!result && !loading
  const hasRun = result !== null || loading || live !== null

  const parts = useMemo(
    () => (result ? lineParts(original, result) : null),
    [original, result]
  )

  /** 提问模式：Enter 发送（Shift+Enter 换行），Ctrl+Enter 也可 */
  const handleInstructionKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || loading) return
    if (e.ctrlKey || e.metaKey || !e.shiftKey) {
      e.preventDefault()
      if (instruction.trim()) void run()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            AI {aiModeTitle(mode)}
          </DialogTitle>
          <DialogDescription>{MODE_DESCRIPTIONS[mode]}</DialogDescription>
        </DialogHeader>

        {mode === 'ask' && (
          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              处理指令
            </div>
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={handleInstructionKey}
              rows={2}
              placeholder="例如：把这段经历改写成 STAR 结构 / 翻译成英文 / 面向产品经理岗位改写"
              className="w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-xs leading-relaxed outline-none placeholder:text-muted-foreground focus-visible:border-ring"
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-muted-foreground">Enter 发送 · Shift+Enter 换行</span>
              <Button
                size="sm"
                className="h-7 gap-1 text-xs"
                data-testid="ask-send"
                disabled={loading || !instruction.trim()}
                onClick={() => void run()}
              >
                {loading ? (
                  <>
                    <Loader2 className="size-3 animate-spin" /> 处理中…
                  </>
                ) : (
                  <>
                    <Send className="size-3" /> {hasRun ? '重新执行' : '执行'}
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        <div className="grid gap-3 overflow-hidden sm:grid-cols-2">
          <div className="min-h-0 rounded-md border bg-muted/40 p-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              原文
              {parts && <span className="font-normal normal-case text-[10px]">（红 = 移除/改前）</span>}
            </div>
            {parts ? (
              <DiffLines parts={parts} side="before" />
            ) : (
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed scrollbar-thin">
                {original}
              </pre>
            )}
          </div>
          <div className="min-h-0 rounded-md border border-primary/30 bg-primary/5 p-3">
            <div className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-primary">
              {aiModeTitle(mode)}后
              {result && <ArrowRight className="size-3" />}
              {parts && (
                <span className="font-normal normal-case text-[10px] text-emerald-600 dark:text-emerald-400">
                  （绿 = 新增/改后）
                </span>
              )}
            </div>
            {loading ? (
              live ? (
                <>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed scrollbar-thin">
                    {live}
                  </pre>
                  <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Loader2 className="size-3 animate-spin" /> 生成中…
                  </div>
                </>
              ) : (
                <div className="flex h-24 items-center justify-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> 正在连接模型…
                </div>
              )
            ) : error ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
                <p className="text-xs text-destructive">{error}</p>
                <Button size="sm" variant="outline" onClick={() => void run()}>
                  <RefreshCw className="size-3.5" /> 重试
                </Button>
              </div>
            ) : parts ? (
              <DiffLines parts={parts} side="after" />
            ) : null}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          {mode !== 'ask' && (
            <Button
              variant="outline"
              disabled={loading}
              onClick={() => {
                setResult(null)
                setError(null)
                void run()
              }}
            >
              <RefreshCw className="size-3.5" /> 重新生成
            </Button>
          )}
          <Button
            disabled={!canApply}
            onClick={() => {
              if (result) {
                onApply(result)
                onOpenChange(false)
                toast.success(`已应用${aiModeTitle(mode)}结果`)
              }
            }}
          >
            应用替换
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}