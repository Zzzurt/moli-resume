import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft } from 'lucide-react'
import { getResume, updateResume, addSnapshot } from '@/lib/db'
import type { ResumeSnapshot } from '@/lib/db'
import { isTiptapDoc } from '@/lib/docUtils'
import { docToMarkdown } from '@/lib/editorSetup'
import { exportPaperToPdf, exportPaperToPng } from '@/lib/pdf'
import { downloadFile, pickTextFile, titleFromFilename } from '@/lib/fileIO'
import { TiptapEditor, type EditorHandle, type DocRange } from '@/components/editor/TiptapEditor'
import { Preview } from '@/components/preview/Preview'
import { Resizer } from '@/components/layout/Resizer'
import { AppHeader } from '@/components/layout/AppHeader'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { PolishDialog } from '@/components/ai/PolishDialog'
import { GrammarDialog } from '@/components/ai/GrammarDialog'
import { JdMatchDialog } from '@/components/ai/JdMatchDialog'
import { HistoryVersionsDialog } from '@/components/editor/HistoryVersionsDialog'
import { ShortcutsDialog } from '@/components/editor/ShortcutsDialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useSettings } from '@/hooks/useSettings'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import type { AiMode } from '@/lib/aiService'
import type { TemplateId } from '@/types'
import { toast } from 'sonner'

