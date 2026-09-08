import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  LayoutTemplate,
  FileDown,
  FileImage,
  FileUp,
  FileText,
  Printer,
  FileType2,
  MoreHorizontal,
  Sun,
  Moon,
  Settings,
  Check,
  Shrink,
  Keyboard,
  History,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip'
import { TEMPLATES, type TemplateId } from '@/types'
import { useSettings } from '@/hooks/useSettings'
import { SettingsDialog } from '@/components/settings/SettingsDialog'
import { TemplatePickerDialog } from '@/components/layout/TemplatePickerDialog'
import { cn } from '@/lib/utils'

/** 主题色预设（覆盖模板 --rs-accent，实时生效于编辑器与预览） */
const ACCENT_PRESETS = [
  '#2d6cdf', // 商务蓝
  '#4f46e5', // 靛蓝
  '#0e7490', // 深青
  '#00a388', // 翡翠绿
  '#7c3aed', // 紫罗兰
  '#e11d48', // 玫红
  '#ea580c', // 橙
  '#111827', // 石墨黑
] as const

interface AppHeaderProps {
  title: string
  onTitleChange: (title: string) => void
  template: TemplateId
  onTemplateChange: (t: TemplateId) => void
  onExportPdf: () => void
  onExportPng?: () => void
  onExportMd: () => void
  /** 文字版 PDF（浏览器打印对话框，矢量文字可复制/可搜索） */
  onExportPrintPdf?: () => void
  /** Word（.docx）结构化导出 */
  onExportDocx?: () => void
  onImportMd: () => void
  exporting?: boolean
  /** 智能一页开关（内容超一页自动缩放至恰好一页） */
  smartOnePage?: boolean
  onSmartOnePageChange?: (on: boolean) => void
  /** 当前简历内容（Tiptap JSON，供模板面板实时预览；建议传防抖版本） */
  content?: string
  /** 主题色覆盖（联动模板面板卡片） */
  accentColor?: string
  /** 打开历史版本 / 快捷键帮助 */
  onHistory?: () => void
  onShortcuts?: () => void
}

