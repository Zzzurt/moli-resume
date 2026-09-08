import type { ChatMessage, GrammarSuggestion } from '@/types'

/**
 * AI 服务层：统一负责 API Key 校验与 OpenAI 兼容 Chat Completions 调用。
 * 所有请求由前端直发大模型网关，无后端中转。
 */

export interface AIError extends Error {
  code: 'NO_KEY' | 'BAD_URL' | 'HTTP' | 'NETWORK' | 'PARSE' | 'ABORTED'
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
  /** 外部中止信号（如用户点击「停止」）：中止时抛出 ABORTED 错误 */
  signal?: AbortSignal
  /** 用户中止时若已生成部分内容：true = 返回已生成部分（文本改写类能力），false/缺省 = 抛 ABORTED（结构化 JSON 类能力） */
  keepPartialOnAbort?: boolean
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
  /** 用户主动中止（区别于超时中断）：UI 据此展示「已停止」而非报错 */
  let userAborted = false
  if (options.signal) {
    if (options.signal.aborted) {
      userAborted = true
      controller.abort()
    } else {
      options.signal.addEventListener(
        'abort',
        () => {
          userAborted = true
          controller.abort()
        },
        { once: true }
      )
    }
  }
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
      if (userAborted) throw aiError('ABORTED', '已停止生成')
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
        if (userAborted) throw aiError('ABORTED', '已停止生成')
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
      if (userAborted) {
        // 文本改写类能力：中止时返回已生成部分，用户可确认后应用
        if (content && options.keepPartialOnAbort) {
          options.onDelta?.(content)
          return content
        }
        throw aiError('ABORTED', '已停止生成')
      }
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
  options: { onDelta?: (partial: string) => void; signal?: AbortSignal } = {}
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
    {
      temperature: mode === 'condense' ? 0.3 : 0.4,
      onDelta: options.onDelta,
      signal: options.signal,
      keepPartialOnAbort: true, // 文本改写：中止时保留已生成部分，确认后仍可应用
    }
  )
  return stripFence(raw.trim())
}

/** JD 匹配分析的结构化结果 */
export interface JdSuggestion {
  /** 简历中逐字存在的原文片段（定位锚点，限定单个段落/条目内） */
  original: string
  /** 交给 AI 提问模式的改写指令 */
  instruction: string
  /** 建议理由（为什么这样改） */
  reason: string
}

export interface JdReport {
  summary: string
  covered: string[]
  gaps: { text: string; severity: string }[]
  suggestions: JdSuggestion[]
}

/** JD 匹配分析：对照职位描述分析整份简历，返回结构化报告（流式） */
export async function jdAnalyze(
  config: AIConfig,
  fullMarkdown: string,
  jd: string,
  options: { onDelta?: (partial: string) => void; signal?: AbortSignal } = {}
): Promise<JdReport> {
  const system =
    '你是一位资深招聘顾问。请对照职位描述分析用户的简历（Markdown 全文），输出 JSON 分析报告，结构如下：\n' +
    '{"summary":"匹配总评，2~3 句话：匹配程度、最大优势、最大短板",' +
    '"covered":["JD 中明确要求且简历已有体现的条目，注明简历中的关键证据"],' +
    '"gaps":[{"text":"JD 要求但简历缺失或体现不足的点","severity":"严重|次要"}],' +
    '"suggestions":[{"original":"简历中逐字存在的连续原文片段，必须限定在单个段落或列表条目内，不超过 200 字","instruction":"针对该片段的具体改写指令，交给另一个 AI 执行","reason":"这样改的理由"}]}\n' +
    '要求：suggestions 给 2~4 条最有价值的改写建议，original 必须逐字复制简历原文（不可改写、不可跨段落），' +
    '并优先选择不含加粗/行内代码等行内格式标记的片段（便于精确定位）；' +
    '只依据职位描述与简历原文，不要编造简历中不存在的内容；使用中文；只输出 JSON 本身，不要代码围栏和解释。'
  const user = `【职位描述】\n${jd.trim()}\n\n---\n\n【简历全文】\n${fullMarkdown}`
  const raw = await chatCompletion(
    config,
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    {
      temperature: 0.3,
      firstByteMs: 60_000,
      idleMs: 150_000,
      onDelta: options.onDelta,
      signal: options.signal,
    }
  )
  return parseJdReport(stripFence(raw.trim()))
}

function parseJdReport(raw: string): JdReport {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    const m = raw.match(/\{[\s\S]*\}/)
    if (!m) throw aiError('PARSE', '模型返回内容无法解析为分析报告，请重试')
    try {
      parsed = JSON.parse(m[0])
    } catch {
      throw aiError('PARSE', '模型返回内容无法解析为分析报告，请重试')
    }
  }
  const o = parsed as Partial<JdReport> | null
  if (!o || typeof o.summary !== 'string') {
    throw aiError('PARSE', '模型返回格式异常，请重试')
  }
  return {
    summary: o.summary,
    covered: Array.isArray(o.covered) ? o.covered.filter((x) => typeof x === 'string') : [],
    gaps: Array.isArray(o.gaps)
      ? o.gaps.filter(
          (g): g is { text: string; severity: string } =>
            !!g && typeof (g as { text?: unknown }).text === 'string'
        )
      : [],
    suggestions: Array.isArray(o.suggestions)
      ? o.suggestions.filter(
          (s): s is JdSuggestion =>
            !!s &&
            typeof (s as JdSuggestion).original === 'string' &&
            typeof (s as JdSuggestion).instruction === 'string' &&
            typeof (s as JdSuggestion).reason === 'string'
        )
      : [],
  }
}

/** 整份简历语法/表达检查，返回建议列表（流式接收，不设总时长限制） */
export async function checkGrammar(
  config: AIConfig,
  fullMarkdown: string,
  options: { onDelta?: (partial: string) => void; signal?: AbortSignal } = {}
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
    {
      temperature: 0.1,
      firstByteMs: 60_000,
      idleMs: 150_000,
      onDelta: options.onDelta,
      signal: options.signal,
    }
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

/** 是否为用户主动中止（UI 据此展示「已停止」而非报错） */
export function isAbortedError(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as AIError).code === 'ABORTED'
}
