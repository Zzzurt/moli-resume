import { useState } from 'react'
import {
  Bot,
  Database,
  Download,
  Upload,
  Eye,
  EyeOff,
  PlugZap,
  Loader2,
  Check,
  BookMarked,
  Trash2,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useSettings } from '@/hooks/useSettings'
import { chatCompletion, aiErrorMessage } from '@/lib/aiService'
import { exportBackup, importBackup, type BackupFile } from '@/lib/db'
import { downloadFile, parseJson, pickTextFile } from '@/lib/fileIO'
import type { AiProfile, LayoutMode, PaperTone } from '@/types'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** 排版档位选项 */
const LAYOUT_OPTIONS: { id: LayoutMode; label: string; desc: string }[] = [
  { id: 'standard', label: '标准', desc: '模板默认' },
  { id: 'compact', label: '紧凑', desc: '页边距/行距收紧，单页容纳更多' },
  { id: 'loose', label: '宽松', desc: '更松的节奏与更大的字距' },
]

/** 预览纸张观感（纯屏幕偏好，导出不受影响） */
const PAPER_TONES: { id: PaperTone; label: string; desc: string }[] = [
  { id: 'white', label: '亮白纸', desc: '打印件原色' },
  { id: 'dim', label: '降亮度', desc: '深色工作区下长时间看更舒服' },
  { id: 'warm', label: '暖色纸', desc: '偏米黄，接近阅读纸' },
]

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const { settings, update } = useSettings()
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testOk, setTestOk] = useState(false)
  /** 待确认恢复的备份文件（弹窗确认后写入） */
  const [pendingBackup, setPendingBackup] = useState<BackupFile | null>(null)

  const config = {
    baseUrl: settings.aiBaseUrl,
    apiKey: settings.aiApiKey,
    model: settings.aiModel,
  }

  /* ---------- AI 多配置档：保存 / 切换 / 删除 ---------- */
  const profiles: AiProfile[] = settings.aiProfiles ?? []
  const activeProfile = profiles.find((p) => p.id === settings.activeProfileId)

  /** 保存当前输入：命中已选配置则更新之，否则新建并以当前输入为底 */
  const saveProfile = () => {
    const profileId = activeProfile?.id ?? `p-${Date.now()}`
    const name = activeProfile?.name ?? `配置 ${profiles.length + 1}`
    update('aiProfiles', [
      ...profiles.filter((p) => p.id !== profileId),
      { id: profileId, name, baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel },
    ])
    update('activeProfileId', profileId)
    toast.success(activeProfile ? '已更新配置' : '已保存为新配置，可随时切换')
  }

  const applyProfile = (p: AiProfile) => {
    update('aiBaseUrl', p.baseUrl)
    update('aiApiKey', p.apiKey)
    update('aiModel', p.model)
    update('activeProfileId', p.id)
    setTestOk(false)
    toast.success(`已切换到「${p.name}」`)
  }

  const deleteProfile = () => {
    if (!activeProfile) return
    update('aiProfiles', profiles.filter((p) => p.id !== activeProfile.id))
    update('activeProfileId', undefined)
    toast.success(`已删除配置「${activeProfile.name}」（当前字段保留）`)
  }

  const testConnection = async () => {
    setTesting(true)
    setTestOk(false)
    try {
      await chatCompletion(
        config,
        [{ role: 'user', content: 'ping' }],
        { temperature: 0, firstByteMs: 15_000 }
      )
      setTestOk(true)
      toast.success('连接成功，模型可用')
    } catch (e) {
      toast.error(aiErrorMessage(e))
    } finally {
      setTesting(false)
    }
  }

  const handleExportBackup = async () => {
    const backup = await exportBackup()
    downloadFile(
      JSON.stringify(backup, null, 2),
      `ink-resume-backup-${new Date().toISOString().slice(0, 10)}.json`,
      'application/json'
    )
    toast.success('备份已导出（不含 API Key）')
  }

  const handleImportBackup = async () => {
    const picked = await pickTextFile('.json,application/json')
    if (!picked) return
    const data = parseJson<BackupFile>(picked.text)
    if (!data || data.app !== 'ink-resume' || !Array.isArray(data.resumes)) {
      toast.error('不是有效的墨历备份文件')
      return
    }
    setPendingBackup(data)
  }

  const confirmImportBackup = async () => {
    const data = pendingBackup
    setPendingBackup(null)
    if (!data) return
    try {
      await importBackup(data)
      toast.success('数据已恢复，即将刷新页面')
      window.setTimeout(() => window.location.reload(), 800)
    } catch (e) {
      toast.error(`恢复失败：${e instanceof Error ? e.message : '未知错误'}`)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>设置</DialogTitle>
          <DialogDescription>AI 模型接入与本地数据管理，全部数据仅存于本浏览器。</DialogDescription>
        </DialogHeader>

        {/* AI 接入 */}
        <section className="space-y-3">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <Bot className="size-4 text-primary" /> AI 模型
          </h3>
          {/* 多配置档：切换已存配置 / 保存当前 / 删除选中 */}
          <div className="flex items-center gap-1.5">
            {profiles.length > 0 ? (
              <select
                aria-label="AI 配置档"
                data-testid="ai-profile-select"
                value={activeProfile?.id ?? ''}
                onChange={(e) => {
                  const id = e.target.value
                  if (!id) {
                    update('activeProfileId', undefined)
                    return
                  }
                  const p = profiles.find((x) => x.id === id)
                  if (p) applyProfile(p)
                }}
                className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring"
              >
                <option value="">
                  {activeProfile ? '— 另存为新配置 —' : '— 不选择配置 —'}
                </option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="flex-1 text-[11px] text-muted-foreground">
                可将常用网关保存为配置，一键切换（如日常/终稿模型）。
              </span>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-8 shrink-0 gap-1 px-2 text-[11px]"
              data-testid="ai-profile-save"
              onClick={saveProfile}
            >
              <BookMarked className="size-3.5" /> {activeProfile ? '更新' : '保存为配置'}
            </Button>
            {activeProfile && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 shrink-0 px-2 text-muted-foreground hover:text-destructive"
                aria-label="删除当前配置"
                data-testid="ai-profile-delete"
                onClick={deleteProfile}
              >
                <Trash2 className="size-3.5" />
              </Button>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ai-base-url" className="text-xs">
              Base URL（OpenAI 兼容格式）
            </Label>
            <Input
              id="ai-base-url"
              value={settings.aiBaseUrl}
              onChange={(e) => update('aiBaseUrl', e.target.value)}
              placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ai-api-key" className="text-xs">
              API Key
            </Label>
            <div className="relative">
              <Input
                id="ai-api-key"
                type={showKey ? 'text' : 'password'}
                value={settings.aiApiKey}
                onChange={(e) => {
                  update('aiApiKey', e.target.value)
                  setTestOk(false)
                }}
                placeholder="sk-…（仅保存在本机 IndexedDB）"
                className="h-8 pr-9 font-mono text-xs"
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ai-model" className="text-xs">
              模型
            </Label>
            <Input
              id="ai-model"
              value={settings.aiModel}
              onChange={(e) => update('aiModel', e.target.value)}
              placeholder="qwen-plus"
              className="h-8 font-mono text-xs"
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 text-xs"
            disabled={testing}
            onClick={() => void testConnection()}
          >
            {testing ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : testOk ? (
              <Check className="size-3.5 text-primary" />
            ) : (
              <PlugZap className="size-3.5" />
            )}
            测试连接
          </Button>
        </section>

        <Separator />

        {/* 手动排版档位 */}
        <section className="space-y-2">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <BookMarked className="size-4 text-primary" /> 排版
          </h3>
          <div className="grid grid-cols-3 gap-1.5">
            {LAYOUT_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                data-testid={`layout-${opt.id}`}
                title={opt.desc}
                className={cn(
                  'rounded-md border px-2 py-1.5 text-xs font-medium transition-colors',
                  settings.layout === opt.id
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:bg-accent'
                )}
                onClick={() => update('layout', opt.id)}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            作用范围：编辑画布、A4 预览与所有导出；「智能一页」在其基础上自动收紧或舒展，
            双向适配到一页。
          </p>

          {/* 纸张只影响预览观感：白纸在深色工作区里长时间盯着容易累 */}
          <div className="space-y-1.5 pt-1">
            <div className="text-xs font-medium">预览纸张</div>
            <div className="grid grid-cols-3 gap-1.5">
              {PAPER_TONES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  title={t.desc}
                  aria-pressed={(settings.paperTone ?? 'white') === t.id}
                  data-testid={`paper-${t.id}`}
                  className={cn(
                    'rounded-md border px-2 py-1.5 text-xs font-medium transition-colors',
                    (settings.paperTone ?? 'white') === t.id
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:bg-accent'
                  )}
                  onClick={() => update('paperTone', t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              只改屏幕上的纸面观感（深色模式久看不累）；导出 PDF / 长图 / 打印始终是纯白纸。
            </p>
          </div>
        </section>

        <Separator />

        {/* 数据备份 */}
        <section className="space-y-3">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <Database className="size-4 text-primary" /> 数据备份
          </h3>
          <p className="text-xs leading-relaxed text-muted-foreground">
            将全部简历与设置导出为一个 JSON 文件（不含 API Key），或从备份文件恢复（覆盖当前数据，
            本机 API Key 保留）。
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 text-xs"
              onClick={() => void handleExportBackup()}
            >
              <Download className="size-3.5" /> 导出 JSON
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 text-xs"
              onClick={() => void handleImportBackup()}
            >
              <Upload className="size-3.5" /> 导入恢复
            </Button>
          </div>
        </section>
      </DialogContent>
      </Dialog>

      {/* 恢复备份确认弹窗 */}
      <ConfirmDialog
        open={pendingBackup !== null}
        onOpenChange={(open) => !open && setPendingBackup(null)}
        title="恢复备份"
        description={`将恢复 ${pendingBackup?.resumes.length ?? 0} 份简历并覆盖当前所有数据（API Key 保留本机），此操作不可撤销。确定继续吗？`}
        confirmText="恢复"
        destructive
        onConfirm={() => void confirmImportBackup()}
      />
    </>
  )
}
