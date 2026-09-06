import Dexie, { type Table } from 'dexie'
import type { AppSettings, Resume, TemplateId } from '@/types'
import { DEFAULT_SETTINGS, TEMPLATES } from '@/types'

class ResumeDB extends Dexie {
  resumes!: Table<Resume, number>
  settings!: Table<{ key: string; value: unknown }, string>

  constructor() {
    super('ink-resume')
    this.version(1).stores({
      // 主键自增，updatedAt 用于列表排序
      resumes: '++id, updatedAt',
      settings: 'key',
    })
  }
}

export const db = new ResumeDB()

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

/* ---------- 全量备份 / 恢复 ---------- */

export interface BackupFile {
  app: 'ink-resume'
  version: 1
  exportedAt: number
  resumes: Resume[]
  /** 备份不含 aiApiKey（避免明文密钥随文件外泄）；恢复时保留本机现有 Key */
  settings: Omit<AppSettings, 'aiApiKey'>
}

export async function exportBackup(): Promise<BackupFile> {
  const [resumes, settings] = await Promise.all([db.resumes.toArray(), loadSettings()])
  const { aiApiKey: _omit, ...safeSettings } = settings
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

/** 全量恢复：清空后写入（导入前应由 UI 层做二次确认）；API Key 不随备份恢复 */
export async function importBackup(file: BackupFile): Promise<void> {
  if (!file || !Array.isArray(file.resumes)) {
    throw new Error('备份文件缺少简历数据')
  }
  const now = Date.now()
  const settingsEntries = Object.entries(file.settings ?? {}).filter(
    ([key]) => key !== 'aiApiKey'
  )
  await db.transaction('rw', db.resumes, db.settings, async () => {
    await db.resumes.clear()
    await db.settings.clear()
    await db.resumes.bulkAdd(file.resumes.map((r) => sanitizeResume(r, now)))
    await db.settings.bulkPut(
      settingsEntries.map(([key, value]) => ({ key, value }))
    )
  })
}
