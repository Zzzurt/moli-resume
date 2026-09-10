import Dexie, { type Table } from 'dexie'
import type { AppSettings, Resume, TemplateId } from '@/types'
import { DEFAULT_SETTINGS, TEMPLATES } from '@/types'

class ResumeDB extends Dexie {
  resumes!: Table<Resume, number>
  settings!: Table<{ key: string; value: unknown }, string>
  snapshots!: Table<ResumeSnapshot, number>

  constructor() {
    super('ink-resume')
    this.version(1).stores({
      // 主键自增，updatedAt 用于列表排序
      resumes: '++id, updatedAt',
      settings: 'key',
    })
    // v2：版本历史快照（每份简历独立保留）
    this.version(2).stores({
      snapshots: '++id, resumeId, createdAt',
    })
  }
}

export const db = new ResumeDB()

/* ---------- 版本历史快照 ---------- */

export interface ResumeSnapshot {
  id?: number
  resumeId: number
  title: string
  content: string
  template: TemplateId
  createdAt: number
}

/** 每份简历最多保留的快照数（超出删最旧） */
const MAX_SNAPSHOTS = 20

export async function addSnapshot(s: Omit<ResumeSnapshot, 'id' | 'createdAt'>): Promise<void> {
  await db.snapshots.add({ ...s, createdAt: Date.now() })
  // 超限清理：删该简历最旧的快照
  const all = await db.snapshots.where('resumeId').equals(s.resumeId).toArray()
  if (all.length > MAX_SNAPSHOTS) {
    const stale = all.sort((a, b) => a.createdAt - b.createdAt).slice(0, all.length - MAX_SNAPSHOTS)
    await db.snapshots.bulkDelete(stale.map((x) => x.id!).filter(Boolean))
  }
}

export async function listSnapshots(resumeId: number): Promise<ResumeSnapshot[]> {
  const all = await db.snapshots.where('resumeId').equals(resumeId).toArray()
  return all.sort((a, b) => b.createdAt - a.createdAt)
}

/* ---------- 设置读写 ---------- */

export async function loadSettings(): Promise<AppSettings> {
  const rows = await db.settings.toArray()
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  return { ...DEFAULT_SETTINGS, ...(stored as Partial<AppSettings>) }
}

export async function saveSetting<K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K]
): Promise<void> {
  await db.settings.put({ key, value })
}

/* ---------- 简历 CRUD ---------- */

