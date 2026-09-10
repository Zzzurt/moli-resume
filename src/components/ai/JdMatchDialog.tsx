import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ScanSearch,
  RefreshCw,
  Wand2,
  AlertTriangle,
  CircleCheck,
  CircleCheckBig,
  Square,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useSettings } from '@/hooks/useSettings'
import {
  aiAssist,
  aiErrorMessage,
  isAbortedError,
  jdAnalyze,
  type JdReport,
  type JdSuggestion,
} from '@/lib/aiService'
import type { DocRange } from '@/components/editor/TiptapEditor'
import { cn } from '@/lib/utils'
import { AiProgress } from '@/components/ai/AiProgress'
import { DiffLines, lineParts } from '@/components/ai/DiffLines'

interface JdMatchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 当前简历全文（Markdown） */
  fullMarkdown: string
  /** 按原文锚点定位简历中的块（EditorPage：findRangeByText）；null = 定位失败 */
  onLocateBlock?: (text: string) => { range: DocRange; markdown: string } | null
  /** 把改写结果应用到简历对应位置（replaceRangeMarkdown + 闪烁定位） */
  onApplyRewrite?: (range: DocRange, polished: string) => void
}

type CardPhase = 'idle' | 'running' | 'diff' | 'applied'

interface CardState {
  phase: CardPhase
  before?: string
  after?: string
  live?: string
  range?: DocRange
  error?: string
}

/** 行内加粗渲染（**x** → strong） */
function renderInline(text: string, keyBase: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((p, i) =>
    p.startsWith('**') && p.endsWith('**') ? (
      <strong key={`${keyBase}-${i}`}>{p.slice(2, -2)}</strong>
    ) : (
      <span key={`${keyBase}-${i}`}>{p}</span>
    )
  )
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h4 className="mt-3 border-b border-border pb-1 text-[13px] font-bold text-primary first:mt-0">
      {children}
    </h4>
  )
}

/**
 * 改前 / 改后对照栏。
 * lineParts 是行级 LCS 差分，两栏结果完全相同——抽到同一个组件里算一次即可。
 * （原先两栏各调一次，在多张建议卡片同时处于 diff 态时开销成倍）
 */
function DiffPair({ before, after }: { before: string; after: string }) {
  const parts = useMemo(() => lineParts(before, after), [before, after])
  return (
    <>
      <div className="rounded border border-destructive/20 bg-destructive/5 p-1.5">
        <span className="text-[11px] font-medium text-destructive">改前</span>
        <DiffLines parts={parts} side="before" className="font-mono text-xs leading-relaxed" />
      </div>
      <div className="rounded border border-success/20 bg-success/5 p-1.5">
        <span className="text-[11px] font-medium text-success">改后</span>
        <DiffLines parts={parts} side="after" className="font-mono text-xs leading-relaxed" />
      </div>
    </>
  )
}

/**
 * JD 匹配分析：贴入职位描述，AI 对照简历全文输出结构化匹配报告。
 * 分析型能力——报告只读；改进建议支持**连续逐条改写**：卡片内 AI 改写（流式）→
 * diff 对照 → 应用到简历对应位置（闪烁定位），全程不关闭弹窗、不中断其余建议。
 */
