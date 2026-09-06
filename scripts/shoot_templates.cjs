/* 六模板截图：默认简历内容，逐模板截图目检 */
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
            title,
            content,
            template,
            createdAt: Date.now(),
            updatedAt: Date.now(),
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

  for (const tpl of ['minimal', 'classic', 'modern', 'tech', 'elegant', 'sleek', 'business', 'pill']) {
    const id = await idbAddResume(page, `模板-${tpl}`, DEFAULT_MD, tpl)
    await page.goto(`${BASE}/#/resume/${id}`)
    await page.locator('[data-testid="resume-paper"]').waitFor({ timeout: 15000 })
    await page.waitForTimeout(1500)
    await page.locator('[data-testid="resume-paper"]').screenshot({
      path: path.join(OUT, `t-${tpl}.png`),
    })
    console.log('shot', tpl)
  }
  await browser.close()
  console.log('done ->', OUT)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
