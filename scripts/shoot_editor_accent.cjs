/* 编辑器画布主题色同步 + 顶栏「主题色」菜单交互验证：
   打开 pill 简历 → 截编辑器画布（默认色）→ 打开主题色菜单截图 →
   点橙色 → 截编辑器画布与预览（应同步变橙） */
const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')

const BASE = process.env.BASE_URL || 'http://localhost:5199'
const OUT = path.join(__dirname, 'shots2')
const DEFAULT_MD = fs.readFileSync(path.join(__dirname, 'diag_default.md'), 'utf-8')

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
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1500, height: 1600 } })
  await page.goto(`${BASE}/#/`)
  await page.getByText('我的简历').waitFor({ timeout: 15000 })

  const id = await idbAddResume(page, 'editor-accent', DEFAULT_MD, 'pill')
  await page.goto(`${BASE}/#/resume/${id}`)
  await page.reload()
  await page.locator('.editor-canvas').waitFor({ timeout: 15000 })
  await page.waitForTimeout(800)

  /* 1. 编辑器画布（默认蓝） */
  await page.locator('.editor-canvas').screenshot({ path: path.join(OUT, 'editor-pill-default.png') })
  console.log('shot editor default')

  /* 2. 打开顶栏「主题色」菜单 */
  await page.getByRole('button', { name: '主题色' }).click()
  await page.getByRole('menuitem', { name: /默认/ }).waitFor({ timeout: 3000 })
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(OUT, 'accent-menu.png') })
  console.log('shot accent menu')

  /* 3. 点橙色 → 编辑器与预览应即时同步 */
  await page.getByRole('button', { name: '主题色 #ea580c' }).click()
  await page.waitForTimeout(800)
  await page.locator('.editor-canvas').screenshot({ path: path.join(OUT, 'editor-pill-orange.png') })
  console.log('shot editor orange')
  await page.locator('[data-testid="resume-paper"]').screenshot({ path: path.join(OUT, 't-pill-live-orange.png') })
  console.log('shot preview orange')

  await browser.close()
  console.log('done ->', OUT)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})