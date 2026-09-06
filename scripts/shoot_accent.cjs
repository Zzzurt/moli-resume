/* 主题色验证：写一份简历，切到 pill / business 两个模板，
   通过 IndexedDB 注入 accentColor，覆盖默认/橙/紫三种状态截图 */
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

/** settings 表 schema: { key, value }，与 saveSetting 一致 */
async function idbSetSetting(page, key, value) {
  await page.evaluate(
    ({ key, value }) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('ink-resume')
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction('settings', 'readwrite')
          const req = tx.objectStore('settings').put({ key, value })
          req.onsuccess = () => resolve()
          tx.oncomplete = () => db.close()
          tx.onerror = () => reject(tx.error)
        }
      }),
    { key, value }
  )
}

/** 等渲染稳定（设置从 IDB 加载 + React 重渲染有延迟） */
async function settle(page, ms = 1000) {
  await page.waitForTimeout(ms)
}

async function shotTpl(page, id, tpl, label) {
  await page.goto(`${BASE}/#/resume/${id}`)
  /* hash 导航是同文档切换，SettingsProvider 不会重挂载、不会重读 settings；
     强制整页刷新让 loadSettings 拿到刚写入的 accentColor */
  await page.reload()
  await page.locator('[data-testid="resume-paper"]').waitFor({ timeout: 15000 })
  await settle(page)
  await page.locator('[data-testid="resume-paper"]').screenshot({
    path: path.join(OUT, `t-${tpl}-${label}.png`),
  })
  console.log('shot', tpl, label)
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1500, height: 1600 } })
  await page.goto(`${BASE}/#/`)
  await page.getByText('我的简历').waitFor({ timeout: 15000 })

  const pillId = await idbAddResume(page, 'accent-pill', DEFAULT_MD, 'pill')
  const bizId = await idbAddResume(page, 'accent-business', DEFAULT_MD, 'business')

  /* 三组：默认（清空）/ 橙 / 紫 */
  const cases = [
    { label: 'default', value: null },
    { label: 'orange', value: '#ea580c' },
    { label: 'violet', value: '#7c3aed' },
  ]

  for (const { label, value } of cases) {
    await idbSetSetting(page, 'accentColor', value)
    /* 默认态：额外等一下确保 IDB 读到的也是清空态 */
    if (value === null) await settle(page, 400)
    await shotTpl(page, pillId, 'pill', label)
    await shotTpl(page, bizId, 'business', label)
  }

  await browser.close()
  console.log('done ->', OUT)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})