export function AppHeader({
  title,
  onTitleChange,
  template,
  onTemplateChange,
  onExportPdf,
  onExportPng,
  onExportMd,
  onExportPrintPdf,
  onExportDocx,
  onImportMd,
  exporting,
  smartOnePage = true,
  onSmartOnePageChange,
  content = '',
  accentColor,
  onHistory,
  onShortcuts,
}: AppHeaderProps) {
  const navigate = useNavigate()
  const { theme, toggleTheme, settings, update } = useSettings()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const currentAccent = settings.accentColor

  return (
    <TooltipProvider delayDuration={400}>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-background px-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label="返回列表"
              onClick={() => navigate('/')}
            >
              <ArrowLeft className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>返回列表</TooltipContent>
        </Tooltip>

        {/* 标题行内编辑 */}
        <Input
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          className="h-8 w-56 border-transparent bg-transparent px-2 text-sm font-medium hover:border-input focus-visible:bg-background"
          aria-label="简历标题"
        />

        <div className="ml-auto flex items-center gap-1">
          {/* 模板切换：实时预览面板（按当前内容与主题色渲染 8 张卡片） */}
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            data-testid="template-picker-trigger"
            onClick={() => setPickerOpen(true)}
          >
            <LayoutTemplate className="size-3.5" />
            {TEMPLATES.find((t) => t.id === template)?.name ?? '模板'}
          </Button>
          <TemplatePickerDialog
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            template={template}
            content={content}
            accentColor={accentColor}
            onSelect={onTemplateChange}
          />

          {/* 主题色（实时覆盖模板强调色，编辑器与预览同步） */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                <span
                  className={cn(
                    'size-3 rounded-full border',
                    currentAccent ? 'border-transparent' : 'border-dashed border-muted-foreground/60'
                  )}
                  style={currentAccent ? { background: currentAccent } : undefined}
                />
                主题色
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                主题色（实时应用 · 影响导出）
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => update('accentColor', undefined)} className="gap-2">
                <span className="size-3.5 rounded-full border border-dashed border-muted-foreground/60" />
                <span className="flex-1 text-sm">默认</span>
                {!currentAccent && <Check className="size-3.5 text-primary" />}
              </DropdownMenuItem>
              <div className="grid grid-cols-4 gap-1 p-1.5">
                {ACCENT_PRESETS.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    title={hex}
                    aria-label={`主题色 ${hex}`}
                    className={cn(
                      'flex h-8 items-center justify-center rounded-md border transition-colors hover:bg-accent',
                      currentAccent === hex ? 'border-primary' : 'border-transparent'
                    )}
                    onClick={() => update('accentColor', hex)}
                  >
                    <span className="size-3.5 rounded-full" style={{ background: hex }} />
                  </button>
                ))}
              </div>
              {/* 自定义主题色（学木及的 ColorPicker）：任意色实时生效 */}
              <DropdownMenuSeparator />
              <label className="flex cursor-pointer items-center gap-2.5 px-2 py-1.5 text-sm outline-none">
                <input
                  type="color"
                  aria-label="自定义主题色"
                  data-testid="accent-custom"
                  value={currentAccent ?? '#3b82f6'}
                  onChange={(e) => update('accentColor', e.target.value)}
                  className="size-6 cursor-pointer rounded border border-border bg-transparent p-0.5"
                />
                <span className="flex-1">自定义颜色…</span>
              </label>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* 导入导出 */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                <MoreHorizontal className="size-3.5" />
                文件
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onImportMd}>
                <FileUp className="size-4" /> 导入 .md（覆盖当前内容）
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onExportMd}>
                <FileDown className="size-4" /> 导出 .md
              </DropdownMenuItem>
              {onExportPng && (
                <DropdownMenuItem disabled={exporting} onClick={onExportPng}>
                  <FileImage className="size-4" /> 导出长图 PNG（多页拼接）
                </DropdownMenuItem>
              )}
              {onExportPrintPdf && (
                <DropdownMenuItem onClick={onExportPrintPdf}>
                  <FileType2 className="size-4" /> 导出文字版 PDF（可复制搜索）
                </DropdownMenuItem>
              )}
              {onExportDocx && (
                <DropdownMenuItem onClick={onExportDocx}>
                  <FileText className="size-4" /> 导出 Word（.docx）
                </DropdownMenuItem>
              )}
              {onHistory && (
                <DropdownMenuItem onClick={onHistory}>
                  <History className="size-4" /> 历史版本
                </DropdownMenuItem>
              )}
              {onShortcuts && (
                <DropdownMenuItem onClick={onShortcuts}>
                  <Keyboard className="size-4" /> 快捷键与输入规则
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* PDF 导出 */}
          <Button
            size="sm"
            className="h-8 gap-1.5 text-xs"
            disabled={exporting}
            onClick={onExportPdf}
          >
            <Printer className="size-3.5" />
            {exporting ? '导出中…' : '导出 PDF'}
          </Button>

          {/* 智能一页 */}
          {onSmartOnePageChange && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    'h-8 gap-1.5 text-xs',
                    smartOnePage && 'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary'
                  )}
                  onClick={() => onSmartOnePageChange(!smartOnePage)}
                >
                  <Shrink className="size-3.5" />
                  智能一页
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {smartOnePage
                  ? '内容略超一页时自动收紧排版（字号不变），尽量排成一页（点击关闭）'
                  : '已关闭：内容超一页时直接分页（点击开启）'}
              </TooltipContent>
            </Tooltip>
          )}

          <span className="mx-1 h-5 w-px bg-border" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label="切换主题"
                onClick={toggleTheme}
              >
                {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{theme === 'dark' ? '切换浅色' : '切换深色'}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label="设置"
                onClick={() => setSettingsOpen(true)}
              >
                <Settings className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <span className="flex items-center gap-1">
                <FileText className="size-3" /> 设置
              </span>
            </TooltipContent>
          </Tooltip>
        </div>

        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      </header>
    </TooltipProvider>
  )
}
