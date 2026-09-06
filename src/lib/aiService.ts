import type { ChatMessage, GrammarSuggestion } from '@/types'

/**
 * AI 服务层：统一负责 API Key 校验与 OpenAI 兼容 Chat Completions 调用。
 * 所有请求由前端直发大模型网关，无后端中转。
 */

export interface AIError extends Error {
  code: 'NO_KEY' | 'BAD_URL' | 'HTTP' | 'NETWORK' | 'PARSE'
  status?: number
}

function aiError(code: AIError['code'], message: string, status?: number): AIError {
  const err = new Error(message) as AIError
  err.code = code
  err.status = status
  return err
}

export interface AIConfig {
  baseUrl: string
  apiKey: string
  model: string
}

/** 校验配置是否可用（用于 UI 提示，不抛异常） */
export function validateAIConfig(config: AIConfig): { ok: boolean; message?: string } {
  if (!config.apiKey.trim()) {
    return { ok: false, message: '尚未配置 API Key，请前往设置页填写' }
  }
  try {
    new URL(config.baseUrl.trim())
  } catch {
    return { ok: false, message: 'Base URL 格式不正确，示例：https://dashscope.aliyuncs.com/compatible-mode/v1' }
  }
  if (!config.model.trim()) {
    return { ok: false, message: '未指定模型名称' }
  }
  return { ok: true }
}

export interface ChatOptions {
  temperature?: number
  /** 首字节超时：发出请求后等待第一个响应分片的时长 */
  firstByteMs?: number
  /** 空闲超时：流式过程中两个分片之间的最大间隔 */
  idleMs?: number
  /** 流式回调：每收到增量内容触发（参数为到目前为止的完整文本） */
  onDelta?: (partial: string) => void
}

/**
 * 调用 Chat Completions，返回首个 choice 的文本内容。
 * 使用流式（stream: true）：首 token 几秒内返回，之后只要持续有增量就不会超时——
 * 生成长文不再受总时长限制；网关不支持流式时自动退回整体读取。
 */