export async function listResumes(): Promise<Resume[]> {
  const all = await db.resumes.toArray()
  return all.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function getResume(id: number): Promise<Resume | undefined> {
  return db.resumes.get(id)
}

export async function createResume(
  data: Pick<Resume, 'title' | 'content'> &
    Partial<Pick<Resume, 'template' | 'photo'>>
): Promise<number> {
  const now = Date.now()
  return db.resumes.add({
    title: data.title,
    content: data.content,
    template: data.template ?? 'minimal',
    photo: data.photo,
    createdAt: now,
    updatedAt: now,
  })
}

export async function updateResume(
  id: number,
  patch: Partial<
    Pick<Resume, 'title' | 'content' | 'template' | 'photo' | 'photoScale' | 'photoPos'>
  >
): Promise<void> {
  await db.resumes.update(id, { ...patch, updatedAt: Date.now() })
}

export async function duplicateResume(id: number): Promise<number | undefined> {
  const src = await db.resumes.get(id)
  if (!src) return undefined
  const now = Date.now()
  return db.resumes.add({
    title: `${src.title}（副本）`,
    content: src.content,
    template: src.template,
    photo: src.photo,
    createdAt: now,
    updatedAt: now,
  })
}

export async function deleteResume(id: number): Promise<void> {
  await db.resumes.delete(id)
}

/**
 * 恢复被删除的简历（供删除 toast 的「撤销」使用）。
 * 保留原 id 重新写回：版本历史快照按 resumeId 关联，换 id 会让快照失联。
 * 若同 id 已被占用（理论上不会：id 由自增分配），则退回新增。
 */
export async function restoreResume(resume: Resume): Promise<void> {
  const existing = resume.id != null ? await db.resumes.get(resume.id) : undefined
  if (existing) {
    await db.resumes.update(resume.id!, { ...resume })
    return
  }
  await db.resumes.put(resume)
}

/* ---------- 全量备份 / 恢复 ---------- */

export interface BackupFile {
  app: 'ink-resume'
  version: 1
  exportedAt: number
  resumes: Resume[]
  /** 备份不含任何 API Key（顶层 aiApiKey 与配置档内的密钥都在导出时清空）；恢复时保留本机现有 Key */
  settings: Omit<AppSettings, 'aiApiKey'>
}

export async function exportBackup(): Promise<BackupFile> {
  const [resumes, settings] = await Promise.all([db.resumes.toArray(), loadSettings()])
  const { aiApiKey: _omit, ...rest } = settings
  /* 配置档（AiProfile）里也存着 apiKey：只剥顶层字段会让密钥明文进备份文件，
     而 UI 明确承诺「不含 API Key」——这里把档内密钥一并清空 */
  const safeSettings: Omit<AppSettings, 'aiApiKey'> = {
    ...rest,
    aiProfiles: (settings.aiProfiles ?? []).map((p) => ({ ...p, apiKey: '' })),
  }
  return {
    app: 'ink-resume',
    version: 1,
    exportedAt: Date.now(),
    resumes: resumes.sort((a, b) => b.updatedAt - a.updatedAt),
    settings: safeSettings,
  }
}

/** 恢复前消毒单条简历：只保留已知字段并做类型校验，防止畸形备份写入坏数据 */
function sanitizeResume(r: Resume, now: number): Resume {
  if (!r || typeof r.title !== 'string' || typeof r.content !== 'string') {
    throw new Error('备份文件中存在格式不正确的简历数据')
  }
  return {
    title: r.title,
    content: r.content,
    template: (TEMPLATES.some((t) => t.id === r.template) ? r.template : 'minimal') as TemplateId,
    photo: typeof r.photo === 'string' ? r.photo : undefined,
    photoScale: typeof r.photoScale === 'number' ? r.photoScale : undefined,
    photoPos:
      r.photoPos && typeof r.photoPos.dx === 'number' && typeof r.photoPos.dy === 'number'
        ? { dx: r.photoPos.dx, dy: r.photoPos.dy }
        : undefined,
    createdAt: typeof r.createdAt === 'number' ? r.createdAt : now,
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : now,
  }
}

/**
 * 恢复前消毒设置项：备份是外部 JSON，不能原样写进库。
 * - 白名单 + 取值校验：layout / accentColor / paperTone 等会参与 className 或内联样式拼接，
 *   `theme` 又直接决定 <html> 类名，未校验的值可以往 DOM 上注入任意字符串
 * - 永不接受任何密钥：顶层 aiApiKey 与配置档内的 apiKey 一律丢弃（本机 Key 保留不动）
 */
function sanitizeSettings(input: unknown): { key: string; value: unknown }[] {
  if (!input || typeof input !== 'object') return []
  const s = input as Partial<AppSettings>
  const entries: { key: string; value: unknown }[] = []
  const set = (key: string, value: unknown) => {
    entries.push({ key, value })
  }

  if (s.theme === 'light' || s.theme === 'dark') set('theme', s.theme)
  if (typeof s.aiBaseUrl === 'string' && /^https?:\/\//i.test(s.aiBaseUrl.trim())) {
    set('aiBaseUrl', s.aiBaseUrl.trim())
  }
  if (typeof s.aiModel === 'string') set('aiModel', s.aiModel)
  if (typeof s.splitRatio === 'number' && s.splitRatio > 0 && s.splitRatio < 1) {
    set('splitRatio', s.splitRatio)
  }
  if (typeof s.smartOnePage === 'boolean') set('smartOnePage', s.smartOnePage)
  if (s.layout === 'standard' || s.layout === 'compact' || s.layout === 'loose') {
    set('layout', s.layout)
  }
  if (s.paperTone === 'white' || s.paperTone === 'dim' || s.paperTone === 'warm') {
    set('paperTone', s.paperTone)
  }
  if (typeof s.accentColor === 'string' && /^#[0-9a-f]{3,8}$/i.test(s.accentColor.trim())) {
    set('accentColor', s.accentColor.trim())
  }
  /* 配置档：保留名称 / 地址 / 模型，密钥一律清空（导出时也已清空） */
  if (Array.isArray(s.aiProfiles)) {
    const profiles = s.aiProfiles
      .filter((p) => !!p && typeof p.id === 'string' && typeof p.name === 'string')
      .map((p) => ({
        id: p.id,
        name: p.name,
        baseUrl: typeof p.baseUrl === 'string' ? p.baseUrl : '',
        model: typeof p.model === 'string' ? p.model : '',
        apiKey: '',
      }))
    if (profiles.length) set('aiProfiles', profiles)
  }
  return entries
}

/** 全量恢复：清空后写入（导入前应由 UI 层做二次确认）；API Key 不随备份恢复 */
export async function importBackup(file: BackupFile): Promise<void> {
  if (!file || !Array.isArray(file.resumes)) {
    throw new Error('备份文件缺少简历数据')
  }
  const now = Date.now()
  const settingsEntries = sanitizeSettings(file.settings)
  await db.transaction('rw', db.resumes, db.settings, async () => {
    await db.resumes.clear()
    await db.settings.clear()
    await db.resumes.bulkAdd(file.resumes.map((r) => sanitizeResume(r, now)))
    await db.settings.bulkPut(settingsEntries)
  })
}
