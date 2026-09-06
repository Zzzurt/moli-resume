import { useEffect, useState } from 'react'
import { History, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { listSnapshots, type ResumeSnapshot } from '@/lib/db'
import { docFirstLine } from '@/lib/docUtils'
import { toast } from 'sonner'

interface HistoryVersionsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  resumeId: number
  /** 确认恢复：父级负责先把当前内容存为快照，再应用快照内容 */
  onRestore: (snapshot: ResumeSnapshot) => void
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * 版本历史：展示快照列表（时间 + 标题 + 内容首行），确认后恢复内容与模板。
 * 快照由编辑器自动维护（打开时 + 保存间隔超阈值时），上限见 db.addSnapshot。
 */
export function HistoryVersionsDialog({ open, onOpenChange, resumeId, onRestore }: HistoryVersionsDialogProps) {
  const [snapshots, setSnapshots] = useState<ResumeSnapshot[] | null>(null)
  /** 待确认恢复的快照 */
  const [restoring, setRestoring] = useState<ResumeSnapshot | null>(null)

  useEffect(() => {
    if (open) {
      setSnapshots(null)
      void listSnapshots(resumeId).then(setSnapshots)
    }
  }, [open, resumeId])

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[80vh] max-w-xl overflow-y-auto scrollbar-thin">
          <DialogHeader>
            <DialogTitle>历史版本</DialogTitle>
            <DialogDescription>
              自动保存的快照（打开简历与编辑间隔超过 10 分钟时各存一份，每份简历最多 20 条）。
              恢复会替换当前内容与模板，恢复前的状态也会先存为快照，可再撤销回来。
            </DialogDescription>
          </DialogHeader>

          {snapshots === null ? (
            <p className="py-6 text-center text-sm text-muted-foreground">读取中…</p>
          ) : snapshots.length === 0 ? (
            <p className="flex flex-col items-center gap-2 py-6 text-sm text-muted-foreground">
              <History className="size-5" />
              暂无历史版本
            </p>
          ) : (
            <div className="flex flex-col gap-2 pb-1">
              {snapshots.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-xs font-medium">{formatTime(s.createdAt)}</span>
                      <span className="truncate text-xs text-muted-foreground">{s.title}</span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground/80">
                      {docFirstLine(s.content) ?? '（空白文档）'}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 shrink-0 gap-1 text-xs"
                    onClick={() => setRestoring(s)}
                  >
                    <RotateCcw className="size-3" /> 恢复
                  </Button>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={restoring !== null}
        onOpenChange={(o) => !o && setRestoring(null)}
        title="恢复此版本？"
        description={`当前内容将替换为「${restoring ? formatTime(restoring.createdAt) : ''}」的快照（当前状态会先自动存为快照）。此操作会覆盖现在的内容。`}
        confirmText="恢复"
        onConfirm={() => {
          if (!restoring) return
          onRestore(restoring)
          setRestoring(null)
          onOpenChange(false)
          toast.success('已恢复到所选版本')
        }}
      />
    </>
  )
}