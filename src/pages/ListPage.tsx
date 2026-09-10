import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  Plus,
  FileUp,
  MoreVertical,
  Pencil,
  Copy,
  Trash2,
  Sun,
  Moon,
  Settings,
  Feather,
  Search,
  X,
  ArrowDownWideNarrow,
  Undo2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useSettings } from '@/hooks/useSettings'
import { SettingsDialog } from '@/components/settings/SettingsDialog'
import { CreateResumeDialog } from '@/components/list/CreateResumeDialog'
import {
  createResume,
  deleteResume,
  duplicateResume,
  listResumes,
  restoreResume,
  updateResume,
} from '@/lib/db'
import { pickTextFile, titleFromFilename } from '@/lib/fileIO'
import { DEFAULT_RESUME_CONTENT, DEFAULT_RESUME_TITLE } from '@/lib/defaultResume'
import { docFirstLine } from '@/lib/docUtils'
import { TEMPLATES, type Resume } from '@/types'
import { ResumeThumb } from '@/components/ResumeThumb'
import { cn, timeAgo } from '@/lib/utils'
import { toast } from 'sonner'

/** 列表排序方式 */
type SortKey = 'updated' | 'created' | 'title'

const SORT_OPTIONS: { id: SortKey; label: string }[] = [
  { id: 'updated', label: '最近编辑' },
  { id: 'created', label: '创建时间' },
  { id: 'title', label: '标题' },
]

/** 简历卡片：顶部为文档实时缩略（与模板面板同一渲染管线），下方标题与元信息。
    独立子组件以持有各自 hooks（parseDoc 缓存、缩略图 ResizeObserver） */
function ResumeCard({
  resume,
  onOpen,
  onRename,
  onDuplicate,
  onDelete,
}: {
  resume: Resume
  onOpen: () => void
  onRename: () => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  const tpl = TEMPLATES.find((t) => t.id === resume.template)
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      className="group relative flex cursor-pointer flex-col overflow-hidden rounded-lg border bg-card text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {/* 文档实时缩略图（按内容与模板渲染；hover 时不放大缩放，避免整卡重排） */}
      <div className="relative border-b bg-muted/30">
        <ResumeThumb
          template={resume.template}
          content={resume.content}
          emptyHint="空白简历"
        />
        <span className="absolute left-2 top-2 rounded bg-black/50 px-1.5 py-0.5 text-[11px] font-medium text-white opacity-0 backdrop-blur transition-opacity group-hover:opacity-100">
          {tpl?.name ?? '简约'}
        </span>
      </div>

      <div className="flex flex-1 flex-col p-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-1 text-sm font-semibold">{resume.title}</h3>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label="文档操作"
                className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreVertical className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem onClick={onRename}>
                <Pencil className="size-4" /> 重命名
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onDuplicate}>
                <Copy className="size-4" /> 创建副本
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onDelete}>
                <Trash2 className="size-4" /> 删除
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* 元信息：模板 · 编辑时间；文档首行换行占满一行，避免与左侧挤在一起被截断 */}
        <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex shrink-0 items-center gap-1.5">
            <span className={cn('size-2 rounded-[3px]', tpl?.dotClass ?? 'bg-gray-300')} />
            {tpl?.name ?? '简约'}
          </span>
          <span className="shrink-0">编辑于 {timeAgo(resume.updatedAt)}</span>
        </div>
        <p className="mt-1 line-clamp-1 text-xs text-muted-foreground/80">
          {docFirstLine(resume.content) ?? '（空白文档）'}
        </p>
      </div>
    </div>
  )
}

/** 卡片骨架屏：与 ResumeCard 同构（A4 缩略 + 标题 + 元信息），加载期给出布局预期 */
function CardSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
      <div className="aspect-[210/297] w-full animate-pulse border-b bg-muted/60" />
      <div className="space-y-2 p-3">
        <div className="h-3.5 w-2/3 animate-pulse rounded bg-muted" />
        <div className="h-2.5 w-1/3 animate-pulse rounded bg-muted" />
        <div className="h-2.5 w-5/6 animate-pulse rounded bg-muted" />
      </div>
    </div>
  )
}

