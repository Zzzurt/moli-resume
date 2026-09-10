import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Sparkles, RefreshCw, Loader2, ArrowRight, Send, Square } from 'lucide-react'
import { AiProgress } from '@/components/ai/AiProgress'
import { lineParts, DiffLines } from '@/components/ai/DiffLines'
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
import {
  aiErrorMessage,
  aiAssist,
  aiModeTitle,
  isAbortedError,
  type AiMode,
} from '@/lib/aiService'
import { toast } from 'sonner'

interface PolishDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: AiMode
  original: string
  /** ask 模式打开时预填的处理指令（如从 JD 报告建议一键跳入） */
  initialInstruction?: string
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

/** AI 助手：润色 / 优化 / 精简 / 排版 / 提问，diff 对照（改动行高亮），确认后替换 */
export function PolishDialog({
  open,
  onOpenChange,
  mode,
  original,
  initialInstruction,
  onApply,
}: PolishDialogProps) {
  const { settings } = useSettings()
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [instruction, setInstruction] = useState('')
  /** 流式接收中的实时内容 */
  const [live, setLive] = useState<string | null>(null)
  /** 用户停止且无任何生成内容（有部分内容时直接作为结果展示） */
  const [stopped, setStopped] = useState(false)
  /** 当前生成的中止控制器（「停止」按钮触发 abort） */
  const abortRef = useRef<AbortController | null>(null)

  const run = useCallback(async () => {
    if (mode === 'ask' && !instruction.trim()) {
      setError('请先输入处理指令')
      return
    }
    const ac = new AbortController()
    abortRef.current = ac
    setLoading(true)
    setError(null)
    setStopped(false)
    setLive(null)
    try {
      const polished = await aiAssist(
        { baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel },
        mode,
        original,
        instruction,
        { onDelta: (partial) => setLive(partial), signal: ac.signal }
      )
      setResult(polished)
      // 中止时已生成的部分会作为结果返回：提示用户结果不完整
      if (ac.signal.aborted) toast.info('已停止生成，保留已生成的部分')
    } catch (e) {
      if (isAbortedError(e)) setStopped(true)
      else setError(aiErrorMessage(e))
    } finally {
      abortRef.current = null
      setLoading(false)
    }
  }, [mode, original, instruction, settings])

  /** 停止当前生成 */
  const stop = () => abortRef.current?.abort()

  useEffect(() => {
    if (open) {
      setResult(null)
      setError(null)
      setStopped(false)
      setInstruction(mode === 'ask' ? (initialInstruction ?? '') : '')
      setLive(null)
      // 提问模式不自动执行（等用户确认/修改指令），其余模式自动跑
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
              {parts && <span className="font-normal normal-case text-[11px]">（红 = 移除/改前）</span>}
            </div>
            {parts ? (
              <DiffLines
                parts={parts}
                side="before"
                className="max-h-64 overflow-auto font-mono text-xs leading-relaxed scrollbar-thin"
              />
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
                <span className="font-normal normal-case text-[11px] text-success">
                  （绿 = 新增/改后）
                </span>
              )}
            </div>
            {loading ? (
              <>
                <AiProgress
                  label={live ? '生成中…' : '正在连接模型…'}
                  chars={live ? live.length : undefined}
                  compact
                />
                {live ? (
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed scrollbar-thin">
                    {live}
                  </pre>
                ) : (
                  <div className="flex h-24 items-center justify-center text-center text-xs leading-relaxed text-muted-foreground">
                    正在把简历片段与指令发给模型
                    <br />
                    首字生成通常需要几秒，请稍候
                  </div>
                )}
              </>
            ) : error ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
                <p className="text-xs text-destructive">{error}</p>
                <Button size="sm" variant="outline" onClick={() => void run()}>
                  <RefreshCw className="size-3.5" /> 重试
                </Button>
              </div>
            ) : stopped ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
                <p className="text-xs text-muted-foreground">已停止生成</p>
                <Button size="sm" variant="outline" onClick={() => void run()}>
                  <RefreshCw className="size-3.5" /> 重新生成
                </Button>
              </div>
            ) : parts ? (
              <DiffLines
                parts={parts}
                side="after"
                className="max-h-64 overflow-auto font-mono text-xs leading-relaxed scrollbar-thin"
              />
            ) : null}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          {loading && (
            <Button variant="outline" onClick={stop}>
              <Square className="size-3.5" /> 停止
            </Button>
          )}
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