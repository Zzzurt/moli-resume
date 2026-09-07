/* 冒烟测试：验证本次修复的关键交互（需先启动 vite dev server）
   运行：node scripts/smoke.cjs  （BASE_URL 默认 http://localhost:5173） */
const { chromium } = require('playwright')
const fs = require('fs')

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

/** 直接经 IndexedDB 建简历（绕过 UI，供确定性用例使用） */
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

/** 经 IndexedDB 写设置项 */
async function idbSetSetting(page, key, value) {
  await page.evaluate(
    ({ key, value }) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('ink-resume')
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction('settings', 'readwrite')
          tx.objectStore('settings').put({ key, value })
          tx.oncomplete = () => { db.close(); resolve() }
          tx.onerror = () => reject(tx.error)
        }
      }),
    { key, value }
  )
}

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push('pageerror: ' + e.message))
  page.on('console', (m) => {
    if (m.text().includes('[diag-jd]')) console.log('[page-console]', m.text())
  })

  try {
    /* 1. 列表页加载 */
    await page.goto(`${BASE}/#/`)
    await page.getByRole('button', { name: '新建简历' }).waitFor({ timeout: 10000 })
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
    await page.getByRole('button', { name: '新建简历' }).waitFor({ timeout: 10000 })
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
    /* 2h. AI 提问模式：发送按钮状态反馈（无指令禁用 → 输入可执行 → 无 Key 错误反馈）。
       经悬浮工具栏「更多」行进入提问模式（选区存在时它正好浮在顶栏上方） */
    await page.locator('.ProseMirror').click()
    await page.keyboard.press('Control+a')
    await page.locator('.bubble-toolbar button[title="更多工具"]').waitFor({ timeout: 5000 })
    await page.locator('.bubble-toolbar button[title="更多工具"]').click()
    await page.locator('.bt-ai-mini', { hasText: /提问/ }).click()
    const dlg = page.getByRole('dialog')
    await dlg.waitFor({ timeout: 5000 })
    const send = page.getByTestId('ask-send')
    await send.waitFor({ timeout: 3000 })
    if (!(await send.isDisabled())) throw new Error('send should be disabled when instruction empty')
    await dlg.locator('textarea').fill('翻译成英文')
    if (await send.isDisabled()) throw new Error('send should be enabled after instruction input')
    await send.click()
    /* 本环境无 API Key：出现错误反馈即证明提交链路清晰可见 */
    await page.getByText(/API Key|请先|失败|错误/).first().waitFor({ timeout: 10000 })
    ok('ask mode send feedback')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
  } catch (e) {
    fail('ask mode send feedback', e)
  }

  try {
    /* 2i. 单页简历导出 PDF 恰好一页（无空白尾页：切片舍入残差回归） */
    const shortId = await idbAddResume(page, '页数测试', '# 单页测试\n\n一段很短的内容。', 'minimal')
    await page.goto(`${BASE}/#/resume/${shortId}`)
    await page.reload()
    await page.locator('.editor-canvas').waitFor({ timeout: 10000 })
    await page.waitForTimeout(600)
    const [pdfDl] = await Promise.all([
      page.waitForEvent('download', { timeout: 60000 }),
      page.getByRole('button', { name: '导出 PDF' }).click(),
    ])
    const pdfPath = await pdfDl.path()
    if (!pdfPath) throw new Error('no download path')
    /* jsPDF 输出未压缩对象树：/Type /Page（非 /Pages）出现次数即页数 */
    const pages = (fs.readFileSync(pdfPath).toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length
    if (pages !== 1) throw new Error(`pdf pages=${pages}, want 1`)
    ok('single-page pdf has no blank page')
  } catch (e) {
    fail('single-page pdf has no blank page', e)
  }

  try {
    /* 2j. 状态栏页数：单页显示「1 页」；超长内容显示多页警告 */
    await page.getByText('1 页', { exact: true }).waitFor({ timeout: 5000 })
    ok('statusbar page count (single page)')
    const longMd = Array.from(
      { length: 60 },
      () => '## 段落标题\n\n- 条目内容用于撑高页面，包含一些描述文字。\n- 第二条目内容。'
    ).join('\n\n')
    const longId = await idbAddResume(page, '多页测试', longMd, 'minimal')
    await page.goto(`${BASE}/#/resume/${longId}`)
    await page.reload()
    await page.locator('.editor-canvas').waitFor({ timeout: 10000 })
    await page.waitForTimeout(1200) /* 等智能一页测量收敛 */
    await page.getByText(/内容 \d+ 页/).waitFor({ timeout: 10000 })
    ok('statusbar page metrics (multi-page warning)')
  } catch (e) {
    fail('statusbar page metrics', e)
  }

  try {
    /* 2k. 导出超页提示：智能一页关闭 + 多页内容 → 弹确认 →「开启智能一页并导出」 */
    await idbSetSetting(page, 'smartOnePage', false)
    await page.reload()
    await page.locator('.editor-canvas').waitFor({ timeout: 10000 })
    await page.waitForTimeout(1000)
    await page.getByRole('button', { name: '导出 PDF' }).click()
    const enableBtn = page.getByTestId('export-enable-onepage')
    await enableBtn.waitFor({ timeout: 5000 })
    ok('export over-page prompt shown')
    const dlPromise = page.waitForEvent('download', { timeout: 60000 })
    await enableBtn.click()
    await dlPromise
    ok('enable-onepage then export proceeds')
    /* 恢复智能一页默认值，避免影响后续用例 */
    await idbSetSetting(page, 'smartOnePage', true)
  } catch (e) {
    fail('export over-page prompt', e)
  }

  try {
    /* 2l. JD 匹配 → 报告内**连续逐条改写**：JSON 报告 → 卡片改写(流式) → diff → 应用(不关弹窗) → 下一条 */
    const jdCtx = await browser.newContext()
    const p2 = await jdCtx.newPage()
    let askCalls = 0
    const rewrites = [
      '- 主导营销活动搭建平台重构，并负责 Node.js BFF 层接口设计，首屏加载从 3.2s 降至 1.1s',
      '前端工程师，五年经验，近期在实践 Node.js 全栈开发',
    ]
    await p2.route('**/chat/completions**', (route) => {
      const reqBody = route.request().postData() ?? ''
      let content
      if (reqBody.includes('匹配总评')) {
        /* jdAnalyze：system prompt 含结构说明关键词 */
        content = JSON.stringify({
          summary: '匹配度较高，前端能力契合，量化成果突出。',
          covered: ['React 生态：简历提及组件库 monorepo 方案'],
          gaps: [{ text: 'JD 要求的 Node.js 服务端经验未体现', severity: '严重' }],
          suggestions: [
            {
              /* 带加粗语法标记的锚点：回归「AI 复制 Markdown 源码 vs 渲染纯文本」匹配修复 */
              original: '主导营销活动搭建平台重构，**首屏加载从 3.2s 降至 1.1s**',
              instruction: '为该条目补充与 Node.js 服务端协作的经历描述',
              reason: 'JD 明确要求服务端经验，该条目最贴近',
            },
            {
              original: '前端工程师，五年经验',
              instruction: '在简介中表达对全栈方向的实践意愿',
              reason: 'JD 偏好有全栈背景的候选人',
            },
          ],
        })
      } else {
        content = rewrites[askCalls] ?? ''
        askCalls++
      }
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
        body: 'data: ' + JSON.stringify({ choices: [{ delta: { content } }] }) + '\n\ndata: [DONE]\n\n',
      })
    })
    /* 建含锚点句子的简历（建议的 original 必须能在文档中逐字定位）；IDB 需同源页面 */
    await p2.goto(`${BASE}/#/`)
    await p2.getByRole('button', { name: '新建简历' }).waitFor({ timeout: 15000 })
    const jdId = await idbAddResume(
      p2,
      'jd 测试',
      '# 陈墨\n\n## 个人简介\n\n前端工程师，五年经验。\n\n## 工作经历\n\n### 某公司 · 前端工程师 | 2022\n\n- 主导营销活动搭建平台重构，首屏加载从 3.2s 降至 1.1s\n- 设计组件库 monorepo 方案',
      'minimal'
    )
    await idbSetSetting(p2, 'aiApiKey', 'test-key')
    await idbSetSetting(p2, 'aiBaseUrl', 'https://mock.local/v1')
    /* settings 启动时读入内存 → 列表页整页刷新（同时让 useLiveQuery 拿到新简历） */
    await p2.reload()
    /* 走真实用户路径：列表页点卡片进入编辑器 */
    await p2.getByText('jd 测试').click()
    await p2.locator('.editor-canvas').waitFor({ timeout: 10000 })
    /* 等简历内容真正渲染（锚点文本在编辑器/预览出现），而非仅纸张就绪 */
    await p2.getByText('主导营销活动搭建平台重构').first().waitFor({ timeout: 10000 })
    await p2.getByRole('button', { name: 'JD 匹配' }).click()
    const jdInput = p2.getByTestId('jd-input')
    await jdInput.waitFor({ timeout: 5000 })
    if (!(await p2.getByTestId('jd-run').isDisabled())) throw new Error('run should be disabled when JD empty')
    await jdInput.fill('招聘前端工程师，要求 React、性能优化、Node.js 经验')
    await p2.getByTestId('jd-run').click()
    /* 报告标题在 h4 与内层 span 均出现，取 first 规避 strict violation */
    await p2.getByText('匹配总评').first().waitFor({ timeout: 15000 })
    await p2.getByText(/Node\.js 服务端经验未体现/).first().waitFor({ timeout: 5000 })

    /* 建议一：卡片内改写 → diff → 应用（弹窗保持打开） */
    await p2.getByTestId('jd-apply-0').click()
    await p2.getByTestId('jd-confirm-0').waitFor({ timeout: 15000 })
    await p2.getByTestId('jd-confirm-0').click()
    await p2.getByText('Node.js BFF 层接口设计').first().waitFor({ timeout: 10000 })
    if (!(await p2.getByTestId('jd-suggestion-0').textContent()).includes('已应用'))
      throw new Error('suggestion 0 not marked applied')

    /* 建议二：同一弹窗内连续处理第二条 */
    await p2.getByTestId('jd-apply-1').click()
    await p2.getByTestId('jd-confirm-1').waitFor({ timeout: 15000 })
    await p2.getByTestId('jd-confirm-1').click()
    await p2.getByText('实践 Node.js 全栈开发').first().waitFor({ timeout: 10000 })
    await p2.getByText(/全部建议已处理/).waitFor({ timeout: 5000 })
    ok('jd match continuous rewrite loop')
    await jdCtx.close()
  } catch (e) {
    fail('jd match continuous rewrite loop', e)
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
    await page.getByRole('button', { name: '新建简历' }).waitFor({ timeout: 10000 })
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
