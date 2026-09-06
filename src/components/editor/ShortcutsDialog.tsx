import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const MD_RULES: [string, string][] = [
  ['# + 空格', '标题一 ~ 标题六'],
  ['- 或 * + 空格', '无序列表'],
  ['1. + 空格', '有序列表'],
  ['> + 空格', '引用'],
  ['---', '分割线（现代/清爽模板中为侧栏分界）'],
  ['```', '代码块'],
  ['**加粗**', '加粗'],
  ['*斜体*', '斜体'],
  ['`行内码`', '行内代码'],
  ['~~删除线~~', '删除线'],
]

const KEYS: [string, string][] = [
  ['Ctrl + Z / Ctrl + Y', '撤销 / 重做'],
  ['Ctrl + B / I / U', '加粗 / 斜体 / 下划线'],
  ['/', '唤起块菜单（可输入关键词过滤）'],
  ['选中文字', '浮现格式工具栏（⋯ 展开更多 + AI 快捷模式）'],
  ['↑ ↓ Enter / Esc', '块菜单键盘导航 / 关闭浮层'],
  ['点击预览块', '编辑器滚动到对应块'],
]

/** 快捷键与 Markdown 输入规则速查（编辑器「文件」菜单入口） */
export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-lg overflow-y-auto scrollbar-thin">
        <DialogHeader>
          <DialogTitle>快捷键与输入规则</DialogTitle>
          <DialogDescription>直接打 Markdown 语法即时转换，无需菜单。</DialogDescription>
        </DialogHeader>
        <section>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Markdown 输入
          </h4>
          <dl className="flex flex-col gap-1.5">
            {MD_RULES.map(([k, v]) => (
              <div key={k} className="flex items-baseline gap-3 text-sm">
                <dt className="w-36 shrink-0 font-mono text-xs text-foreground">{k}</dt>
                <dd className="text-muted-foreground">{v}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            编辑与导航
          </h4>
          <dl className="flex flex-col gap-1.5">
            {KEYS.map(([k, v]) => (
              <div key={k} className="flex items-baseline gap-3 text-sm">
                <dt className="w-36 shrink-0 font-mono text-xs text-foreground">{k}</dt>
                <dd className="text-muted-foreground">{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      </DialogContent>
    </Dialog>
  )
}