// PDF 导出验证：真实触发 html2canvas + jsPDF 下载流程
const { chromium } = require('playwright')
const fs = require('fs')

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto('http://localhost:5173')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(800)

  // Playwright 每次全新 profile（IndexedDB 不共享），先创建简历
  await page.click('text=创建示例简历')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1500)

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    page.click('button:has-text("导出 PDF")'),
  ])
  const target = `${__dirname}/shots/export-test.pdf`
  await download.saveAs(target)
  const size = fs.statSync(target).size
  console.log('PDF 已下载:', target, `${(size / 1024).toFixed(1)} KB`)
  console.log(size > 20_000 ? 'PASS PDF 导出' : 'FAIL PDF 过小')

  // 验证导出后分页线被正确移除（导出态临时类已移除）
  await page.waitForTimeout(500)
  const exporting = await page.locator('.exporting').count()
  console.log(exporting === 0 ? 'PASS 导出态已清理' : 'FAIL 导出态残留')

  await browser.close()
  if (size <= 20_000) process.exit(1)
})().catch((e) => {
  console.error('FAIL', e)
  process.exit(1)
})