export async function chatCompletion(
  config: AIConfig,
  messages: ChatMessage[],
  options: ChatOptions = {}
): Promise<string> {
  const check = validateAIConfig(config)
  if (!check.ok) throw aiError('NO_KEY', check.message!)

  let url: string
  try {
    url = new URL(config.baseUrl.trim()).toString()
  } catch {
    throw aiError('BAD_URL', 'Base URL 格式不正确')
  }
  // 兼容用户填根路径或带 /v1 的情况：统一拼到 /chat/completions
  if (!/\/chat\/completions\/?$/.test(url)) {
    url = url.replace(/\/+$/, '') + '/chat/completions'
  }

  const firstByteMs = options.firstByteMs ?? 45_000
  const idleMs = options.idleMs ?? 120_000
  const controller = new AbortController()
  let timer: number | undefined
  const arm = (ms: number) => {
    if (timer) window.clearTimeout(timer)
    timer = window.setTimeout(() => controller.abort(), ms)
  }
  const disarm = () => {
    if (timer) window.clearTimeout(timer)
    timer = undefined
  }
  const send = (stream: boolean) => {
    arm(firstByteMs)
    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey.trim()}`,
      },
      body: JSON.stringify({
        model: config.model.trim(),
        messages,
        temperature: options.temperature ?? 0.4,
        stream,
      }),
      signal: controller.signal,
    })
  }

  let res: Response
  try {
    res = await send(true)
    // 少数网关不支持流式（400/422）：退回非流式重试一次
    if (!res.ok && (res.status === 400 || res.status === 422)) {
      res = await send(false)
    }
  } catch (e) {
    disarm()
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw aiError('NETWORK', '连接模型超时：长时间未收到响应，请稍后重试或更换更快的模型')
    }
    throw aiError('NETWORK', '网络请求失败，请检查 Base URL 与网络连接')
  }

  if (!res.ok) {
    disarm()
    let detail = ''
    try {
      const body = await res.json()
      detail = body?.error?.message ?? ''
    } catch {
      /* 忽略解析失败 */
    }
    const hint =
      res.status === 401 || res.status === 403
        ? 'API Key 无效或无权限'
        : res.status === 404
          ? '接口路径不存在，请检查 Base URL（一般以 /v1 结尾）'
          : res.status === 429
            ? '请求过于频繁，请稍后再试'
            : `服务返回 ${res.status}`
    throw aiError('HTTP', detail ? `${hint}：${detail}` : hint, res.status)
  }

  const contentType = res.headers.get('content-type') ?? ''
  if (!res.body || contentType.includes('application/json')) {
    // 明确的 JSON 响应：整体读取。
    // 注意不以此判定流式——部分网关的 SSE 不带标准 content-type，交给下方流式解析兜底
    arm(idleMs)
    try {
      const data = await res.json()
      const content = data?.choices?.[0]?.message?.content
      if (typeof content !== 'string') throw aiError('PARSE', '模型返回格式异常，请重试')
      options.onDelta?.(content)
      return content
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        throw aiError('NETWORK', '读取模型响应超时，请稍后重试')
      }
      throw e
    } finally {
      disarm()
    }
  }

  // 流式解析：不苛求 content-type。若整个流没有任何 data: 行，末尾再按普通 JSON 兜底
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let raw = ''
  let content = ''
  let sawData = false
  let finished = false
  arm(idleMs)
  const processLine = (line: string): boolean => {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) return false
    sawData = true
    const payload = trimmed.slice(5).trim()
    if (payload === '[DONE]') return true
    try {
      const json = JSON.parse(payload)
      const delta = json?.choices?.[0]?.delta?.content
      if (typeof delta === 'string' && delta) {
        content += delta
        options.onDelta?.(content)
      }
    } catch {
      /* 忽略无法解析的行（如注释或分片跨界） */
    }
    return false
  }
  try {
    while (!finished) {
      const { done, value } = await reader.read()
      if (done) break
      arm(idleMs)
      const text = decoder.decode(value, { stream: true })
      raw += text
      buffer += text
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (processLine(line)) {
          finished = true
          break
        }
      }
    }
    // 流结束：冲刷解码器尾包并处理缓冲区残留的最后一行
    const tail = decoder.decode()
    if (tail) {
      raw += tail
      buffer += tail
    }
    if (!finished && buffer && processLine(buffer)) finished = true
  } catch (e) {
    disarm()
    if (e instanceof DOMException && e.name === 'AbortError') {
      if (content) {
        // 中断时保留已生成的部分，避免整段作废
        options.onDelta?.(content)
        return content
      }
      throw aiError('NETWORK', '模型响应中断：长时间没有新内容，请重试')
    }
    throw e
  }
  disarm()
  if (!sawData) {
    // content-type 不标准且没有 SSE data 行：网关实际返回了普通 JSON
    try {
      const data = JSON.parse(raw)
      const full = data?.choices?.[0]?.message?.content
      if (typeof full === 'string' && full) {
        options.onDelta?.(full)
        return full
      }
    } catch {
      /* 落到下方空结果错误 */
    }
  }
  if (!content) throw aiError('PARSE', '模型返回了空结果，请重试')
  return content
}

/* ============================================================
 * 高层能力
 * ============================================================ */

/** AI 助手模式 */
export type AiMode = 'polish' | 'optimize' | 'condense' | 'layout' | 'ask'

export const AI_MODES: { id: AiMode; title: string; desc: string }[] = [
  { id: 'polish', title: '润色', desc: '更专业的表达，结构与原意不变' },
  { id: 'optimize', title: '优化', desc: '强化量化成果，条目可增删合并' },
  { id: 'condense', title: '精简', desc: '压缩篇幅至 50%~70%，保留关键信息' },
  { id: 'layout', title: '排版', desc: '规范层级与条目格式，重点前置' },
  { id: 'ask', title: '提问 / 要求', desc: '输入任意指令处理选中内容' },
]

export function aiModeTitle(mode: AiMode): string {
  return AI_MODES.find((m) => m.id === mode)?.title ?? 'AI 助手'
}

/** 结构保持条款：所有模式共用，保证替换回文档后格式不丢 */
const STRUCTURE_RULE =
  '严格保持所有 Markdown 块级结构不变：列表保持列表、标题保持原有层级、加粗与链接等行内语法原样保留，' +
  '不要合并、拆分或改变任何块的类型。只输出处理后的 Markdown 片段本身，不要任何解释、前后缀或代码围栏。'

/** 按 AI 助手模式处理 Markdown 片段；ask 模式附带用户自定义指令 */
export async function aiAssist(
  config: AIConfig,
  mode: AiMode,
  selected: string,
  instruction?: string,
  options: { onDelta?: (partial: string) => void } = {}
): Promise<string> {
  let system: string
  switch (mode) {
    case 'polish':
      system =
        '你是一位资深简历顾问。请润色用户给出的简历 Markdown 片段：' +
        '让表达更专业、动词更有力、量化成果更突出、删去冗余词，保持原意与语言（中/英文）不变。'
      break
    case 'optimize':
      system =
        '你是一位资深简历顾问。请优化用户给出的简历 Markdown 片段的表达：' +
        '用词更专业精准、突出可量化的成果、修正语病与搭配不当、强化以动词开头的条目；条目可适当增删合并。'
      break
    case 'condense':
      system =
        '请精简用户给出的简历 Markdown 片段：删除冗余词句与重复信息，合并同义表达，' +
        '把总长度压缩到原来的 50%~70%，同时保留全部关键信息与量化数据。'
      break
    case 'layout':
      system =
        '你是一位简历排版专家。请在不增删事实内容的前提下重新排版用户给出的简历 Markdown 片段：' +
        '规范标题层级、统一列表条目格式（每条以动词或名词短语开头）、把最重要的条目前置、修正中英文之间的空格与标点。'
      break
    case 'ask':
      system =
        '你是简历助手。用户会给出一段简历 Markdown 片段和一条处理指令，请严格按指令处理。' +
        '只输出处理后的 Markdown 片段本身，不要任何解释、前后缀或代码围栏，并保证片段可作为合法 Markdown 渲染。'
      break
  }
  if (mode !== 'ask') system += STRUCTURE_RULE

  const user =
    mode === 'ask'
      ? `${(instruction ?? '').trim() || '请优化这段内容'}\n\n---\n\n${selected}`
      : selected

  const raw = await chatCompletion(
    config,
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    { temperature: mode === 'condense' ? 0.3 : 0.4, onDelta: options.onDelta }
  )
  return stripFence(raw.trim())
}

/** 整份简历语法/表达检查，返回建议列表（流式接收，不设总时长限制） */
export async function checkGrammar(
  config: AIConfig,
  fullMarkdown: string,
  options: { onDelta?: (partial: string) => void } = {}
): Promise<GrammarSuggestion[]> {
  const system =
    '你是一位简历审校专家。请检查用户简历 Markdown 全文中的错别字、语病、标点误用、' +
    '日期格式不一致、中英文混排空格问题，以及表达不专业的句子。' +
    '以 JSON 数组输出，每个元素形如 {"original":"有问题的原文片段","suggestion":"修改建议","reason":"理由"}，' +
    'original 必须是原文中逐字存在的连续片段。若没有问题输出 []。' +
    '只输出 JSON 数组本身，不要代码围栏和解释。'
  const raw = await chatCompletion(
    config,
    [
      { role: 'system', content: system },
      { role: 'user', content: fullMarkdown },
    ],
    { temperature: 0.1, firstByteMs: 60_000, idleMs: 150_000, onDelta: options.onDelta }
  )
  return parseSuggestions(stripFence(raw.trim()), fullMarkdown)
}

/* ---------- 内部工具 ---------- */

/** 剥离模型可能强加的 ```json 围栏 */
function stripFence(text: string): string {
  const m = text.match(/^```(?:json|markdown|md)?\s*\n([\s\S]*?)\n?```$/)
  return m ? m[1].trim() : text
}

function parseSuggestions(raw: string, source: string): GrammarSuggestion[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // 尝试提取首个 JSON 数组
    const m = raw.match(/\[[\s\S]*\]/)
    if (!m) throw aiError('PARSE', '模型返回内容无法解析为建议列表，请重试')
    try {
      parsed = JSON.parse(m[0])
    } catch {
      throw aiError('PARSE', '模型返回内容无法解析为建议列表，请重试')
    }
  }
  if (!Array.isArray(parsed)) throw aiError('PARSE', '模型返回格式异常，请重试')

  return parsed
    .filter(
      (s): s is GrammarSuggestion =>
        !!s &&
        typeof s === 'object' &&
        typeof (s as GrammarSuggestion).original === 'string' &&
        typeof (s as GrammarSuggestion).suggestion === 'string' &&
        typeof (s as GrammarSuggestion).reason === 'string'
    )
    .filter((s) => source.includes(s.original)) // 过滤幻觉片段
}

/** 提取 AI 错误的可读文案 */
export function aiErrorMessage(e: unknown): string {
  if (e instanceof Error && 'code' in e) {
    const err = e as AIError
    if (err.code === 'NO_KEY') return err.message
  }
  return e instanceof Error ? e.message : 'AI 调用失败，请重试'
}
