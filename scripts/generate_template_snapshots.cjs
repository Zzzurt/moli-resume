/* 模板快照生成（学 Magic Resume 的 generate-template-snapshots 思路）：
   自动起 dev server → Playwright 用固定示例内容逐模板截图 →
   public/template-snapshots/{id}.png + 生成 src/generated/templateSnapshots.ts manifest

   运行：node scripts/generate_template_snapshots.cjs
   注意：模板增删时需同步更新下方 TEMPLATE_IDS 列表 */
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright')

const HOST = '127.0.0.1'
const PORT = 4173
const BASE = `http://${HOST}:${PORT}`
const ROOT = path.join(__dirname, '..')
const OUT_DIR = path.join(ROOT, 'public', 'template-snapshots')
const MANIFEST_FILE = path.join(ROOT, 'src', 'generated', 'templateSnapshots.ts')
const SAMPLE_MD = fs.readFileSync(path.join(__dirname, 'diag_default.md'), 'utf-8')

/** 与 src/types/index.ts 的 TemplateId 保持同步 */
const TEMPLATE_IDS = [
  'minimal',
  'classic',
  'modern',
  'tech',
  'elegant',
  'sleek',
  'business',
  'pill',
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function startDevServer() {
  const child = spawn(
    process.execPath,
    [
      path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'),
      '--host', HOST,
      '--port', String(PORT),
      '--strictPort',
    ],
    { cwd: ROOT, stdio: 'inherit' }
  )
  return child
}

async function waitForServer(timeoutMs = 30000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(BASE)
      if (res.ok) return
    } catch { /* 未就绪继续等 */ }
    await sleep(500)
  }
  throw new Error(`等待 ${BASE} 就绪超时`)
}

async function idbAddResume(page, title, content, template) {
  return page.evaluate(
    ({ title, content, template }) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('ink-resume')
        open.onerror = () => reject(new Error('open failed'))
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction('resumes', 'readwrite')
          const req = tx.objectStore('resumes').add({
            title, content, template,
            createdAt: Date.now(), updatedAt: Date.now(),
          })
          req.onsuccess = () => resolve(req.result)
          tx.oncomplete = () => db.close()
          tx.onerror = () => reject(tx.error)
        }
      }),
    { title, content, template }
  )
}

async function main() {
  fs.rmSync(OUT_DIR, { recursive: true, force: true })
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.mkdirSync(path.dirname(MANIFEST_FILE), { recursive: true })

  const devServer = startDevServer()
  let failed = false
  try {
    await waitForServer()
    console.log('dev server ready')

    const browser = await chromium.launch()
    const page = await browser.newPage({
      viewport: { width: 1500, height: 1600 }, // 视口须 ≥1500 高，否则元素截图不完整（已知伪影）
      deviceScaleFactor: 2, // 高清快照
      colorScheme: 'light',
    })

    await page.goto(`${BASE}/#/`)
    await page.getByText('我的简历').waitFor({ timeout: 30000 })

    const urls = {}
    for (const tpl of TEMPLATE_IDS) {
      const id = await idbAddResume(page, `snapshot-${tpl}`, SAMPLE_MD, tpl)
      // hash 导航是同文档切换，必须 reload 让应用重新读取新简历
      await page.goto(`${BASE}/#/resume/${id}`)
      await page.reload()
      await page.locator('[data-testid="resume-paper"]').waitFor({ timeout: 30000 })
      await page.waitForTimeout(1200)
      await page.evaluate(async () => {
        if (document.fonts?.ready) await document.fonts.ready
      })
      // 快照代表模板默认形态：隐藏证件照上传占位框（噪点）
      await page.addStyleTag({ content: '.photo-spot { display: none !important; }' })
      const file = path.join(OUT_DIR, `${tpl}.png`)
      await page.locator('[data-testid="resume-paper"]').screenshot({ path: file, type: 'png' })
      // base: './' + hash 路由下页面 URL 恒为根，相对路径可安全引用
      urls[tpl] = `template-snapshots/${tpl}.png?v=${encodeURIComponent(new Date().toISOString())}`
      console.log('snapshot', tpl)
    }

    await browser.close()

    const manifest =
      `// 由 scripts/generate_template_snapshots.cjs 自动生成，请勿手动编辑。\n` +
      `// 重新生成：node scripts/generate_template_snapshots.cjs\n` +
      `export const TEMPLATE_SNAPSHOT_VERSION = ${JSON.stringify(new Date().toISOString())}\n\n` +
      `/** 模板 id → 快照相对路径（public/ 下，带版本参数防缓存）；缺项 = 无快照，UI 需降级占位 */\n` +
      `export const TEMPLATE_SNAPSHOT_URLS: Partial<Record<string, string>> = ${JSON.stringify(urls, null, 2)}\n`
    fs.writeFileSync(MANIFEST_FILE, manifest, 'utf-8')
    console.log('manifest ->', MANIFEST_FILE)
  } catch (e) {
    failed = true
    console.error(e)
  } finally {
    devServer.kill('SIGTERM')
  }
  process.exit(failed ? 1 : 0)
}

main()