import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { CSSProperties } from 'react'
import { EditorContent, useEditor, type Editor, type JSONContent } from '@tiptap/react'
import {
  Bold,
  Italic,
  Strikethrough,
  Code2,
  Sparkles,
  SpellCheck2,
  CircleCheck,
  Loader2,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Type,
  List,
  ListOrdered,
  Quote,
  Minus,
  Link2,
  Eraser,
  MoreHorizontal,
  ChevronUp,
  Undo2,
  Redo2,
  FileCode2,
  ScanSearch,
  Table as TableIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { createEditorExtensions, markdownToDoc, docToMarkdown } from '@/lib/editorSetup'
import { stripMdSyntax } from '@/lib/docUtils'
import { DragHandleLayer } from './DragHandleLayer'
import { TableMenu } from './TableMenu'
import { AI_MODES, type AiMode } from '@/lib/aiService'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { TemplateId } from '@/types'

/** 文档绝对坐标范围 */
export interface DocRange {
  from: number
  to: number
}

export interface EditorHandle {
  /** 滚动到第 index 个顶层块并高亮 */
  scrollToBlock: (index: number) => void
  /** 选区扩展到完整顶层块后序列化的 Markdown 与对应范围（润色用，保留列表/标题结构） */
  getSelectionBlockMarkdown: () => { markdown: string; range: DocRange } | null
  /** 用 Markdown 片段替换指定文档范围（结构由片段决定） */
  replaceRangeMarkdown: (range: DocRange, md: string) => void
  /** 按文本片段定位首个包含它的顶层块：返回该块范围与对应的 Markdown；未找到返回 null */
  findRangeByText: (text: string) => { range: DocRange; markdown: string } | null
  getMarkdown: () => string
  setDocFromMarkdown: (md: string) => void
  /** 用 Tiptap JSON 字符串整体替换文档（版本历史恢复用），并同步 docJson */
  setDocJson: (json: string) => void
}

interface TiptapEditorProps {
  initialContent: string
  template: TemplateId
  saveState: 'saved' | 'saving' | 'dirty'
  checking?: boolean
  onInit: (json: string) => void
  onDocChange: (json: string) => void
  /** 触发 AI 助手（润色/优化/精简/排版/提问），作用于当前选区 */
  onAiRequest: (mode: AiMode) => void
  onGrammarCheck: () => void
  /** 页面度量（来自 Preview 测量）：状态栏实时页数与智能一页状态 */
  pageMetrics?: { pageCount: number; density: number; smartOnePage: boolean }
  /** 打开 JD 匹配分析（读全文，分析型不替换文档） */
  onJdMatch?: () => void
  /** 主题色覆盖（作用到画布模板 --rs-accent）；空 = 模板默认色 */
  accentColor?: string
}

/* ---------- 斜杠菜单项 ---------- */
interface SlashItem {
  id: string
  title: string
  hint: string
  icon: typeof Heading1
  run: (editor: Editor) => void
}

const SLASH_ITEMS: SlashItem[] = [
  { id: 'h1', title: '标题一', hint: '姓名 · 大标题', icon: Heading1, run: (e) => e.chain().focus().setNode('heading', { level: 1 }).run() },
  { id: 'h2', title: '标题二', hint: '板块标题', icon: Heading2, run: (e) => e.chain().focus().setNode('heading', { level: 2 }).run() },
  { id: 'h3', title: '标题三', hint: '条目标题', icon: Heading3, run: (e) => e.chain().focus().setNode('heading', { level: 3 }).run() },
  { id: 'h4', title: '标题四', hint: '小节标题', icon: Heading4, run: (e) => e.chain().focus().setNode('heading', { level: 4 }).run() },
  { id: 'h5', title: '标题五', hint: '次级标题', icon: Heading5, run: (e) => e.chain().focus().setNode('heading', { level: 5 }).run() },
  { id: 'h6', title: '标题六', hint: '最小标题', icon: Heading6, run: (e) => e.chain().focus().setNode('heading', { level: 6 }).run() },
  { id: 'p', title: '正文', hint: '普通段落', icon: Type, run: (e) => e.chain().focus().setParagraph().run() },
  { id: 'ul', title: '无序列表', hint: '- 或 * 空格', icon: List, run: (e) => e.chain().focus().toggleBulletList().run() },
  { id: 'ol', title: '有序列表', hint: '1. 空格', icon: ListOrdered, run: (e) => e.chain().focus().toggleOrderedList().run() },
  { id: 'quote', title: '引用', hint: '> 空格', icon: Quote, run: (e) => e.chain().focus().toggleBlockquote().run() },
  { id: 'hr', title: '分割线', hint: '--- · 现代/清爽模板中作为侧栏分界', icon: Minus, run: (e) => e.chain().focus().setHorizontalRule().run() },
  { id: 'code', title: '代码块', hint: '``` 三个反引号', icon: Code2, run: (e) => e.chain().focus().setCodeBlock().run() },
  { id: 'table', title: '表格', hint: '3×3 表格（含表头）', icon: TableIcon, run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
]

/** 模板 → 编辑器画布类名（与预览模板样式共享同一套 tpl-* CSS） */
const TPL_CLASS: Record<TemplateId, string> = {
  minimal: 'tpl-minimal',
  classic: 'tpl-classic',
  modern: 'tpl-modern',
  tech: 'tpl-tech',
  elegant: 'tpl-elegant',
  sleek: 'tpl-sleek',
  business: 'tpl-business',
  pill: 'tpl-pill',
}

/**
 * 块级富文本编辑器（Tiptap / ProseMirror）：
 * - 所见即所得：标题/列表即时渲染，排版样式与预览模板同步
 * - "/" 斜杠命令、选中文本悬浮工具栏、块拖拽手柄
 * - 底层数据为 Tiptap JSON 块数组；切换模板只换样式不动数据
 * - 每个顶层块绑定 data-index，供预览点击反向定位
 */
export const TiptapEditor = forwardRef<EditorHandle, TiptapEditorProps>(function TiptapEditor(
  { initialContent, template, saveState, checking = false, onInit, onDocChange, onAiRequest, onGrammarCheck, onJdMatch, pageMetrics, accentColor },
  ref
) {
  // 稳定回调 ref（避免编辑器实例因闭包变化重建；赋值放 effect，不在渲染期改 ref）
  const onInitRef = useRef(onInit)
  const onDocChangeRef = useRef(onDocChange)
  const onAiRef = useRef(onAiRequest)
  const slashOpenRef = useRef<(pos: number) => void>(() => {})

  useEffect(() => {
    onInitRef.current = onInit
    onDocChangeRef.current = onDocChange
    onAiRef.current = onAiRequest
  })

  // 初始内容：JSON 直用；旧 Markdown 经 scratch editor 转换
  const initialDoc = useMemo<JSONContent | string>(() => {
    const t = initialContent.trim()
    if (t.startsWith('{')) {
      try {
        const parsed = JSON.parse(t)
        if (parsed?.type === 'doc') return parsed as JSONContent
      } catch {
        /* 落到 Markdown 分支 */
      }
    }
    if (!t) return { type: 'doc', content: [{ type: 'paragraph' }] }
    return markdownToDoc(initialContent)
  }, [initialContent])

  const editor = useEditor({
    extensions: createEditorExtensions((pos) => slashOpenRef.current(pos)),
    content: initialDoc,
    onUpdate: ({ editor }) => {
      onDocChangeRef.current(JSON.stringify(editor.getJSON()))
    },
  })

  const scrollRef = useRef<HTMLDivElement>(null)

  /* ---------- 内部状态 ---------- */
  const [hasSelection, setHasSelection] = useState(false)
  const [blockCount, setBlockCount] = useState(0)
  const [bubblePos, setBubblePos] = useState<{ x: number; y: number } | null>(null)
  /** 悬浮工具栏是否展开更多工具行 */
  const [bubbleExpanded, setBubbleExpanded] = useState(false)
  /** 展开后工具栏加宽，钳制水平位置避免溢出屏幕 */
  const bubbleBoxRef = useRef<HTMLDivElement>(null)
  const [bubbleLeft, setBubbleLeft] = useState<number | null>(null)
  const [slash, setSlash] = useState<{ open: boolean; pos: number; x: number; y: number; query: string }>({
    open: false,
    pos: 0,
    x: 0,
    y: 0,
    query: '',
  })
  const [slashActive, setSlashActive] = useState(0)
  /** 预览点击定位 → 块闪烁高亮浮层（可覆盖多个连续块，如 AI 替换区域） */
  const [flashBoxes, setFlashBoxes] = useState<
    { x: number; y: number; w: number; h: number }[] | null
  >(null)
  const flashTimer = useRef<number | undefined>(undefined)

  const showFlash = useCallback((boxes: { x: number; y: number; w: number; h: number }[]) => {
    setFlashBoxes(boxes)
    window.clearTimeout(flashTimer.current)
    flashTimer.current = window.setTimeout(() => setFlashBoxes(null), 1700)
  }, [])
  /** 链接编辑弹窗：null 关闭；prev 记录原 href（空串表示新建链接） */
  const [linkDraft, setLinkDraft] = useState<{ prev: string } | null>(null)
  const [linkUrl, setLinkUrl] = useState('')
  /** Markdown 源码模式：textarea 与块编辑共享同一 JSON（改源码 → 解析回块 → 预览/保存同步） */
  const [sourceMode, setSourceMode] = useState(false)
  const [sourceMd, setSourceMd] = useState('')
  /** 源码防抖提交：切换模式/卸载时 flush，避免丢最后几笔输入 */
  const sourceFlushRef = useRef<{ timer: number; apply: () => void } | null>(null)

  const flushSource = () => {
    const pending = sourceFlushRef.current
    if (pending) {
      window.clearTimeout(pending.timer)
      pending.apply()
      sourceFlushRef.current = null
    }
  }

  const toggleSourceMode = () => {
    if (!editor) return
    if (!sourceMode) {
      // 进入源码：块 JSON → Markdown（与导出 .md 行为一致）
      const storage = editor.storage as unknown as { markdown?: { getMarkdown: () => string } }
      setSourceMd(storage.markdown?.getMarkdown() ?? '')
      setSourceMode(true)
    } else {
      flushSource()
      setSourceMode(false)
    }
  }

  /* 源码输入 → 防抖解析回块文档；emitUpdate=false 避免光标回环，手动同步 docJson */
  const handleSourceChange = (v: string) => {
    setSourceMd(v)
    if (!editor) return
    if (sourceFlushRef.current) window.clearTimeout(sourceFlushRef.current.timer)
    const apply = () => {
      sourceFlushRef.current = null
      editor.commands.setContent(v, false)
      onDocChangeRef.current(JSON.stringify(editor.getJSON()))
    }
    sourceFlushRef.current = { timer: window.setTimeout(apply, 350), apply }
  }

  /* 卸载时提交未落盘的源码输入 */
  useEffect(() => {
    return () => flushSource()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const slashRef = useRef(slash)

  /* 斜杠菜单触发（来自 ProseMirror 插件回调） */
  useEffect(() => {
    if (!editor) return
    slashOpenRef.current = (pos: number) => {
      try {
        const coords = editor.view.coordsAtPos(pos)
        setSlash({ open: true, pos, x: coords.left, y: coords.bottom + 8, query: '' })
        setSlashActive(0)
      } catch {
        /* ignore */
      }
    }
  }, [editor])

  useEffect(() => {
    slashRef.current = slash
  })

  /* ---------- 链接弹窗（替代 window.prompt，选区状态在弹窗期间保持） ---------- */
  const openLinkDialog = () => {
    if (!editor) return
    const prev = (editor.getAttributes('link').href as string | undefined) ?? ''
    setLinkUrl(prev)
    setLinkDraft({ prev })
  }

  const applyLink = (remove: boolean) => {
    if (!editor) return
    const trimmed = linkUrl.trim()
    if (remove || !trimmed) {
      editor.chain().focus().unsetLink().run()
    } else {
      editor.chain().focus().setLink({ href: trimmed }).run()
    }
    setLinkDraft(null)
  }

  /* 初始化回调 + 事务监听（选区/斜杠查询/块计数；data-index 由 Decoration 自动维护） */
  useEffect(() => {
    if (!editor) return
    onInitRef.current(JSON.stringify(editor.getJSON()))
    setBlockCount(editor.state.doc.childCount)

    const onTrans = () => {
      setBlockCount(editor.state.doc.childCount)

      // 选区状态（供工具条按钮 & 悬浮工具栏）
      const { from, to, empty } = editor.state.selection
      const text = empty ? '' : editor.state.doc.textBetween(from, to).trim()
      setHasSelection(!!text)
      if (!text || !editor.isFocused) {
        setBubblePos(null)
      } else {
        try {
          const start = editor.view.coordsAtPos(from)
          const end = editor.view.coordsAtPos(to)
          // 工具栏以选区中心为锚点，钳制在视口内避免左缘溢出
          const x = Math.min(Math.max((start.left + end.left) / 2, 140), window.innerWidth - 140)
          setBubblePos({ x, y: Math.min(start.top, end.top) })
        } catch {
          setBubblePos(null)
        }
      }

      // 斜杠菜单：跟随查询 / 关闭判定
      setSlash((prev) => {
        if (!prev.open) return prev
        const sel = editor.state.selection
        if (sel.from < prev.pos) return { ...prev, open: false }
        const $sel = editor.state.doc.resolve(sel.from)
        const $slash = editor.state.doc.resolve(prev.pos)
        if ($sel.parent !== $slash.parent) return { ...prev, open: false }
        const query = editor.state.doc.textBetween(prev.pos + 1, sel.from, '\n', ' ')
        if (query.length > 20) return { ...prev, open: false }
        if (query === prev.query) return prev
        return { ...prev, query }
      })
    }

    const onBlur = () => {
      // 点击悬浮菜单（preventDefault）不会失焦；真正失焦时隐藏
      window.setTimeout(() => {
        if (!editor.isFocused) setBubblePos(null)
      }, 120)
    }

    editor.on('transaction', onTrans)
    editor.on('selectionUpdate', onTrans)
    editor.on('blur', onBlur)
    return () => {
      editor.off('transaction', onTrans)
      editor.off('selectionUpdate', onTrans)
      editor.off('blur', onBlur)
    }
  }, [editor])

  /* 斜杠菜单外点击关闭 */
  useEffect(() => {
    if (!slash.open) return
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.slash-menu')) {
        setSlash((prev) => ({ ...prev, open: false }))
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [slash.open])

  /* 编辑区滚动：悬浮工具栏直接关闭；斜杠菜单跟随锚点重新定位（滚出可视区才关闭），
     避免 PM 打字时的 caret 自动滚动把刚唤起的菜单瞬间关掉 */
  useEffect(() => {
    const container = scrollRef.current
    if (!container || !editor) return
    const onScroll = () => {
      setBubblePos(null)
      setSlash((prev) => {
        if (!prev.open) return prev
        try {
          const coords = editor.view.coordsAtPos(prev.pos + 1)
          const crect = container.getBoundingClientRect()
          if (coords.top < crect.top - 4 || coords.bottom > crect.bottom + 4) {
            return { ...prev, open: false }
          }
          return { ...prev, x: coords.left, y: coords.bottom + 8 }
        } catch {
          return { ...prev, open: false }
        }
      })
    }
    container.addEventListener('scroll', onScroll, { passive: true })
    return () => container.removeEventListener('scroll', onScroll)
  }, [editor])

  /* 工具栏收起时还原展开状态 */
  useEffect(() => {
    if (!bubblePos) setBubbleExpanded(false)
  }, [bubblePos])

  /* 展开态加宽后按视口钳制水平位置（translateX(-50%) 居中锚点不变） */
  useLayoutEffect(() => {
    if (!bubblePos) {
      setBubbleLeft(null)
      return
    }
    const el = bubbleBoxRef.current
    if (!el) return
    const half = el.offsetWidth / 2
    let left = bubblePos.x
    if (left - half < 8) left = 8 + half
    if (left + half > window.innerWidth - 8) left = window.innerWidth - 8 - half
    setBubbleLeft(left)
  }, [bubblePos, bubbleExpanded])

  /* 斜杠菜单过滤 */
  const filtered = useMemo(() => {
    const q = slash.query.trim().toLowerCase()
    if (!q) return SLASH_ITEMS
    return SLASH_ITEMS.filter(
      (item) => item.title.includes(q) || item.id.includes(q) || item.hint.toLowerCase().includes(q)
    )
  }, [slash.query])

  const activeIdx = Math.min(slashActive, Math.max(filtered.length - 1, 0))

  const runSlashItem = (item: SlashItem) => {
    if (!editor) return
    const to = editor.state.selection.from
    editor.chain().focus().deleteRange({ from: slashRef.current.pos, to }).run()
    item.run(editor)
    setSlash((prev) => ({ ...prev, open: false }))
  }

  /* 键盘：斜杠菜单导航 */
  const handleKeyCapture = (e: React.KeyboardEvent) => {
    if (!slash.open || filtered.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      e.stopPropagation()
      setSlashActive((i) => (i + 1) % filtered.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      e.stopPropagation()
      setSlashActive((i) => (i - 1 + filtered.length) % filtered.length)
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      e.stopPropagation()
      runSlashItem(filtered[activeIdx])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setSlash((prev) => ({ ...prev, open: false }))
    }
  }

  /* ---------- 暴露给父组件的命令 ---------- */
  useImperativeHandle(
    ref,
    () => ({
      scrollToBlock: (index: number) => {
        // 从活 DOM 按 data-index 定位（Decoration 保证属性存在），不依赖 editor 实例
        const container = scrollRef.current
        if (!container) return
        const el = container.querySelector<HTMLElement>(`.ProseMirror > [data-index="${index}"]`)
        if (!el) return
        el.scrollIntoView({ block: 'center' })
        // 闪烁高亮：React 浮层实现，避免手动改 PM 元素 class 被 MutationObserver 重置
        const rect = el.getBoundingClientRect()
        showFlash([{ x: rect.left, y: rect.top, w: rect.width, h: rect.height }])
      },
      getSelectionBlockMarkdown: () => {
        if (!editor) return null
        const { from, to, empty } = editor.state.selection
        if (empty) return null
        // 选区对齐到完整顶层块：跨块润色时列表/标题结构才不会丢
        const $from = editor.state.doc.resolve(from)
        const $to = editor.state.doc.resolve(to)
        const range = { from: $from.before(1), to: $to.after(1) }
        const blockDoc = editor.state.doc.cut(range.from, range.to)
        return { markdown: docToMarkdown(blockDoc.toJSON()), range }
      },
      replaceRangeMarkdown: (range: DocRange, md: string) => {
        if (!editor) return
        const nodes = markdownToDoc(md).content ?? []
        const oldSize = editor.state.doc.content.size
        if (nodes.length === 1 && nodes[0].type === 'paragraph') {
          // 单段落：按行内内容替换，保留被替换块自身的块类型
          editor.chain().focus().insertContentAt(range, nodes[0].content ?? []).run()
        } else {
          editor.chain().focus().insertContentAt(range, nodes).run()
        }
        /* AI 替换后闪烁整个被修改区域：按文档尺寸变化推算替换后范围，
           收集覆盖到的顶层块 DOM 矩形（一眼看到 AI 改了哪里） */
        const container = scrollRef.current
        if (!container) return
        const delta = editor.state.doc.content.size - oldSize
        const newEnd = range.to + delta
        const boxes: { x: number; y: number; w: number; h: number }[] = []
        const firstElRef: { current: HTMLElement | null } = { current: null }
        let idx = 0
        editor.state.doc.forEach((node, offset) => {
          const hit = offset + node.nodeSize > range.from && offset < newEnd
          if (hit) {
            const el = container.querySelector<HTMLElement>(
              `.ProseMirror > [data-index="${idx}"]`
            )
            if (el) {
              if (!firstElRef.current) firstElRef.current = el
              const r = el.getBoundingClientRect()
              boxes.push({ x: r.left, y: r.top, w: r.width, h: r.height })
            }
          }
          idx++
        })
        firstElRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
        if (boxes.length) showFlash(boxes)
      },
      findRangeByText: (text: string) => {
        if (!editor) return null
        const target = text.trim()
        if (!target) return null
        /* 三级匹配（逐块）：
           1. 纯文本精确包含；2. Markdown 语法剥离后包含（AI 锚点带 - / ** 等源码符号时）；
           3. 片段首尾各截 12 字的归一化子串（AI 对原文有轻微润色时仍可定位） */
        const norm = stripMdSyntax
        const targetN = norm(target)
        const headN = targetN.slice(0, 12)
        const tailN = targetN.slice(-12)
        let result: { range: DocRange; markdown: string } | null = null
        editor.state.doc.forEach((node, offset) => {
          if (result) return
          const t = node.textContent
          const tN = norm(t)
          const hit =
            t.includes(target) || tN.includes(targetN) || (targetN.length >= 24 && tN.includes(headN) && tN.includes(tailN))
          if (hit) {
            result = {
              range: { from: offset, to: offset + node.nodeSize },
              markdown: docToMarkdown({ type: 'doc', content: [node.toJSON()] }),
            }
          }
        })
        return result
      },
      getMarkdown: () => {
        if (!editor) return ''
        return (
          (editor.storage as unknown as { markdown?: { getMarkdown: () => string } }).markdown?.getMarkdown() ?? ''
        )
      },
      setDocFromMarkdown: (md: string) => {
        editor?.commands.setContent(md, true)
      },
      setDocJson: (json: string) => {
        if (!editor) return
        try {
          const parsed = JSON.parse(json)
          editor.commands.setContent(parsed, false)
          onDocChangeRef.current(JSON.stringify(editor.getJSON()))
        } catch {
          /* 畸形快照：忽略 */
        }
      },
    }),
    [editor, showFlash]
  )
  const tplClass = TPL_CLASS[template] ?? 'tpl-minimal'

  // 斜杠菜单防溢出
  const slashMenuY = slash.y + 308 > window.innerHeight ? slash.y - 316 : slash.y

  return (
    <div className="flex h-full min-w-0 flex-col bg-background">
      {/* 工具条 */}
      <div className="flex h-11 shrink-0 items-center justify-between border-b px-3">
        <div className="flex items-center gap-1.5">
          <span className="mr-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            块编辑器
          </span>
          {editor && (
            <>
              <button
                type="button"
                title="撤销（Ctrl+Z）"
                aria-label="撤销"
                disabled={!editor.can().undo()}
                onClick={() => editor.chain().focus().undo().run()}
                className="inline-flex size-7 items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-35"
              >
                <Undo2 className="size-3.5" />
              </button>
              <button
                type="button"
                title="重做（Ctrl+Y）"
                aria-label="重做"
                disabled={!editor.can().redo()}
                onClick={() => editor.chain().focus().redo().run()}
                className="inline-flex size-7 items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-35"
              >
                <Redo2 className="size-3.5" />
              </button>
            </>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                disabled={!hasSelection}
                title={!hasSelection ? '先选中要处理的文本' : undefined}
                className="inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs text-primary transition-colors hover:bg-primary/10 disabled:pointer-events-none disabled:opacity-45"
              >
                <Sparkles className="size-3.5" /> AI 助手
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              {AI_MODES.map((m) => (
                <DropdownMenuItem key={m.id} className="gap-2" onClick={() => onAiRef.current(m.id)}>
                  <div className="flex flex-col">
                    <span className="text-[13px] leading-tight">{m.title}</span>
                    <span className="text-[11px] leading-tight text-muted-foreground">{m.desc}</span>
                  </div>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button2
            disabled={checking}
            onClick={onGrammarCheck}
            label="语法检查"
            icon={
              checking ? <Loader2 className="size-3.5 animate-spin" /> : <SpellCheck2 className="size-3.5" />
            }
          />
          {onJdMatch && (
            <Button2 onClick={onJdMatch} label="JD 匹配" icon={<ScanSearch className="size-3.5" />} />
          )}
          <Button2
            onClick={toggleSourceMode}
            label="源码"
            accent={sourceMode}
            icon={<FileCode2 className="size-3.5" />}
          />
        </div>
        <span
          className={cn(
            'flex items-center gap-1.5 text-xs',
            saveState === 'saved' ? 'text-muted-foreground' : 'text-primary'
          )}
        >
          {saveState === 'saving' ? (
            <>
              <Loader2 className="size-3 animate-spin" /> 保存中…
            </>
          ) : saveState === 'dirty' ? (
            <>
              <span className="size-1.5 rounded-full bg-primary" /> 待保存
            </>
          ) : (
            <>
              <CircleCheck className="size-3" /> 已保存
            </>
          )}
        </span>
      </div>

      {/* 编辑区（块级 WYSIWYG 画布）；水平内边距留出拖拽手柄槽位，避免手柄被窗口边缘裁切。
          主题色覆盖内联在 tpl-* 元素本身——模板类在自身上定义 --rs-accent，祖先覆盖无效 */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto bg-muted/40 px-6 scrollbar-thin dark:bg-black/30"
      >
        {sourceMode ? (
          /* Markdown 源码模式：与块编辑共享同一 JSON，输入防抖同步预览与自动保存 */
          <textarea
            value={sourceMd}
            onChange={(e) => handleSourceChange(e.target.value)}
            spellCheck={false}
            data-testid="source-editor"
            placeholder="# 姓名&#10;&#10;## 教育背景&#10;&#10;### 某大学 · 专业 · 本科 | 2015.09 - 2019.06&#10;&#10;- 条目…"
            className="mx-auto my-6 block h-[calc(100%-3rem)] min-h-[400px] w-full max-w-[720px] resize-none rounded-md border bg-card p-5 font-mono text-[13px] leading-relaxed text-foreground shadow-sm outline-none placeholder:text-muted-foreground/60"
          />
        ) : (
          <div
            className={cn(
              'editor-canvas mx-auto my-6 w-full max-w-[720px] rounded-md border bg-card px-4 py-2 shadow-sm',
              tplClass
            )}
            style={accentColor ? ({ ['--rs-accent']: accentColor } as CSSProperties) : undefined}
            onKeyDownCapture={handleKeyCapture}
          >
            <EditorContent editor={editor} />
          </div>
        )}
      </div>

      {/* 状态栏 */}
      <div className="flex h-7 shrink-0 items-center justify-between border-t bg-muted/30 px-3 text-[11px] text-muted-foreground">
        <span className="min-w-0 truncate">
          {sourceMode
            ? '源码模式：Markdown 实时同步预览与自动保存，点「源码」切回块编辑'
            : '# 标题 · - 列表 · 1. 编号 · > 引用 · --- 分割线 · **加粗** · 直接打 Markdown 即时转换'}
        </span>
        <span className="ml-2 flex shrink-0 items-center gap-2">
          {pageMetrics &&
            (pageMetrics.pageCount > 1 ? (
              <span
                className="font-medium text-amber-600 dark:text-amber-400"
                title={
                  pageMetrics.smartOnePage
                    ? '内容较多，已保留多页排版：可精简内容，或关闭「智能一页」手动调整'
                    : '开启「智能一页」可自动压缩至恰好一页'
                }
              >
                内容 {pageMetrics.pageCount} 页{pageMetrics.smartOnePage ? '' : ' · 可开启智能一页'}
              </span>
            ) : pageMetrics.smartOnePage && pageMetrics.density > 0 ? (
              <span title="智能一页已收紧排版密度，恰好一页">已压缩至 1 页 · 密度档 {pageMetrics.density}</span>
            ) : (
              <span>1 页</span>
            ))}
          <span className="font-mono">{blockCount} 块</span>
        </span>
      </div>

      {/* 悬浮工具栏（选中文本）：主行 + 可展开的更多工具行 */}
      {bubblePos && editor && (
        <div
          ref={bubbleBoxRef}
          className={cn('bubble-toolbar', bubbleExpanded && 'stack')}
          style={{ left: bubbleLeft ?? bubblePos.x, top: bubblePos.y - 44 }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="bt-row">
            <button
              className={editor.isActive('bold') ? 'active' : ''}
              title="加粗（**粗**）"
              onClick={() => editor.chain().focus().toggleBold().run()}
            >
              <Bold className="size-3.5" />
            </button>
            <button
              className={editor.isActive('italic') ? 'active' : ''}
              title="斜体（*斜*）"
              onClick={() => editor.chain().focus().toggleItalic().run()}
            >
              <Italic className="size-3.5" />
            </button>
            <button
              className={editor.isActive('strike') ? 'active' : ''}
              title="删除线（~~删~~）"
              onClick={() => editor.chain().focus().toggleStrike().run()}
            >
              <Strikethrough className="size-3.5" />
            </button>
            <button
              className={editor.isActive('code') ? 'active' : ''}
              title="行内代码（`码`）"
              onClick={() => editor.chain().focus().toggleCode().run()}
            >
              <Code2 className="size-3.5" />
            </button>
            <span className="bt-sep" />
            <button
              className={editor.isActive('heading', { level: 1 }) ? 'active' : ''}
              title="转为标题一"
              onClick={() => editor.chain().focus().toggleNode('heading', 'paragraph', { level: 1 }).run()}
            >
              <Heading1 className="size-3.5" />
            </button>
            <button
              className={editor.isActive('heading', { level: 2 }) ? 'active' : ''}
              title="转为标题二"
              onClick={() => editor.chain().focus().toggleNode('heading', 'paragraph', { level: 2 }).run()}
            >
              <Heading2 className="size-3.5" />
            </button>
            <button
              className={editor.isActive('heading', { level: 3 }) ? 'active' : ''}
              title="转为标题三"
              onClick={() => editor.chain().focus().toggleNode('heading', 'paragraph', { level: 3 }).run()}
            >
              <Heading3 className="size-3.5" />
            </button>
            <span className="bt-sep" />
            {bubbleExpanded ? (
              <button title="收起" onClick={() => setBubbleExpanded(false)}>
                <ChevronUp className="size-3.5" />
              </button>
            ) : (
              <button title="更多工具" onClick={() => setBubbleExpanded(true)}>
                <MoreHorizontal className="size-3.5" />
              </button>
            )}
            <span className="bt-sep" />
            <button className="bt-ai" title="AI 润色选中内容" onClick={() => onAiRef.current('polish')}>
              <Sparkles className="size-3.5" /> AI 润色
            </button>
          </div>

          {bubbleExpanded && (
            <div className="bt-row">
              <button
                className={editor.isActive('bulletList') ? 'active' : ''}
                title="无序列表"
                onClick={() => editor.chain().focus().toggleBulletList().run()}
              >
                <List className="size-3.5" />
              </button>
              <button
                className={editor.isActive('orderedList') ? 'active' : ''}
                title="有序列表"
                onClick={() => editor.chain().focus().toggleOrderedList().run()}
              >
                <ListOrdered className="size-3.5" />
              </button>
              <button
                className={editor.isActive('blockquote') ? 'active' : ''}
                title="引用"
                onClick={() => editor.chain().focus().toggleBlockquote().run()}
              >
                <Quote className="size-3.5" />
              </button>
              <span className="bt-sep" />
              <button
                title={editor.isActive('link') ? '编辑链接' : '插入链接'}
                onClick={openLinkDialog}
              >
                <Link2 className="size-3.5" />
              </button>
              <button
                title="清除格式"
                onClick={() => editor.chain().focus().unsetAllMarks().run()}
              >
                <Eraser className="size-3.5" />
              </button>
              <span className="bt-sep" />
              {AI_MODES.filter((m) => m.id !== 'polish').map((m) => (
                <button
                  key={m.id}
                  className="bt-ai-mini"
                  title={m.desc}
                  onClick={() => onAiRef.current(m.id)}
                >
                  {m.title}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 斜杠命令菜单 */}
      {slash.open && filtered.length > 0 && (
        <div className="slash-menu" style={{ left: slash.x, top: slashMenuY }}>
          {filtered.map((item, i) => (
            <button
              key={item.id}
              className={cn('slash-item', i === activeIdx && 'active')}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => runSlashItem(item)}
              onMouseEnter={() => setSlashActive(i)}
            >
              <span className="slash-icon">
                <item.icon className="size-4" />
              </span>
              <span className="flex flex-col">
                <span className="text-[13px] leading-tight">{item.title}</span>
                <span className="slash-hint">{item.hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      {slash.open && filtered.length === 0 && (
        <div className="slash-menu" style={{ left: slash.x, top: slashMenuY }}>
          <div className="slash-empty">没有匹配的块类型</div>
        </div>
      )}

      {/* 块定位/替换区域闪烁浮层（React 层实现，不触碰 PM 托管 DOM） */}
      {flashBoxes?.map((b, i) => (
        <div
          key={i}
          className="block-flash-overlay"
          style={{ left: b.x, top: b.y, width: b.w, height: b.h }}
        />
      ))}

      {/* 链接编辑弹窗 */}
      <Dialog open={linkDraft !== null} onOpenChange={(open) => !open && setLinkDraft(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{linkDraft?.prev ? '编辑链接' : '插入链接'}</DialogTitle>
            <DialogDescription>留空并确定则移除选中文字上的链接。</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                applyLink(false)
              }
            }}
            placeholder="https://"
          />
          <DialogFooter className="gap-2 sm:gap-0">
            {linkDraft?.prev && (
              <Button variant="outline" size="sm" onClick={() => applyLink(true)}>
                移除链接
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setLinkDraft(null)}>
              取消
            </Button>
            <Button size="sm" onClick={() => applyLink(false)}>
              确定
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 拖拽手柄层 + 表格操作浮层 */}
      {editor && <DragHandleLayer editor={editor} containerRef={scrollRef} />}
      {editor && <TableMenu editor={editor} />}
    </div>
  )
})

/* 工具条小按钮（保持原 Editor 工具条视觉） */
function Button2({
  label,
  sub,
  icon,
  disabled,
  onClick,
  accent,
}: {
  label: string
  sub?: string
  icon: React.ReactNode
  disabled?: boolean
  onClick?: () => void
  accent?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors disabled:pointer-events-none disabled:opacity-45',
        accent
          ? 'text-primary hover:bg-primary/10'
          : 'text-foreground hover:bg-accent hover:text-accent-foreground'
      )}
    >
      {icon}
      {label}
      {sub && <span className="text-muted-foreground">{sub}</span>}
    </button>
  )
}
