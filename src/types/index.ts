export type TemplateId =
  | 'minimal'
  | 'classic'
  | 'modern'
  | 'tech'
  | 'elegant'
  | 'sleek'
  | 'business'
  | 'pill'

export interface Resume {
  id?: number
  title: string
  /** Tiptap JSON 字符串（块级文档模型）；旧版数据为 Markdown，加载时自动迁移 */
  content: string
  template: TemplateId
  /** 证件照（压缩后的 dataURL，仅存本机） */
  photo?: string
  /** 证件照缩放倍数（相对基础尺寸，拖拽手柄调整） */
  photoScale?: number
  /** 证件照相对默认位置的像素偏移（预览中拖拽移动） */
  photoPos?: { dx: number; dy: number }
  createdAt: number
  updatedAt: number
}

export type ThemeMode = 'light' | 'dark'

/** 手动排版档位：标准 / 紧凑 / 宽松（用户固定偏好；智能一页在其上自动收紧） */
export type LayoutMode = 'standard' | 'compact' | 'loose'

export interface AppSettings {
  theme: ThemeMode
  aiBaseUrl: string
  aiApiKey: string
  aiModel: string
  /** AI 模型多配置档（保存的多套 Base URL / Key / 模型） */
  aiProfiles?: AiProfile[]
  /** 当前启用的 AI 配置档 id */
  activeProfileId?: string
  /** 编辑器/预览 分栏占比（左侧，0-1） */
  splitRatio: number
  /** 智能一页：内容超一页时自动缩放至恰好一页 */
  smartOnePage: boolean
  /** 主题色覆盖（作用到模板的 --rs-accent）；空 = 跟随模板默认 */
  accentColor?: string
  /** 手动排版档位 */
  layout: LayoutMode
}

/** AI 模型配置档 */
export interface AiProfile {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  model: string
}

/** 语法检查返回的单条建议 */
export interface GrammarSuggestion {
  original: string
  suggestion: string
  reason: string
}

/** AI 对话响应的统一结构 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export const TEMPLATES: {
  id: TemplateId
  name: string
  description: string
  /** 列表页模板色点 */
  dotClass: string
  /** 头部模板选择器色块（含边框） */
  chipClass: string
}[] = [
  {
    id: 'minimal',
    name: '简约',
    description: '无衬线极简 · 黑白留白',
    dotClass: 'bg-gray-300',
    chipClass: 'border-gray-300 bg-white',
  },
  {
    id: 'classic',
    name: '经典',
    description: '衬线排印 · 传统正式',
    dotClass: 'bg-[#1f3864]',
    chipClass: 'border-[#1f3864]/40 bg-[#1f3864]',
  },
  {
    id: 'modern',
    name: '现代',
    description: '深色侧栏 · 双栏布局',
    dotClass: 'bg-[#10262e]',
    chipClass: 'border-cyan-700/40 bg-[#10262e]',
  },
  {
    id: 'tech',
    name: '标准',
    description: '单栏黑白 · 高密度 · ATS 友好',
    dotClass: 'bg-gray-800',
    chipClass: 'border-gray-800/40 bg-gray-800',
  },
  {
    id: 'elegant',
    name: '雅致',
    description: '翡翠绿强调 · 大节标题 · 层次分明',
    dotClass: 'bg-[#00a388]',
    chipClass: 'border-[#00a388]/40 bg-[#00a388]',
  },
  {
    id: 'sleek',
    name: '清爽',
    description: '浅色双栏 · 天蓝强调 · 明快分区',
    dotClass: 'bg-[#0395de]',
    chipClass: 'border-[#0395de]/40 bg-[#0395de]',
  },
  {
    id: 'business',
    name: '商务',
    description: '蓝色商务风 · 竖条节标题 · 国内主流',
    dotClass: 'bg-[#2d6cdf]',
    chipClass: 'border-[#2d6cdf]/40 bg-[#2d6cdf]',
  },
  {
    id: 'pill',
    name: '胶囊',
    description: '顶部色带 · 居中胶囊标题 · 国内 Markdown 风',
    dotClass: 'bg-[#3b82f6]',
    chipClass: 'border-[#3b82f6]/40 bg-[#3b82f6]',
  },
]

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'light',
  // OpenAI 兼容网关，默认指向通义千问官方 DashScope 兼容端点
  aiBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  aiApiKey: '',
  aiModel: 'qwen-plus',
  aiProfiles: [],
  splitRatio: 0.42,
  smartOnePage: true,
  layout: 'standard',
}