export function JdMatchDialog({
  open,
  onOpenChange,
  fullMarkdown,
  onLocateBlock,
  onApplyRewrite,
}: JdMatchDialogProps) {
  const { settings } = useSettings()
  const [jd, setJd] = useState('')
  const [loading, setLoading] = useState(false)
  const [report, setReport] = useState<JdReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** 用户停止分析（区别于出错） */
  const [stopped, setStopped] = useState(false)
  /** 流式接收中的实时内容 */
  const [live, setLive] = useState<string | null>(null)
  /** 每条建议的改写状态（连续处理：应用一条后其余卡片保持可用） */
  const [cards, setCards] = useState<Record<number, CardState>>({})
  /** 当前分析的中止控制器（「停止」按钮触发 abort） */
  const abortRef = useRef<AbortController | null>(null)
  /** 各建议卡片改写请求的中止控制器（可同时改写多条） */
  const rewriteAborts = useRef(new Map<number, AbortController>())

  /** 中止全部在途请求：不中止的话流式请求会继续跑完，白耗额度并往已关闭的组件回写 state */
  const abortAll = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    rewriteAborts.current.forEach((ac) => ac.abort())
    rewriteAborts.current.clear()
  }, [])

  const run = async () => {
    if (!jd.trim()) return
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setLoading(true)
    setError(null)
    setStopped(false)
    setLive(null)
    setReport(null)
    setCards({})
    try {
      const r = await jdAnalyze(
        { baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel },
        fullMarkdown,
        jd,
        { onDelta: (partial) => setLive(partial), signal: ac.signal }
      )
      setReport(r)
    } catch (e) {
      if (isAbortedError(e)) {
        setStopped(true)
        setLive(null)
      } else {
        setError(aiErrorMessage(e))
      }
    } finally {
      if (abortRef.current === ac) abortRef.current = null
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!open) return
    setReport(null)
    setError(null)
    setStopped(false)
    setLive(null)
    setCards({})
    /* 保留上次输入的 JD，便于微调后重新分析 */
    // 关闭弹窗或卸载时中止在途请求
    return () => abortAll()
  }, [open, abortAll])

  // stopped 也算已运行：停止后停留在报告区展示「已停止分析」，而非退回输入态
  const hasRun = report !== null || loading || live !== null || stopped

  const rewrite = async (i: number, s: JdSuggestion) => {
    if (!onLocateBlock) return
    const loc = onLocateBlock(s.original)
    if (!loc) {
      toast.warning('未能在简历中定位该片段（可能内容已修改），建议重新运行 JD 匹配', { id: 'jd-locate' })
      return
    }
    setCards((c) => ({ ...c, [i]: { phase: 'running' } }))
    const ac = new AbortController()
    rewriteAborts.current.set(i, ac)
    try {
      const after = await aiAssist(
        { baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel },
        'ask',
        loc.markdown,
        s.instruction,
        {
          onDelta: (partial) => setCards((c) => ({ ...c, [i]: { phase: 'running', live: partial } })),
          signal: ac.signal,
        }
      )
      // 已中止（关闭了弹窗）：不把半成品写成 diff
      if (ac.signal.aborted) return
      setCards((c) => ({
        ...c,
        [i]: { phase: 'diff', before: loc.markdown, after, range: loc.range },
      }))
    } catch (e) {
      if (isAbortedError(e)) return
      setCards((c) => ({ ...c, [i]: { phase: 'diff', error: aiErrorMessage(e) } }))
    } finally {
      rewriteAborts.current.delete(i)
    }
  }

  const apply = (i: number, st: CardState) => {
    if (!st.range || !st.after) return
    onApplyRewrite?.(st.range, st.after)
    setCards((c) => ({ ...c, [i]: { phase: 'applied', after: st.after } }))
    toast.success('已应用到简历对应段落')
  }

  const appliedCount = Object.values(cards).filter((s) => s.phase === 'applied').length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto scrollbar-thin">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanSearch className="size-4 text-primary" />
            JD 匹配分析
          </DialogTitle>
          <DialogDescription>
            贴入职位描述，AI 对照简历全文给出匹配总评、缺失项与具体改进建议；建议可逐条一键改写（diff 确认后应用），全程无需关闭本报告。
          </DialogDescription>
        </DialogHeader>

        {!hasRun && (
          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              职位描述
            </div>
            <textarea
              value={jd}
              onChange={(e) => setJd(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && jd.trim()) {
                  e.preventDefault()
                  void run()
                }
              }}
              rows={7}
              data-testid="jd-input"
              placeholder="粘贴目标岗位的职位描述（JD）：岗位职责、任职要求、加分项……越完整分析越准"
              className="w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-xs leading-relaxed outline-none placeholder:text-muted-foreground focus-visible:border-ring"
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-muted-foreground">Ctrl+Enter 开始分析</span>
              <Button
                size="sm"
                className="h-7 gap-1 text-xs"
                data-testid="jd-run"
                disabled={!jd.trim()}
                onClick={() => void run()}
              >
                <ScanSearch className="size-3" /> 开始分析
              </Button>
            </div>
          </div>
        )}

        {hasRun && (
          <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-primary">
                匹配分析报告
              </span>
              {appliedCount > 0 && (
                <span className="text-[11px] text-muted-foreground">
                  已应用 {appliedCount}/{report?.suggestions.length ?? 0} 条建议
                </span>
              )}
            </div>
            {error ? (
              <div className="flex flex-col items-center gap-2 p-4 text-center">
                <p className="text-xs text-destructive">{error}</p>
                <Button size="sm" variant="outline" onClick={() => void run()}>
                  <RefreshCw className="size-3.5" /> 重试
                </Button>
              </div>
            ) : stopped ? (
              <div className="flex flex-col items-center gap-2 p-4 text-center">
                <p className="text-xs text-muted-foreground">已停止分析</p>
                <Button size="sm" variant="outline" onClick={() => void run()}>
                  <RefreshCw className="size-3.5" /> 重新分析
                </Button>
              </div>
            ) : loading ? (
              /* 连接阶段整块占位（此前是空白真空档）；流式开始后进度条转紧凑模式随内容滚动 */
              live ? (
                <div className="max-h-[52vh] overflow-auto pr-1 scrollbar-thin">
                  <AiProgress label="分析中…" chars={live.length} compact />
                  <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                    {live}
                  </p>
                  <div className="mt-2 flex justify-center">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => abortRef.current?.abort()}
                    >
                      <Square className="size-3.5" /> 停止
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <AiProgress label="正在对照职位描述通读简历…" />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => abortRef.current?.abort()}
                  >
                    <Square className="size-3.5" /> 停止
                  </Button>
                </div>
              )
            ) : report ? (
              <div className="max-h-[58vh] overflow-auto pr-1 scrollbar-thin">
                {/* 匹配总评 */}
                <SectionTitle>匹配总评</SectionTitle>
                <p className="mt-1.5 text-xs leading-relaxed">{renderInline(report.summary, 's')}</p>

                {/* 已覆盖 */}
                {report.covered.length > 0 && (
                  <>
                    <SectionTitle>
                      <CircleCheck className="mr-1 inline size-3.5 text-success" /> 已覆盖的要求
                    </SectionTitle>
                    <ul className="mt-1.5 flex flex-col gap-1">
                      {report.covered.map((c, i) => (
                        <li key={i} className="flex gap-2 text-xs leading-relaxed">
                          <CircleCheck className="mt-0.5 size-3 shrink-0 text-success" />
                          <span className="min-w-0">{renderInline(c, `c${i}`)}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                {/* 缺失薄弱 */}
                {report.gaps.length > 0 && (
                  <>
                    <SectionTitle>
                      <AlertTriangle className="mr-1 inline size-3.5 text-warning" /> 缺失或薄弱项
                    </SectionTitle>
                    <ul className="mt-1.5 flex flex-col gap-1">
                      {report.gaps.map((g, i) => (
                        <li key={i} className="flex gap-2 text-xs leading-relaxed">
                          <AlertTriangle className="mt-0.5 size-3 shrink-0 text-warning" />
                          <span className="min-w-0">
                            {renderInline(g.text, `g${i}`)}
                            {g.severity && (
                              <span
                                className={cn(
                                  'ml-1.5 inline-block rounded px-1 py-px text-[11px] align-middle',
                                  g.severity.includes('严重')
                                    ? 'bg-destructive/15 text-destructive'
                                    : 'bg-warning/15 text-warning'
                                )}
                              >
                                {g.severity}
                              </span>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                {/* 改进建议：卡片内连续改写（改写 → diff → 应用），互不阻塞 */}
                {report.suggestions.length > 0 && (
                  <>
                    <SectionTitle>
                      <Wand2 className="mr-1 inline size-3.5 text-primary" /> 改进建议
                    </SectionTitle>
                    <div className="mt-1.5 flex flex-col gap-2">
                      {report.suggestions.map((s, i) => {
                        const st = cards[i] ?? { phase: 'idle' as CardPhase }
                        return (
                          <div
                            key={i}
                            data-testid={`jd-suggestion-${i}`}
                            className={cn(
                              'rounded-md border bg-card p-2.5 transition-colors',
                              st.phase === 'applied' && 'border-success/40 bg-success/5'
                            )}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-[11px] text-muted-foreground">
                                {renderInline(s.reason, `r${i}`)}
                              </p>
                              {st.phase === 'applied' && (
                                <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-success">
                                  <CircleCheckBig className="size-3.5" /> 已应用
                                </span>
                              )}
                            </div>

                            {st.phase === 'idle' && (
                              <>
                                <p className="mt-1 rounded bg-muted/60 px-2 py-1 font-mono text-xs leading-relaxed">
                                  {s.original}
                                </p>
                                <p className="mt-1 text-xs leading-relaxed">
                                  <span className="font-medium text-primary">改写指令：</span>
                                  {renderInline(s.instruction, `i${i}`)}
                                </p>
                                {onApplyRewrite && onLocateBlock && (
                                  <div className="mt-1.5 flex justify-end">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-6 gap-1 px-2 text-[11px]"
                                      data-testid={`jd-apply-${i}`}
                                      onClick={() => void rewrite(i, s)}
                                    >
                                      <Wand2 className="size-3" /> AI 改写此段
                                    </Button>
                                  </div>
                                )}
                              </>
                            )}

                            {st.phase === 'running' && (
                              <div className="mt-1.5">
                                <AiProgress
                                  label="改写中…"
                                  chars={st.live ? st.live.length : undefined}
                                  compact
                                />
                                {st.live && (
                                  <pre className="mt-1.5 max-h-28 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/60 px-2 py-1 font-mono text-xs leading-relaxed scrollbar-thin">
                                    {st.live}
                                  </pre>
                                )}
                              </div>
                            )}

                            {st.phase === 'diff' && st.error && (
                              <p className="mt-1.5 text-xs text-destructive">{st.error}</p>
                            )}

                            {st.phase === 'diff' && !st.error && (
                              <div className="mt-1.5 space-y-1">
                                <DiffPair before={st.before ?? ''} after={st.after ?? ''} />
                                <div className="flex justify-end gap-1.5 pt-0.5">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-6 px-2 text-[11px]"
                                    onClick={() => setCards((c) => ({ ...c, [i]: { phase: 'idle' } }))}
                                  >
                                    <X className="size-3" /> 放弃
                                  </Button>
                                  <Button
                                    size="sm"
                                    className="h-6 px-2 text-[11px]"
                                    data-testid={`jd-confirm-${i}`}
                                    onClick={() => apply(i, st)}
                                  >
                                    应用到简历
                                  </Button>
                                </div>
                              </div>
                            )}

                            {st.phase === 'applied' && (
                              <p className="mt-1 text-xs leading-relaxed text-success">
                                {renderInline(s.instruction, `d${i}`)}
                              </p>
                            )}
                          </div>
                        )
                      })}
                    </div>
                    {appliedCount > 0 && appliedCount === report.suggestions.length && (
                      <p className="mt-2 rounded bg-success/10 px-2 py-1.5 text-center text-[11px] text-success">
                        全部建议已处理。可关闭报告，在简历中继续微调。
                      </p>
                    )}
                  </>
                )}
              </div>
            ) : null}
          </div>
        )}

        <div className={cn('flex justify-end gap-2', !hasRun && 'hidden')}>
          <Button
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => {
              setReport(null)
              setError(null)
              setLive(null)
              setCards({})
            }}
          >
            <RefreshCw className="size-3.5" /> 调整 JD 重新分析
          </Button>
          <Button size="sm" onClick={() => onOpenChange(false)}>
            完成
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}