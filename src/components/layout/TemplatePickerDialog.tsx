import { Check } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ResumeThumb } from '@/components/ResumeThumb'
import { TEMPLATES, type TemplateId } from '@/types'
import { cn } from '@/lib/utils'

interface TemplatePickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 当前模板（高亮标记） */
  template: TemplateId
  /** 当前简历内容（Tiptap JSON，建议上层传防抖版本，避免输入期间高频重渲染 8 张卡片） */
  content: string
  /** 主题色覆盖（实时联动所有卡片） */
  accentColor?: string
  onSelect: (t: TemplateId) => void
}

/**
 * 模板选择面板（参考 Magic Resume 的 TemplateSheet，改用实时渲染）：
 * 4 列网格、当前模板高亮、点击即切换并关闭——与「切模板不动内容」语义一致。
 */
export function TemplatePickerDialog({
  open,
  onOpenChange,
  template,
  content,
  accentColor,
  onSelect,
}: TemplatePickerDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto scrollbar-thin">
        <DialogHeader>
          <DialogTitle>切换模板</DialogTitle>
          <DialogDescription>
            按当前简历内容与主题色实时预览；切换只换样式，内容保持不变。
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 pb-1 sm:grid-cols-4">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              data-testid={`picker-${t.id}`}
              onClick={() => {
                onSelect(t.id)
                onOpenChange(false)
              }}
              className={cn(
                'overflow-hidden rounded-lg border text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md',
                template === t.id
                  ? 'border-primary ring-1 ring-primary'
                  : 'border-border hover:border-primary/60'
              )}
            >
              <ResumeThumb template={t.id} content={content} accentColor={accentColor} />
              <div className="border-t bg-card px-2.5 py-2">
                <div className="flex items-center gap-1.5">
                  <span className={cn('size-2 shrink-0 rounded-[3px]', t.dotClass)} />
                  <span className="truncate text-xs font-semibold">{t.name}</span>
                  {template === t.id && <Check className="ml-auto size-3.5 shrink-0 text-primary" />}
                </div>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{t.description}</p>
              </div>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}