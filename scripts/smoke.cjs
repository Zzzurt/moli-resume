/* 冒烟测试：验证本次修复的关键交互（需先启动 vite dev server）
   运行：node scripts/smoke.cjs  （BASE_URL 默认 http://localhost:5173） */
const { chromium } = require('playwright')

const BASE = process.env.BASE_URL || 'http://localhost:5173'
const results = []
const ok = (name) => {
  results.push(`PASS ${name}`)
  console.log(`PASS ${name}`)
}
const fail = (name, e) => {
  results.push(`FAIL ${name}: ${e}`)
  console.error(`FAIL ${name}: ${e}`)
}

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push('pageerror: ' + e.message))

  try {
    /* 1. 列表页加载 */
    await page.goto(`${BASE}/#/`)
    await page.getByText('我的简历').waitFor({ timeout: 10000 })
    ok('list page loads')
  } catch (e) {
    fail('list page loads', e)
    await browser.close()
    process.exit(1)
  }

  try {
    /* 2. 新建简历（对话框 → 空白）→ 编辑器打开 */
    await page.getByRole('button', { name: '新建简历' }).click()
    const blank = page.getByTestId('create-blank')
    await blank.waitFor({ timeout: 10000 })
    await blank.click()
    await page.getByText('块编辑器').waitFor({ timeout: 10000 })
    ok('editor opens (blank via dialog)')

    /* 2b. 新建对话框：选模板 → 放大预览 → 使用此模板 */
    await page.goto(`${BASE}/#/`)
    await page.getByText('我的简历').waitFor({ timeout: 10000 })
    await page.getByRole('button', { name: '新建简历' }).click()
    const pillCard = page.getByTestId('tpl-card-pill')
    await pillCard.waitFor({ timeout: 10000 })
    await pillCard.click()
    const useBtn = page.getByTestId('use-template')
    await useBtn.waitFor({ timeout: 5000 })
    await useBtn.click()
    await page.getByText('块编辑器').waitFor({ timeout: 10000 })
    const pillCanvas = page.locator('.editor-canvas.tpl-pill')
    if ((await pillCanvas.count()) === 1) ok('create from template (pill)')
    else throw new Error('editor canvas missing tpl-pill class')
  } catch (e) {
    fail('create resume flows', e)
  }

  try {
    /* 2c. 模板面板：实时预览网格 → 切换到经典模板 */
    await page.getByTestId('template-picker-trigger').click()
    const classicCard = page.getByTestId('picker-classic')
    await classicCard.waitFor({ timeout: 10000 })
    await page.waitForTimeout(800) /* 等实时缩放渲染完成 */
    await classicCard.click()
    await page.locator('.editor-canvas.tpl-classic').waitFor({ timeout: 10000 })
    ok('template picker switches to classic')
  } catch (e) {
    fail('template picker', e)
  }

  try {
    /* 2d. Markdown 源码模式：查看 → 编辑 → 切回块编辑后内容同步 */
    await page.getByRole('button', { name: '源码', exact: true }).click()
    const src = page.getByTestId('source-editor')
    await src.waitFor({ timeout: 5000 })
    const md0 = await src.inputValue()
    if (!md0.includes('#')) throw new Error('source view missing markdown heading')
    await src.click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type('\n\n## 冒烟新增板块\n\n- 源码条目一')
    await page.waitForTimeout(800) /* 等防抖解析回块文档 */
    await page.getByRole('button', { name: '源码', exact: true }).click()
    await page.locator('.ProseMirror').waitFor({ timeout: 5000 })
    const pmText = await page.locator('.ProseMirror').textContent()
    if (!pmText.includes('源码条目一')) throw new Error('source edit not synced to wysiwyg')
    ok('markdown source mode roundtrip')
  } catch (e) {
    fail('markdown source mode', e)
  }

  try {
    /* 2e. 自定义主题色：input[type=color] 设值 → 预览 --rs-accent 联动 */
    await page.getByRole('button', { name: '主题色' }).click()
    const colorInput = page.getByTestId('accent-custom')
    await colorInput.waitFor({ timeout: 5000 })
    await colorInput.evaluate((el) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(el, '#123456')
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await page.waitForTimeout(400)
    const accent = await page
      .locator('[data-testid="resume-paper"] [class*="tpl-"]')
      .first()
      .evaluate((el) => getComputedStyle(el).getPropertyValue('--rs-accent').trim().toLowerCase())
    if (accent !== '#123456') throw new Error(`--rs-accent=${accent}, want #123456`)
    await page.keyboard.press('Escape')
    ok('custom accent color')
  } catch (e) {
    fail('custom accent color', e)
  }

  try {
    /* 2f. 历史版本：列表有快照 → 恢复成功 */
    await page.getByRole('button', { name: '文件' }).click()
    await page.getByRole('menuitem', { name: '历史版本' }).click()
    const restoreBtns = page.getByRole('button', { name: '恢复' })
    await restoreBtns.first().waitFor({ timeout: 5000 })
    await restoreBtns.first().click()
    /* 确认弹窗中的「恢复」（exact 区分列表项的「恢复」按钮） */
    await page.getByRole('button', { name: '恢复', exact: true }).last().click()
    await page.getByText('已恢复到所选版本').waitFor({ timeout: 5000 })
    ok('history snapshot restore')
  } catch (e) {
    fail('history snapshot restore', e)
  }

  try {
    /* 2g. 长图 PNG 导出 */
    await page.getByRole('button', { name: '文件' }).click()
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 60000 }),
      page.getByRole('menuitem', { name: /导出长图 PNG/ }).click(),
    ])
    const p = await download.path()
    if (!p) throw new Error('no download path')
    ok('png long-image export')
  } catch (e) {
    fail('png long-image export', e)
  }

  try {
    /* 3. 行内规则：先清空文档（当前在 2b 创建的 pill 简历编辑器内），排除默认内容干扰 */
    const pm = page.locator('.ProseMirror')
    await pm.click()
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Delete')
    await page.waitForTimeout(200)

    await page.keyboard.type('**加粗**')
    await page.waitForTimeout(300)
    const p1 = pm.locator('> p').first()
    const boldText = await p1.locator('strong').textContent().catch(() => '')
    const p1Text = await p1.textContent()
    if (boldText === '加粗' && p1Text === '加粗') ok('bold input rule')
    else throw new Error(`strong=${boldText} p1=${JSON.stringify(p1Text)}`)

    /* 4. 行内规则：斜体边界用例 a*a*（前置字符与内容同字符，无 lookbehind 版本） */
    await page.keyboard.press('Enter')
    await page.keyboard.type('a*a*')
    await page.waitForTimeout(300)
    const paras = pm.locator('> p')
    const p2 = paras.nth(1)
    const emText = await p2.locator('em').textContent().catch(() => '')
    const p2Text = await p2.textContent()
    if (emText === 'a' && p2Text === 'aa') ok('italic edge case a*a*')
    else throw new Error(`em=${emText} p2=${JSON.stringify(p2Text)}`)

    /* 4b. 其余行内规则快速回归：*斜* ~~删~~ `码` */
    await page.keyboard.press('Enter')
    await page.keyboard.type('*斜*')
    await page.waitForTimeout(200)
    await page.keyboard.press('Enter')
    await page.keyboard.type('~~删~~')
    await page.waitForTimeout(200)
    await page.keyboard.press('Enter')
    await page.keyboard.type('`码`')
    await page.waitForTimeout(300)
    const em3 = await paras.nth(2).locator('em').textContent().catch(() => '')
    const s4 = await paras.nth(3).locator('s').textContent().catch(() => '')
    const c5 = await paras.nth(4).locator('code').textContent().catch(() => '')
    if (em3 === '斜' && s4 === '删' && c5 === '码') ok('inline rules italic/strike/code')
    else throw new Error(`em=${em3} s=${s4} code=${c5}`)

    /* 5. 链接弹窗（替代 window.prompt；链接按钮在「更多工具」展开行内。
       注：Tiptap 行内 Code mark excludes 所有的 mark，code 文本上 setLink 无效是原生行为，
       故选删除线段落做目标） */
    const lastPara = paras.nth(3)
    await lastPara.click()
    await page.keyboard.press('End')
    await page.keyboard.press('Home')
    await page.keyboard.press('Shift+End')
    await page.waitForTimeout(200)
    await page.locator('.bubble-toolbar button[title="更多工具"]').click()
    const linkBtn = page.locator('.bubble-toolbar button[title="插入链接"]')
    await linkBtn.waitFor({ timeout: 3000 })
    await linkBtn.click()
    await page.getByRole('button', { name: '确定' }).waitFor({ timeout: 3000 })
    await page.getByPlaceholder('https://').fill('https://example.com')
    await page.getByRole('button', { name: '确定' }).click()
    await page.waitForTimeout(300)
    const anchorCount = await pm.locator('a[href="https://example.com"]').count()
    if (anchorCount >= 1) ok('link dialog applies link')
    else throw new Error('anchor not found after apply')
  } catch (e) {
    fail('editor interactions', e)
  }

  try {
    /* 6. 删除确认弹窗（替代 window.confirm） */
    await page.goto(`${BASE}/#/`)
    await page.getByText('我的简历').waitFor({ timeout: 10000 })
    const card = page.locator('[role="button"]').first()
    await card.hover()
    await card.locator('button[aria-label="文档操作"]').click()
    await page.getByRole('menuitem', { name: '删除' }).click()
    await page.getByRole('button', { name: '删除', exact: true }).waitFor({ timeout: 3000 })
    await page.getByRole('button', { name: '删除', exact: true }).click()
    await page.getByText('已删除').waitFor({ timeout: 5000 })
    ok('delete confirm dialog')
  } catch (e) {
    fail('delete confirm dialog', e)
  }

  if (pageErrors.length) {
    fail('no page errors', pageErrors.join(' | '))
  } else {
    ok('no page errors')
  }

  await browser.close()
  const failed = results.filter((r) => r.startsWith('FAIL'))
  console.log(failed.length ? `\n${failed.length} failed` : '\nALL PASS')
  process.exit(failed.length ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
