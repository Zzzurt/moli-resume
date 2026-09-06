/* 新建简历对话框目检：网格视图 + 模板预览视图 + 创建后编辑器 */
const { chromium } = require('playwright')
const path = require('path')

const BASE = process.env.BASE_URL || 'http://localhost:5199'
const OUT = path.join(__dirname, 'shots2')

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  await page.goto(`${BASE}/#/`)
  await page.getByText('我的简历').waitFor({ timeout: 15000 })

  await page.getByRole('button', { name: '新建简历' }).click()
  await page.getByTestId('create-blank').waitFor({ timeout: 10000 })
  await page.waitForTimeout(1200) // 等快照图加载
  await page.screenshot({ path: path.join(OUT, 'dialog-grid.png') })
  console.log('shot dialog grid')

  await page.getByTestId('tpl-card-pill').click()
  await page.getByTestId('use-template').waitFor({ timeout: 5000 })
  await page.waitForTimeout(500)
  await page.screenshot({ path: path.join(OUT, 'dialog-preview.png') })
  console.log('shot dialog preview')

  await page.getByTestId('use-template').click()
  await page.getByText('块编辑器').waitFor({ timeout: 10000 })
  await page.waitForTimeout(600)
  await page.screenshot({ path: path.join(OUT, 'created-editor.png') })
  console.log('shot created editor')

  await browser.close()
  console.log('done ->', OUT)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})