export function ListPage() {
  const navigate = useNavigate()
  const { theme, toggleTheme } = useSettings()
  const [settingsOpen, setSettingsOpen] = useState(false)
  /** 新建简历对话框（空白 / 选模板） */
  const [createOpen, setCreateOpen] = useState(false)
  const [renaming, setRenaming] = useState<Resume | null>(null)
  const [renameValue, setRenameValue] = useState('')
  /** 待确认删除的简历（弹窗确认后执行） */
  const [deleting, setDeleting] = useState<Resume | null>(null)
  /** 搜索关键字（标题 + 文档首行）与排序方式 */
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('updated')

  const resumes = useLiveQuery(() => listResumes(), [])

  const handleCreate = async () => {
    const id = await createResume({ title: DEFAULT_RESUME_TITLE, content: DEFAULT_RESUME_CONTENT })
    navigate(`/resume/${id}`)
  }

  /** 新建对话框创建成功 → 跳编辑器 */
  const handleCreated = (id: number) => {
    navigate(`/resume/${id}`)
  }

  const handleImport = async () => {
    const picked = await pickTextFile('.md,.markdown,.txt')
    if (!picked) return
    try {
      const title = titleFromFilename(picked.name)
      const id = await createResume({ title, content: picked.text })
      toast.success('已导入并创建新简历')
      navigate(`/resume/${id}`)
    } catch (e) {
      toast.error(`导入失败：${e instanceof Error ? e.message : '未知错误'}`)
    }
  }

  const handleDuplicate = async (id: number) => {
    const newId = await duplicateResume(id)
    if (newId) toast.success('已创建副本')
  }

  /** 删除：先留档再删，toast 内提供「撤销」（保留原 id 写回，历史快照不失联） */
  const handleDelete = async () => {
    const target = deleting
    if (!target?.id) return
    const snapshot: Resume = { ...target }
    await deleteResume(target.id)
    toast.success('已删除', {
      duration: 8000,
      action: {
        label: '撤销',
        onClick: () => {
          void restoreResume(snapshot)
            .then(() => toast.success(`已恢复「${snapshot.title}」`))
            .catch(() => toast.error('恢复失败，请重试'))
        },
      },
    })
  }

  const handleRename = async () => {
    if (!renaming?.id || !renameValue.trim()) return
    await updateResume(renaming.id, { title: renameValue.trim() })
    setRenaming(null)
  }

  const loading = resumes === undefined
  const empty = useMemo(() => resumes !== undefined && resumes.length === 0, [resumes])

  /** 搜索索引：标题 + 文档首行。首行需要解析文档 JSON，按 resumes 变化缓存一次，
      避免每次按键对全部简历重复解析 */
  const haystack = useMemo(() => {
    const m = new Map<number, string>()
    for (const r of resumes ?? []) {
      m.set(r.id!, `${r.title}\n${docFirstLine(r.content) ?? ''}`.toLowerCase())
    }
    return m
  }, [resumes])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q
      ? (resumes ?? []).filter((r) => haystack.get(r.id!)?.includes(q))
      : [...(resumes ?? [])]
    const by: Record<SortKey, (a: Resume, b: Resume) => number> = {
      updated: (a, b) => b.updatedAt - a.updatedAt,
      created: (a, b) => b.createdAt - a.createdAt,
      title: (a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN'),
    }
    return list.sort(by[sort])
  }, [resumes, query, sort, haystack])

  const noMatch = !loading && !empty && visible.length === 0

  return (
    <div className="flex h-full flex-col bg-background">
      {/* 顶栏 */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-6">
        <div className="flex items-center gap-2.5">
          <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Feather className="size-4" />
          </span>
          <div className="leading-tight">
            <div className="text-sm font-bold tracking-wide">墨历</div>
            <div className="text-[11px] text-muted-foreground">本地优先 · Markdown 简历工作台</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="size-8" onClick={toggleTheme} aria-label="切换主题">
            {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Button>
          <Button variant="ghost" size="icon" className="size-8" onClick={() => setSettingsOpen(true)} aria-label="设置">
            <Settings className="size-4" />
          </Button>
        </div>
      </header>

      {/* 主体 */}
      <main className="min-h-0 flex-1 overflow-auto scrollbar-thin">
        <div className="mx-auto max-w-5xl px-6 py-10">
          <div className="mb-6 flex items-end justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-xl font-bold tracking-tight">我的简历</h1>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {loading
                  ? '读取中…'
                  : `${resumes.length} 份文档 · 数据仅保存在本浏览器`}
              </p>
            </div>
            {/* 空状态时隐藏顶栏操作组：与中央引导按钮功能重复，把焦点留给引导区。
                加载中（undefined）也隐藏，避免按钮闪现后随空态消失 */}
            {!loading && !empty && (
              <div className="flex shrink-0 gap-2">
                <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => void handleImport()}>
                  <FileUp className="size-3.5" /> 导入 .md
                </Button>
                <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setCreateOpen(true)}>
                  <Plus className="size-3.5" /> 新建简历
                </Button>
              </div>
            )}
          </div>

          {/* 搜索 + 排序：简历多于一份时才出现，不给空态添噪音 */}
          {!loading && !empty && (
            <div className="mb-5 flex items-center gap-2">
              <div className="relative min-w-0 flex-1 sm:max-w-xs">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
                  placeholder="搜索标题或内容…"
                  aria-label="搜索简历"
                  data-testid="resume-search"
                  className="h-8 pr-8 pl-8 text-xs"
                />
                {query && (
                  <button
                    type="button"
                    aria-label="清空搜索框"
                    onClick={() => setQuery('')}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 shrink-0 gap-1.5 text-xs"
                    aria-label="排序方式"
                    data-testid="resume-sort"
                  >
                    <ArrowDownWideNarrow className="size-3.5" />
                    <span className="hidden sm:inline">
                      {SORT_OPTIONS.find((o) => o.id === sort)?.label}
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                    排序方式
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {SORT_OPTIONS.map((o) => (
                    <DropdownMenuItem key={o.id} onClick={() => setSort(o.id)} className="gap-2">
                      <span className="flex-1">{o.label}</span>
                      {sort === o.id && <span className="text-primary">✓</span>}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}

          {/* 加载骨架：与卡片同构，避免"读取中…"一句文字后的布局跳跃 */}
          {loading && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }, (_, i) => (
                <CardSkeleton key={i} />
              ))}
            </div>
          )}

          {/* 空状态 */}
          {empty && (
            <div className="mt-20 flex flex-col items-center justify-center gap-4 text-center">
              <span className="flex size-14 items-center justify-center rounded-lg border bg-card">
                <Feather className="size-6 text-primary" />
              </span>
              <div>
                <p className="font-medium">从这里开始你的第一份简历</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  用 Markdown 书写，实时预览 A4 排版，一键导出 PDF
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" className="gap-1.5 text-xs" onClick={() => void handleCreate()}>
                  <Plus className="size-3.5" /> 创建示例简历
                </Button>
                <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => void handleImport()}>
                  <FileUp className="size-3.5" /> 导入 .md 文件
                </Button>
              </div>
            </div>
          )}

          {/* 搜索无结果：与"没有任何简历"是两种状态，文案与出口都应不同 */}
          {noMatch && (
            <div className="mt-20 flex flex-col items-center justify-center gap-3 text-center">
              <span className="flex size-12 items-center justify-center rounded-lg border bg-card">
                <Search className="size-5 text-muted-foreground" />
              </span>
              <p className="text-sm">
                没有匹配「<span className="font-medium">{query.trim()}</span>」的简历
              </p>
              <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => setQuery('')}>
                <Undo2 className="size-3.5" /> 清除搜索
              </Button>
            </div>
          )}

          {/* 卡片网格 */}
          {!loading && !empty && !noMatch && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((r) => (
                <ResumeCard
                  key={r.id}
                  resume={r}
                  onOpen={() => navigate(`/resume/${r.id}`)}
                  onRename={() => {
                    setRenaming(r)
                    setRenameValue(r.title)
                  }}
                  onDuplicate={() => void handleDuplicate(r.id!)}
                  onDelete={() => setDeleting(r)}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      {/* 重命名弹窗 */}
      <Dialog open={renaming !== null} onOpenChange={(open) => !open && setRenaming(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>重命名简历</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void handleRename()}
            placeholder="简历标题"
          />
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRenaming(null)}>
              取消
            </Button>
            <Button size="sm" disabled={!renameValue.trim()} onClick={() => void handleRename()}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />

      {/* 新建简历：空白 / 模板选择 */}
      <CreateResumeDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={handleCreated} />

      {/* 删除确认弹窗 */}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="删除简历"
        description={`确定删除「${deleting?.title ?? ''}」吗？删除后可在提示条中点「撤销」找回。`}
        confirmText="删除"
        destructive
        onConfirm={() => void handleDelete()}
      />
    </div>
  )
}
