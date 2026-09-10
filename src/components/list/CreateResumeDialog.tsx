import { useEffect, useState } from 'react'
import { FilePlus2, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { TEMPLATES, type TemplateId } from '@/types'
import { TEMPLATE_SNAPSHOT_URLS } from '@/generated/templateSnapshots'
import { createResume } from '@/lib/db'
import { DEFAULT_RESUME_CONTENT, DEFAULT_RESUME_TITLE } from '@/lib/defaultResume'
import { toast } from 'sonner'

interface CreateResumeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 创建成功后回调（父级负责跳转编辑器） */
  onCreated: (id: number) => void
}

/**
 * 新建简历对话框（参考 Magic Resume 的 CreateResumeModal）：
 * 「空白简历」直接创建；模板网格 → 点击放大预览 → 「使用此模板」创建。
 * 模板快照由 scripts/generate_template_snapshots.cjs 预生成，缺图时降级为名称占位。
 * 创建内容统一用内置示例文档（与原「新建简历」行为一致），所选模板只决定排版样式。
 */
export function CreateResumeDialog({ open, onOpenChange, onCreated }: CreateResumeDialogProps) {
  /** 正在放大预览的模板；null = 模板网格视图 */
  const [previewTpl, setPreviewTpl] = useState<TemplateId | null>(null)

  /* 关闭时复位到网格视图（延迟到动画结束后清理亦可，此处直接复位无副作用） */
  useEffect(() => {
    if (!open) setPreviewTpl(null)
  }, [open])

  const create = async (template?: TemplateId) => {
    try {
      const id = await createResume({
        title: DEFAULT_RESUME_TITLE,
        content: DEFAULT_RESUME_CONTENT,
        ...(template ? { template } : {}),
      })
      onOpenChange(false)
      onCreated(id)
    } catch (e) {
      /* IndexedDB 写入失败（配额满 / 隐私模式禁用）：给出反馈而不是让弹窗卡住不动 */
      toast.error(`创建失败：${e instanceof Error ? e.message : '未知错误'}`)
    }
  }

  const previewEntry = previewTpl ? TEMPLATES.find((t) => t.id === previewTpl) : undefined
  const previewSrc = previewTpl ? TEMPLATE_SNAPSHOT_URLS[previewTpl] : undefined

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto scrollbar-thin">
        <DialogHeader>
          <DialogTitle>新建简历</DialogTitle>
          <DialogDescription>
            从空白开始，或选一个模板快速上手；内容随时可改，模板切换不动内容。
          </DialogDescription>
        </DialogHeader>

        {previewTpl === null ? (
          <>
            {/* 空白简历 */}
            <button
              type="button"
              data-testid="create-blank"
              onClick={() => void create()}
              className="flex w-full items-center gap-3 rounded-lg border p-4 text-left transition-colors hover:border-primary/50 hover:bg-accent/40"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-md border bg-card">
                <FilePlus2 className="size-5 text-primary" />
              </span>
              <span className="flex flex-col">
                <span className="text-sm font-semibold">空白简历</span>
                <span className="text-xs text-muted-foreground">
                  从内置示例文档开始，直接进入编辑器
                </span>
              </span>
            </button>

            {/* 模板网格 */}
            <div className="mt-2 flex items-center gap-3">
              <span className="shrink-0 text-xs font-medium text-muted-foreground">从模板开始</span>
              <span className="h-px flex-1 bg-border" />
            </div>
            <div className="grid grid-cols-2 gap-3 pb-1 sm:grid-cols-4">
              {TEMPLATES.map((t) => {
                const src = TEMPLATE_SNAPSHOT_URLS[t.id]
                return (
                  <button
                    key={t.id}
                    type="button"
                    data-testid={`tpl-card-${t.id}`}
                    onClick={() => setPreviewTpl(t.id)}
                    className="group overflow-hidden rounded-lg border text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-md"
                  >
                    <div className="aspect-[210/297] w-full overflow-hidden bg-muted">
                      {src ? (
                        <img
                          src={src}
                          alt={t.name}
                          loading="lazy"
                          draggable={false}
                          className="h-full w-full object-cover object-top"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center bg-gradient-to-br from-muted to-accent/30 text-sm text-muted-foreground">
                          {t.name}
                        </div>
                      )}
                    </div>
                    <div className="border-t px-2.5 py-2">
                      <div className="flex items-center gap-1.5">
                        <span className={`size-2 shrink-0 rounded-[3px] ${t.dotClass}`} />
                        <span className="truncate text-xs font-semibold">{t.name}</span>
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {t.description}
                      </p>
                    </div>
                  </button>
                )
              })}
            </div>
          </>
        ) : (
          /* 模板放大预览 */
          <div className="flex flex-col gap-4 sm:flex-row">
            <div className="min-w-0 flex-1 overflow-hidden rounded-lg border bg-muted">
              {previewSrc ? (
                <img
                  src={previewSrc}
                  alt={previewEntry?.name}
                  draggable={false}
                  className="max-h-[58vh] w-full object-cover object-top sm:max-h-[62vh]"
                />
              ) : (
                <div className="flex aspect-[210/297] items-center justify-center text-sm text-muted-foreground">
                  {previewEntry?.name}
                </div>
              )}
            </div>
            <div className="flex w-full shrink-0 flex-col sm:w-44">
              <div className="flex items-center gap-2">
                <span className={`size-2.5 rounded-[3px] ${previewEntry?.dotClass ?? ''}`} />
                <h3 className="text-base font-semibold">{previewEntry?.name}</h3>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {previewEntry?.description}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                将以示例文档创建一份新简历，可随时在编辑器内切换其他模板。
              </p>
              <div className="mt-auto flex flex-col gap-2 pt-4">
                <Button size="sm" data-testid="use-template" onClick={() => void create(previewTpl)}>
                  使用此模板
                </Button>
                <Button size="sm" variant="outline" onClick={() => setPreviewTpl(null)}>
                  <ArrowLeft className="size-3.5" /> 返回选模板
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}