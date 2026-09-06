/* 验证：智能一页 v2 各档位 + 新模板渲染
   视口加高避免"纸张高于滚动窗口导致元素截图不完整"的伪影 */
const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')
const BASE = process.env.BASE_URL || 'http://localhost:5199'
const OUT = path.join(__dirname, 'diag')

const DEFAULT_MD = fs.readFileSync(path.join(__dirname, 'diag_default.md'), 'utf-8')

function buildMd(extraItems) {
  let md = DEFAULT_MD
  if (extraItems > 0) {
    md += '\n## 附加项目经历\n\n### 诊断用填充条目 | 2024.01 - 至今\n\n'
    for (let i = 1; i <= extraItems; i++) {
      md += `- 负责诊断填充条目 ${i}：主导某核心系统的架构演进与性能优化，量化成果提升 ${i * 10}%，覆盖多条业务线并沉淀通用组件\n`
    }
  }
  return md
}

async function idbAddResume(page, title, content, template = 'minimal') {
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

async function shoot(page, name) {
  await page.locator('[data-testid="resume-paper"]').waitFor({ timeout: 15000 })
  await page.waitForTimeout(1500) // 等密度档收敛与缩放稳定
  const paper = page.locator('[data-testid="resume-paper"]')
  await paper.screenshot({ path: path.join(OUT, `${name}.png`) })
  const info = await page.evaluate(() => {
    const paper = document.querySelector('[data-testid="resume-paper"]')
    const layer = paper?.firstElementChild
    const tpl = layer?.firstElementChild
    const density = tpl?.className?.match(/rs-(compact|tight)/)?.[1] || 'normal'
    return {
      paperH: Math.round(paper?.getBoundingClientRect().height || 0),
      transform: layer?.style?.transform || '(none)',
      density,
      placeholderH: paper?.parentElement?.parentElement?.getBoundingClientRect().height,
    }
  })
  console.log(
    `${name}: density=${info.density} scale=${info.transform} paperH=${info.paperH} placeholderH=${Math.round(info.placeholderH || 0)}`
  )
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1500, height: 1600 } })

  await page.goto(`${BASE}/#/`)
  await page.getByText('我的简历').waitFor({ timeout: 15000 })

  /* 智能一页各档位 */
  for (const k of [0, 4, 10, 14, 30]) {
    const id = await idbAddResume(page, `诊断-${k}行`, buildMd(k))
    await page.goto(`${BASE}/#/resume/${id}`)
    await shoot(page, `v2-overflow-${k}`)
  }

  /* 新模板（默认内容） */
  for (const tpl of ['tech', 'elegant', 'sleek']) {
    const id = await idbAddResume(page, `模板-${tpl}`, DEFAULT_MD, tpl)
    await page.goto(`${BASE}/#/resume/${id}`)
    await shoot(page, `tpl-${tpl}`)
  }

  await browser.close()
  console.log('done ->', OUT)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
