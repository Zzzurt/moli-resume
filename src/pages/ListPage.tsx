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
  updateResume,
} from '@/lib/db'
import { pickTextFile, titleFromFilename } from '@/lib/fileIO'
import { DEFAULT_RESUME_CONTENT, DEFAULT_RESUME_TITLE } from '@/lib/defaultResume'
import { docFirstLine } from '@/lib/docUtils'
import { TEMPLATES, type Resume } from '@/types'
import { cn, timeAgo } from '@/lib/utils'
import { toast } from 'sonner'

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

  const handleDelete = async () => {
    if (!deleting?.id) return
    await deleteResume(deleting.id)
    toast.success('已删除')
  }

  const handleRename = async () => {
    if (!renaming?.id || !renameValue.trim()) return
    await updateResume(renaming.id, { title: renameValue.trim() })
    setRenaming(null)
  }

  const empty = useMemo(() => resumes !== undefined && resumes.length === 0, [resumes])

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
            <div className="text-[10px] text-muted-foreground">本地优先 · Markdown 简历工作台</div>
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
          <div className="mb-6 flex items-end justify-between">
            <div>
              <h1 className="text-xl font-bold tracking-tight">我的简历</h1>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {resumes === undefined
                  ? '读取中…'
                  : `${resumes.length} 份文档 · 数据仅保存在本浏览器`}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => void handleImport()}>
                <FileUp className="size-3.5" /> 导入 .md
              </Button>
              <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setCreateOpen(true)}>
                <Plus className="size-3.5" /> 新建简历
              </Button>
            </div>
          </div>

          {/* 空状态 */}
          {empty && (
            <div className="mt-20 flex flex-col items-center justify-center gap-4 text-center">
              <span className="flex size-14 items-center justify-center rounded-2xl border bg-card">
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

          {/* 卡片网格 */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {resumes?.map((r) => {
              const tpl = TEMPLATES.find((t) => t.id === r.template)
              return (
                <div
                  key={r.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/resume/${r.id}`)}
                  onKeyDown={(e) => e.key === 'Enter' && navigate(`/resume/${r.id}`)}
                  className="group relative flex cursor-pointer flex-col rounded-lg border bg-card p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="line-clamp-1 text-sm font-semibold">{r.title}</h3>
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
                        <DropdownMenuItem
                          onClick={() => {
                            setRenaming(r)
                            setRenameValue(r.title)
                          }}
                        >
                          <Pencil className="size-4" /> 重命名
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => void handleDuplicate(r.id!)}>
                          <Copy className="size-4" /> 创建副本
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => setDeleting(r)}
                        >
                          <Trash2 className="size-4" /> 删除
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  <p className="mt-2 line-clamp-2 flex-1 text-xs leading-relaxed text-muted-foreground">
                    {docFirstLine(r.content) ?? '（空白文档）'}
                  </p>

                  <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <span className={cn('size-2 rounded-[3px]', tpl?.dotClass ?? 'bg-gray-300')} />
                      {tpl?.name ?? '简约'}
                    </span>
                    <span>编辑于 {timeAgo(r.updatedAt)}</span>
                  </div>
                </div>
              )
            })}
          </div>
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
        description={`确定删除「${deleting?.title ?? ''}」吗？此操作不可撤销。`}
        confirmText="删除"
        destructive
        onConfirm={() => void handleDelete()}
      />
    </div>
  )
}