export function EditorPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const resumeId = Number(id)
  const { settings, loaded, update: updateSetting } = useSettings()

  const resume = useLiveQuery(() => getResume(resumeId), [resumeId])

  const [title, setTitle] = useState('')
  const [template, setTemplate] = useState<TemplateId>('minimal')
  const [photo, setPhoto] = useState<string | undefined>(undefined)
  const [photoScale, setPhotoScale] = useState(1)
  const [photoPos, setPhotoPos] = useState({ dx: 0, dy: 0 })
  const [initialContent, setInitialContent] = useState<string | null>(null)
  const [docJson, setDocJson] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [checking, setChecking] = useState(false)
  /** 自动保存失败重试计数：变化触发保存 effect 重跑 */
  const [saveRetry, setSaveRetry] = useState(0)
  const [grammarMd, setGrammarMd] = useState('')
  const [polishOriginal, setPolishOriginal] = useState<string | null>(null)
  /** ask 模式预填指令（JD 报告建议一键跳入） */
  const [askInstruction, setAskInstruction] = useState<string>('')
  /** 润色对应的文档范围（选区对齐到顶层块），应用替换时定位 */
  const [polishRange, setPolishRange] = useState<DocRange | null>(null)
  /** 历史 / 快捷键弹窗 */
  const [historyOpen, setHistoryOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  /** JD 匹配弹窗（分析时快照当前简历全文） */
  const [jdMatchOpen, setJdMatchOpen] = useState(false)
  const [jdMarkdown, setJdMarkdown] = useState('')
  /** 页面度量（Preview 上报）：状态栏页数 + 导出超页检测 */
  const [pageMetrics, setPageMetrics] = useState<{
    pageCount: number
    density: number
    smartOnePage: boolean
  }>({ pageCount: 1, density: 0, smartOnePage: true })
  const pageMetricsRef = useRef(pageMetrics)
  /** 导出超页确认弹窗 */
  const [exportPageConfirm, setExportPageConfirm] = useState(false)
  /** 当前 AI 助手模式 */
  const [aiMode, setAiMode] = useState<AiMode>('polish')
  const [grammarOpen, setGrammarOpen] = useState(false)
  /** 待确认导入的 Markdown 文件（弹窗确认后应用） */
  const [pendingImport, setPendingImport] = useState<{ name: string; text: string } | null>(null)

  const editorHandleRef = useRef<EditorHandle | null>(null)
  const paperRef = useRef<HTMLDivElement>(null)
  /** 已完成初始化的 resumeId：防止同文档切换简历（组件复用）时旧状态残留、自动保存覆盖新简历 */
  const initializedFor = useRef<number | null>(null)
  const savedRef = useRef({ doc: '', title: '' })
  const latest = useRef({ docJson: '', title: '' })
  /** 自动保存失败后的重试定时器 */
  const saveRetryTimer = useRef<number | undefined>(undefined)
  /** 分栏落库防抖 */
  const ratioSaveTimer = useRef<number | undefined>(undefined)
  /** 上次快照时间（自动快照间隔控制） */
  const lastSnapAt = useRef(0)

  /* ---------- 加载（resumeId 变化即重新初始化，见 initializedFor 注释） ---------- */
  useEffect(() => {
    if (resume && initializedFor.current !== resumeId) {
      initializedFor.current = resumeId
      setTitle(resume.title)
      setTemplate(resume.template)
      setPhoto(resume.photo)
      setPhotoScale(resume.photoScale ?? 1)
      setPhotoPos(resume.photoPos ?? { dx: 0, dy: 0 })
      savedRef.current = { doc: resume.content, title: resume.title }
      setInitialContent(resume.content)
      // 打开简历即存一份历史快照（版本历史入口）
      void addSnapshot({ resumeId, title: resume.title, content: resume.content, template: resume.template })
        .then(() => {
          lastSnapAt.current = Date.now()
        })
        .catch(() => {})
    }
  }, [resume, resumeId])

  /* 文档不存在检测 */
  useEffect(() => {
    if (Number.isNaN(resumeId)) return
    let cancelled = false
    void getResume(resumeId).then((r) => {
      if (!cancelled && !r) setMissing(true)
    })
    return () => {
      cancelled = true
    }
  }, [resumeId])

  /* ---------- 编辑器初始化（含旧 Markdown → JSON 迁移） ---------- */
  const handleInit = useCallback(
    (json: string) => {
      setDocJson(json)
      savedRef.current.doc = json
      const raw = initialContent ?? ''
      if (!isTiptapDoc(raw)) {
        // 旧版 Markdown 数据：立即迁移落库（失败不打断编辑，后续改动仍会以 JSON 保存）
        void updateResume(resumeId, { content: json }).catch(() => {})
      }
    },
    [initialContent, resumeId]
  )

  /* ---------- 自动保存（内容/标题防抖） ---------- */
  const handleDocChange = useCallback((json: string) => {
    setDocJson(json)
  }, [])

  const handleTitleChange = (t: string) => {
    setTitle(t)
  }

  /* latest 快照：放在 effect 中维护，避免渲染期间改 ref（卸载 flush 读取） */
  useEffect(() => {
    latest.current = { docJson: docJson ?? '', title }
  })

  const debouncedDoc = useDebouncedValue(docJson ?? '', 700)
  const debouncedTitle = useDebouncedValue(title, 700)
  const docReady = docJson !== null
  // 空标题落库为「未命名简历」，比较时同样归一化，避免空标题下状态栏永远停在"待保存"
  const effectiveTitle = debouncedTitle.trim() || '未命名简历'
  const pending =
    docReady && (debouncedDoc !== savedRef.current.doc || effectiveTitle !== savedRef.current.title)
  const saveState = saving ? 'saving' : pending ? 'dirty' : 'saved'

  useEffect(() => {
    /* initializedFor 门控：切换简历后、新内容初始化完成前，禁止用旧文档覆盖新简历 */
    if (initializedFor.current !== resumeId || !docReady || !pending || Number.isNaN(resumeId)) return
    let cancelled = false
    setSaving(true)
    void updateResume(resumeId, { content: debouncedDoc, title: effectiveTitle })
      .then(() => {
        if (cancelled) return
        savedRef.current = { doc: debouncedDoc, title: effectiveTitle }
        setSaving(false)
        window.clearTimeout(saveRetryTimer.current)
        // 自动保存成功后间隔 >10 分钟存一份历史快照（失败不打断保存流程）
        if (Date.now() - lastSnapAt.current > 10 * 60 * 1000) {
          lastSnapAt.current = Date.now()
          void addSnapshot({
            resumeId,
            title: effectiveTitle,
            content: debouncedDoc,
            template,
          }).catch(() => {})
        }
      })
      .catch(() => {
        // 保存失败：保持 dirty，8 秒后自动重试；固定 id 的 toast 避免连续弹窗堆积
        if (cancelled) return
        setSaving(false)
        toast.error('自动保存失败，将自动重试（请检查浏览器存储空间）', { id: 'autosave-failed' })
        window.clearTimeout(saveRetryTimer.current)
        saveRetryTimer.current = window.setTimeout(() => setSaveRetry((t) => t + 1), 8000)
      })
    return () => {
      cancelled = true
    }
  }, [debouncedDoc, debouncedTitle, docReady, pending, resumeId, effectiveTitle, saveRetry, template])

  /* 卸载/切换简历时 flush 未保存内容 */
  useEffect(() => {
    return () => {
      window.clearTimeout(saveRetryTimer.current)
      const { docJson, title } = latest.current
      const nextTitle = title.trim() || '未命名简历'
      if (docJson && (docJson !== savedRef.current.doc || nextTitle !== savedRef.current.title)) {
        void updateResume(resumeId, { content: docJson, title: nextTitle }).catch(() => {
          toast.error('离开前保存失败，最近的修改可能未保存', { id: 'autosave-failed' })
        })
      }
    }
  }, [resumeId])

  /* ---------- 模板切换：仅改样式不动数据 ---------- */
  const handleTemplateChange = (t: TemplateId) => {
    setTemplate(t)
    if (!Number.isNaN(resumeId)) void updateResume(resumeId, { template: t })
  }

  /* ---------- 历史版本恢复：先快照当前状态，再应用所选快照 ---------- */
  const handleRestoreSnapshot = useCallback(
    (snapshot: ResumeSnapshot) => {
      const { docJson: currentDoc } = latest.current
      if (currentDoc) {
        void addSnapshot({
          resumeId,
          title: title.trim() || '未命名简历',
          content: currentDoc,
          template,
        }).catch(() => {})
      }
      editorHandleRef.current?.setDocJson(snapshot.content)
      if (snapshot.template !== template) handleTemplateChange(snapshot.template)
      // 恢复后的内容立即落库（不等防抖）
      void updateResume(resumeId, { content: snapshot.content }).catch(() => {})
      savedRef.current = { doc: snapshot.content, title: savedRef.current.title }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resumeId, template, title]
  )

  /* ---------- 预览 → 编辑器块定位 ---------- */
  const handleLineClick = useCallback((index: number) => {
    editorHandleRef.current?.scrollToBlock(index)
  }, [])

  /* ---------- AI 助手（润色/优化/精简/排版/提问） ---------- */
  const requestAi = (mode: AiMode) => {
    const sel = editorHandleRef.current?.getSelectionBlockMarkdown()
    if (!sel) {
      toast.warning('请先选中要处理的文本')
      return
    }
    setAiMode(mode)
    setPolishOriginal(sel.markdown)
    setPolishRange(sel.range)
  }

  const applyPolish = (polished: string) => {
    if (polishRange) editorHandleRef.current?.replaceRangeMarkdown(polishRange, polished)
    setPolishOriginal(null)
    setPolishRange(null)
  }

  /* ---------- 语法检查 ---------- */
  const openGrammarCheck = () => {
    if (!settings.aiApiKey.trim()) {
      toast.warning('请先在设置中填写 API Key')
      return
    }
    const md = editorHandleRef.current?.getMarkdown() ?? ''
    if (!md.trim()) {
      toast.warning('简历内容为空')
      return
    }
    setGrammarMd(md)
    setGrammarOpen(true)
    setChecking(true)
  }

  /* ---------- PDF / 长图导出 ---------- */
  const doExportPdf = async () => {
    const paper = paperRef.current
    if (!paper) return
    setExporting(true)
    try {
      await exportPaperToPdf(paper, title.trim() || '简历')
      toast.success('PDF 已导出')
    } catch (e) {
      toast.error(`导出失败：${e instanceof Error ? e.message : '未知错误'}`)
    } finally {
      setExporting(false)
    }
  }

  const handleExportPdf = () => {
    const m = pageMetricsRef.current
    /* 超页且智能一页未开启：主动提示（单页/已开启不打扰） */
    if (m.pageCount > 1 && !m.smartOnePage) {
      setExportPageConfirm(true)
      return
    }
    void doExportPdf()
  }

  /** 开启智能一页 → 等测量收敛（换档+重渲染）→ 导出 */
  const enableOnePageAndExport = async () => {
    setExportPageConfirm(false)
    updateSetting('smartOnePage', true)
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 200))
      if (pageMetricsRef.current.pageCount <= 1) break
    }
    await doExportPdf()
  }

  const handleExportPng = async () => {
    const paper = paperRef.current
    if (!paper) return
    setExporting(true)
    try {
      await exportPaperToPng(paper, `${title.trim() || '简历'}-长图`)
      toast.success('长图 PNG 已导出')
    } catch (e) {
      toast.error(`导出失败：${e instanceof Error ? e.message : '未知错误'}`)
    } finally {
      setExporting(false)
    }
  }

  /* ---------- .md 导入导出 ---------- */
  const handleExportMd = () => {
    const md = editorHandleRef.current?.getMarkdown() ?? ''
    downloadFile(md, `${title.trim() || 'resume'}.md`, 'text/markdown')
    toast.success('Markdown 已导出')
  }

  const handleImportMd = async () => {
    const picked = await pickTextFile('.md,.markdown,.txt')
    if (!picked) return
    setPendingImport(picked)
  }

  const confirmImportMd = () => {
    if (!pendingImport) return
    editorHandleRef.current?.setDocFromMarkdown(pendingImport.text)
    if (!title.trim()) setTitle(titleFromFilename(pendingImport.name))
    toast.success('已导入 Markdown 内容')
    setPendingImport(null)
  }

  /* ---------- 证件照 ---------- */
  const handlePhotoChange = useCallback(
    (p: string | undefined) => {
      setPhoto(p)
      // 换新照片时重置旧的移动/缩放，避免旧比例套在新图上
      setPhotoScale(1)
      setPhotoPos({ dx: 0, dy: 0 })
      void updateResume(resumeId, { photo: p, photoScale: 1, photoPos: { dx: 0, dy: 0 } })
    },
    [resumeId]
  )

  const handlePhotoScaleChange = useCallback(
    (s: number) => {
      setPhotoScale(s)
      void updateResume(resumeId, { photoScale: s })
    },
    [resumeId]
  )

  const handlePhotoPosChange = useCallback(
    (p: { dx: number; dy: number }) => {
      setPhotoPos(p)
      void updateResume(resumeId, { photoPos: p })
    },
    [resumeId]
  )

  /* ---------- 分栏 ---------- */
  const [editorRatio, setEditorRatio] = useState(settings.splitRatio || 0.42)
  useEffect(() => {
    // 设置为异步加载：仅在 loaded 翻转时应用一次用户保存的比例，拖动过程由 onResize 接管
    if (!loaded) return
    setEditorRatio(settings.splitRatio || 0.42)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded])
  const handleResize = useCallback(
    (r: number) => {
      setEditorRatio(r)
      // 拖动全程高频回调，落库防抖
      window.clearTimeout(ratioSaveTimer.current)
      ratioSaveTimer.current = window.setTimeout(() => updateSetting('splitRatio', r), 400)
    },
    [updateSetting]
  )

  if (Number.isNaN(resumeId) || missing) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        <p>{missing ? '该简历不存在或已被删除' : '无效的简历 ID'}</p>
        <Button variant="outline" size="sm" onClick={() => navigate('/')}>
          <ArrowLeft className="size-3.5" /> 返回列表
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <AppHeader
        title={title}
        onTitleChange={handleTitleChange}
        template={template}
        onTemplateChange={handleTemplateChange}
        onExportPdf={handleExportPdf}
        onExportPng={() => void handleExportPng()}
        onExportMd={handleExportMd}
        onImportMd={() => void handleImportMd()}
        exporting={exporting}
        smartOnePage={settings.smartOnePage}
        onSmartOnePageChange={(on) => updateSetting('smartOnePage', on)}
        content={debouncedDoc}
        accentColor={settings.accentColor}
        onHistory={() => setHistoryOpen(true)}
        onShortcuts={() => setShortcutsOpen(true)}
      />

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0" style={{ width: `${editorRatio * 100}%` }}>
          {initialContent !== null && (
            <TiptapEditor
              key={resumeId /* 切换简历时强制重建编辑器：新内容 + 重置撤销历史 */}
              ref={editorHandleRef}
              initialContent={initialContent}
              template={template}
              saveState={saveState}
              checking={checking}
              onInit={handleInit}
              onDocChange={handleDocChange}
              onAiRequest={requestAi}
              onGrammarCheck={openGrammarCheck}
              onJdMatch={() => {
                /* 编辑器实例可能尚未就绪（reload 后异步初始化），兜底用最新 docJson 序列化 */
                let md = editorHandleRef.current?.getMarkdown() ?? ''
                if (!md.trim() && latest.current.docJson) {
                  try {
                    md = docToMarkdown(JSON.parse(latest.current.docJson))
                  } catch {
                    md = ''
                  }
                }
                if (!md.trim()) {
                  toast.warning('简历内容尚未加载完成，请稍后再试')
                  return
                }
                setJdMarkdown(md)
                setJdMatchOpen(true)
              }}
              pageMetrics={pageMetrics}
              accentColor={settings.accentColor}
            />
          )}
        </div>

        <Resizer ratio={editorRatio} onResize={handleResize} />

        <div className="min-w-0 flex-1 py-6">
          <Preview
            content={docJson ?? ''}
            template={template}
            photo={photo}
            photoScale={photoScale}
            photoPos={photoPos}
            onPhotoChange={handlePhotoChange}
            onPhotoScaleChange={handlePhotoScaleChange}
            onPhotoPosChange={handlePhotoPosChange}
            paperRef={paperRef}
            onLineClick={handleLineClick}
            smartOnePage={settings.smartOnePage}
            accentColor={settings.accentColor}
            onMetrics={(m) => {
              pageMetricsRef.current = m
              setPageMetrics(m)
            }}
          />
        </div>
      </div>

      <PolishDialog
        open={polishOriginal !== null}
        onOpenChange={(open) => !open && setPolishOriginal(null)}
        mode={aiMode}
        original={polishOriginal ?? ''}
        initialInstruction={askInstruction}
        onApply={(polished) => {
          applyPolish(polished)
          setAskInstruction('')
        }}
      />

      <JdMatchDialog
        open={jdMatchOpen}
        onOpenChange={setJdMatchOpen}
        fullMarkdown={jdMarkdown}
        onLocateBlock={(text) => editorHandleRef.current?.findRangeByText(text) ?? null}
        onApplyRewrite={(range, polished) => editorHandleRef.current?.replaceRangeMarkdown(range, polished)}
      />

      <GrammarDialog
        open={grammarOpen}
        onOpenChange={(open) => {
          setGrammarOpen(open)
          if (!open) setChecking(false)
        }}
        markdown={grammarMd}
        onApply={(md) => editorHandleRef.current?.setDocFromMarkdown(md)}
      />

      <HistoryVersionsDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        resumeId={resumeId}
        onRestore={handleRestoreSnapshot}
      />

      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />

      {/* 导出超页确认：主动提示智能一页，而不是默默导出多页 */}
      <Dialog open={exportPageConfirm} onOpenChange={setExportPageConfirm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>内容超过一页</DialogTitle>
            <DialogDescription>
              当前简历共 {pageMetricsRef.current.pageCount} 页。开启「智能一页」可自动收紧排版并压缩至恰好一页（字号不变，密度微调）。
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Button size="sm" data-testid="export-enable-onepage" onClick={() => void enableOnePageAndExport()}>
              开启智能一页并导出
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setExportPageConfirm(false); void doExportPdf() }}>
              仍按多页导出
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setExportPageConfirm(false)}>
              取消
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={pendingImport !== null}
        onOpenChange={(open) => !open && setPendingImport(null)}
        title="导入并覆盖当前内容？"
        description={`将用「${pendingImport?.name ?? ''}」的内容覆盖当前简历，此操作不可撤销。`}
        confirmText="导入"
        destructive
        onConfirm={confirmImportMd}
      />
    </div>
  )
}
