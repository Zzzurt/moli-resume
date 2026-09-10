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
  Pencil,
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
import { useMediaQuery, NARROW_QUERY } from '@/hooks/useMediaQuery'
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

/** 主题色色板（预设 + 自定义）：桌面下拉与窄屏「更多」菜单共用同一份交互 */
function AccentSwatches({
  current,
  onPick,
}: {
  current?: string
  onPick: (hex: string | undefined) => void
}) {
  return (
    <>
      <DropdownMenuItem onClick={() => onPick(undefined)} className="gap-2">
        <span className="size-3.5 rounded-full border border-dashed border-muted-foreground/60" />
        <span className="flex-1 text-sm">默认</span>
        {!current && <Check className="size-3.5 text-primary" />}
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
              current === hex ? 'border-primary' : 'border-transparent'
            )}
            onClick={() => onPick(hex)}
          >
            <span className="size-3.5 rounded-full" style={{ background: hex }} />
          </button>
        ))}
      </div>
      {/* 自定义主题色（学木及的 ColorPicker）：任意色实时生效 */}
      <label className="flex cursor-pointer items-center gap-2.5 px-2 py-1.5 text-sm outline-none">
        <input
          type="color"
          aria-label="自定义主题色"
          data-testid="accent-custom"
          value={current ?? '#3b82f6'}
          onChange={(e) => onPick(e.target.value)}
          className="size-6 cursor-pointer rounded border border-border bg-transparent p-0.5"
        />
        <span className="flex-1">自定义颜色…</span>
      </label>
    </>
  )
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
  /** <768px：完整操作组实测需 768px，以下折叠进「更多」，只留导出 PDF 作主动作 */
  const compact = useMediaQuery(NARROW_QUERY)

  /** 文件类操作：桌面下拉与窄屏「更多」共用 */
  const fileItems = (
    <>
      <DropdownMenuItem onClick={onImportMd}>
        <FileUp className="size-4" />
        {compact ? '导入 .md（覆盖内容）' : '导入 .md（覆盖当前内容）'}
      </DropdownMenuItem>
      <DropdownMenuItem onClick={onExportMd}>
        <FileDown className="size-4" /> 导出 .md
      </DropdownMenuItem>
      {onExportPng && (
        <DropdownMenuItem disabled={exporting} onClick={onExportPng}>
          <FileImage className="size-4" /> 导出长图 PNG
        </DropdownMenuItem>
      )}
      {onExportPrintPdf && (
        <DropdownMenuItem onClick={onExportPrintPdf}>
          <FileType2 className="size-4" /> 导出文字版 PDF
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
    </>
  )

  return (
    <TooltipProvider delayDuration={400}>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-background px-2 sm:px-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              aria-label="返回列表"
              onClick={() => navigate('/')}
            >
              <ArrowLeft className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>返回列表</TooltipContent>
        </Tooltip>

        {/* 标题行内编辑：窄屏占满剩余宽度；桌面固定 224px，但允许收缩——
            操作组不该被挤压（按钮文字会挤成两行），空间紧张时优先压缩标题。
            实测：操作组自然宽约 515px + 返回键与内边距 ≈ 587px，
            故 768px 视口下标题仍有 ~180px 可用 */}
        <div className={cn('group relative min-w-0 shrink', compact ? 'flex-1' : 'w-56 min-w-[7rem]')}>
          <Input
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            className="h-8 w-full border-transparent bg-transparent pl-2 pr-7 text-sm font-medium hover:border-input focus-visible:bg-background"
            aria-label="简历标题"
          />
          <PencilHint />
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          {compact ? (
            /* ---------- 窄屏：导出 PDF 为主动作，其余收进「更多」 ---------- */
            <>
              <Button size="sm" className="h-8 gap-1.5 text-xs" disabled={exporting} onClick={onExportPdf}>
                <Printer className="size-3.5" />
                {exporting ? '导出中…' : '导出 PDF'}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-8"
                    aria-label="更多操作"
                    data-testid="header-more"
                  >
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-h-[75vh] w-64 overflow-auto">
                  <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                    模板与排版
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {/* 打开实时预览面板（与桌面「模板」按钮同一入口） */}
                  <DropdownMenuItem className="gap-2" onClick={() => setPickerOpen(true)}>
                    <LayoutTemplate className="size-4" />
                    <span className="flex-1">模板</span>
                    <span className="text-xs text-muted-foreground">
                      {TEMPLATES.find((t) => t.id === template)?.name ?? '简约'}
                    </span>
                  </DropdownMenuItem>
                  {onSmartOnePageChange && (
                    <DropdownMenuItem
                      className="gap-2"
                      onClick={() => onSmartOnePageChange(!smartOnePage)}
                    >
                      <Shrink className="size-4" />
                      <span className="flex-1">智能一页</span>
                      {smartOnePage && <Check className="size-3.5 text-primary" />}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                    主题色（实时应用 · 影响导出）
                  </DropdownMenuLabel>
                  <AccentSwatches
                    current={currentAccent}
                    onPick={(hex) => update('accentColor', hex)}
                  />
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                    文件
                  </DropdownMenuLabel>
                  {fileItems}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="gap-2" onClick={toggleTheme}>
                    {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
                    <span className="flex-1">{theme === 'dark' ? '切换浅色' : '切换深色'}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem className="gap-2" onClick={() => setSettingsOpen(true)}>
                    <Settings className="size-4" /> 设置
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            /* ---------- 桌面：完整操作组 ---------- */
            <>
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
                  <AccentSwatches
                    current={currentAccent}
                    onPick={(hex) => update('accentColor', hex)}
                  />
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
                <DropdownMenuContent align="end">{fileItems}</DropdownMenuContent>
              </DropdownMenu>

              {/* PDF 导出 */}
              <Button size="sm" className="h-8 gap-1.5 text-xs" disabled={exporting} onClick={onExportPdf}>
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
                      aria-pressed={smartOnePage}
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
                      ? '自适应一页：内容超出时收紧排版并微缩放，不足时舒展行距并整体放大，尽量排满一页（点击关闭）'
                      : '已关闭：内容超出即分页、不足即留白（点击开启）'}
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
                <TooltipContent>设置</TooltipContent>
              </Tooltip>
            </>
          )}
        </div>

        {/* 弹窗挂在顶栏内、不参与布局（portal 渲染）：两种分支共用同一实例 */}
        <TemplatePickerDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          template={template}
          content={content}
          accentColor={accentColor}
          onSelect={onTemplateChange}
        />
        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      </header>
    </TooltipProvider>
  )
}

/** 标题可编辑性暗示：hover / 聚焦时右侧浮出铅笔，提示这里可点可改 */
function PencilHint() {
  return (
    <Pencil
      aria-hidden
      className="pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-70 group-focus-within:opacity-70"
    />
  )
}
