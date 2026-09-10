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
  /** 多页简历 id（2m-2/2m-3/2m-4 共用） */
  let scrollId = -1
  /** 多页文档内容（多用例共用） */
  const longMd = Array.from(
    { length: 40 },
    () => '## 段落标题\n\n- 条目内容用于撑高页面。\n- 第二条目内容。'
  ).join('\n\n')
  page.on('pageerror', (e) => pageErrors.push('pageerror: ' + e.message))
  page.on('console', (m) => {
    if (m.text().includes('[diag-jd]')) console.log('[page-console]', m.text())
  })

  try {
    /* 1. 列表页加载。
       空状态时顶栏操作组隐藏（与中央引导去重）：先点中央「创建示例简历」
       生成一份简历，返回列表后顶栏按钮恢复，供后续用例使用。
       注：isVisible() 的 timeout 会被忽略（立即返回），必须用 waitFor 等待空态渲染 */
    await page.goto(`${BASE}/#/`)
    const sampleBtn = page.getByRole('button', { name: '创建示例简历' })
    const hasEmpty = await sampleBtn
      .waitFor({ state: 'visible', timeout: 3000 })
      .then(() => true)
      .catch(() => false)
    if (hasEmpty) {
      await sampleBtn.click()
      await page.locator('.editor-canvas').waitFor({ timeout: 10000 })
      await page.goto(`${BASE}/#/`)
    }
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
    await page.locator('.editor-canvas').waitFor({ timeout: 10000 })
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
    await page.locator('.editor-canvas').waitFor({ timeout: 10000 })
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
    /* 2h-2. AI 停止生成：润色模式自动执行 → 加载中点「停止」→ 展示「已停止生成」（非报错） */
    const stopCtx = await browser.newContext()
    const p3 = await stopCtx.newPage()
    /* 模拟无响应网关：20s 后才返回首字节（远超测试时长，请求保持 pending 直到用户中止） */
    await p3.route('**/chat/completions', (route) => {
      return new Promise((resolve) => setTimeout(resolve, 20_000)).then(() =>
        route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body: 'data: [DONE]\n\n' })
      )
    })
    await p3.goto(`${BASE}/#/`)
    await p3.getByRole('heading', { name: '我的简历' }).waitFor({ timeout: 15000 })
    const stopId = await idbAddResume(p3, '停止测试', '# 停止测试\n\n一段内容。', 'minimal')
    await idbSetSetting(p3, 'aiApiKey', 'test-key')
    await idbSetSetting(p3, 'aiBaseUrl', 'https://mock.local/v1')
    await p3.goto(`${BASE}/#/resume/${stopId}`)
    await p3.reload()
    await p3.locator('.editor-canvas').waitFor({ timeout: 10000 })
    await p3.locator('.ProseMirror').click()
    await p3.keyboard.press('Control+a')
    await p3.locator('.bt-ai').waitFor({ timeout: 5000 })
    await p3.locator('.bt-ai').click()
    await p3.getByRole('dialog').waitFor({ timeout: 5000 })
    /* 润色模式打开即自动执行：加载中出现「停止」按钮 */
    const stopBtn = p3.getByRole('button', { name: '停止' })
    await stopBtn.waitFor({ timeout: 5000 })
    await stopBtn.click()
    /* 无任何生成内容：展示「已停止生成」中性状态（而非红色报错） */
    await p3.getByText('已停止生成').waitFor({ timeout: 5000 })
    ok('ai stop button (polish)')
    await stopCtx.close()
  } catch (e) {
    fail('ai stop button (polish)', e)
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
    /* 2j. 状态栏页数：单页只报单页信息（可能是「1 页」/「已撑满至 1 页」/「未满页 · 填充 N%」，
       短内容被智能一页舒展后不再是纯「1 页」）；超长内容显示多页警告 */
    const shortBar = (await page.locator('[data-testid="editor-toolbar"]').textContent()) || ''
    if (!/1 页|未满页/.test(shortBar)) throw new Error(`单页状态栏文案异常：${shortBar}`)
    if (/内容 \d+ 页/.test(shortBar)) throw new Error('短内容不应出现多页警告')
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
    /* 建含锚点句子的简历（建议的 original 必须能在文档中逐字定位）；IDB 需同源页面。
       新上下文为空状态（顶栏按钮隐藏）：等待应用标题即可，随后的 reload 会带上简历 */
    await p2.goto(`${BASE}/#/`)
    await p2.getByRole('heading', { name: '我的简历' }).waitFor({ timeout: 15000 })
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
    /* 2m-1. 列表卡片实时缩略图：卡片内渲染 resume-thumb（真实内容首屏可见） */
    await page.goto(`${BASE}/#/`)
    await page.getByRole('button', { name: '新建简历' }).waitFor({ timeout: 10000 })
    await page.locator('[data-testid="resume-thumb"]').first().waitFor({ timeout: 10000 })
    ok('list card thumbnail renders')
  } catch (e) {
    fail('list card thumbnail renders', e)
  }

  try {
    /* 2m-2. 编辑→预览滚动联动：光标移到多页文档末尾块 → 预览滚动位置变化 */
    scrollId = await idbAddResume(page, '联动测试', longMd, 'minimal')
    await page.goto(`${BASE}/#/resume/${scrollId}`)
    await page.reload()
    await page.locator('.editor-canvas').waitFor({ timeout: 10000 })
    await page.waitForTimeout(1200) /* 等智能一页测量收敛（多页保留） */
    const scrolled = await page
      .locator('[data-testid="preview-viewport"]')
      .evaluate((el) => el.scrollHeight > el.clientHeight)
    if (!scrolled) throw new Error('preview not scrollable (content too short?)')
    const before = await page.locator('[data-testid="preview-viewport"]').evaluate((el) => el.scrollTop)
    await page.locator('.ProseMirror').click()
    await page.keyboard.press('Control+End') /* 光标移到文档末尾块 */
    await page.keyboard.press('End')
    await page.waitForTimeout(600)
    const after = await page.locator('[data-testid="preview-viewport"]').evaluate((el) => el.scrollTop)
    if (after <= before) throw new Error(`preview did not follow caret (before=${before} after=${after})`)
    ok('edit→preview scroll follow')
  } catch (e) {
    fail('edit→preview scroll follow', e)
  }

  try {
    /* 2m-3. 窄屏适配：<1024px 显示「编辑/预览」标签页，切换只显示对应面板 */
    const mobCtx = await browser.newContext({ viewport: { width: 780, height: 900 } })
    const pm = await mobCtx.newPage()
    const mobErrors = []
    pm.on('pageerror', (e) => mobErrors.push(e.message))
    /* 新 context 无 IndexedDB 数据：先建实习简历再进编辑器 */
    await pm.goto(`${BASE}/#/`)
    await pm.getByRole('heading', { name: '我的简历' }).waitFor({ timeout: 15000 })
    const mobId = await idbAddResume(pm, '移动测试', longMd, 'minimal')
    await pm.goto(`${BASE}/#/resume/${mobId}`)
    await pm.locator('.editor-canvas').waitFor({ timeout: 10000 })
    await pm.getByTestId('mobile-view-edit').waitFor({ timeout: 5000 })
    await pm.getByTestId('mobile-view-preview').click()
    /* 预览面板可见、编辑器隐藏 */
    await pm.locator('[data-testid="preview-viewport"]').waitFor({ timeout: 5000 })
    const editorHidden = !(await pm.locator('.editor-canvas').isVisible().catch(() => false))
    if (!editorHidden) throw new Error('editor still visible in preview tab')
    /* 切回编辑：编辑器可见、预览隐藏 */
    await pm.getByTestId('mobile-view-edit').click()
    await pm.locator('.editor-canvas').waitFor({ timeout: 5000 })
    if (mobErrors.length) throw new Error('page errors: ' + mobErrors.join(' | '))
    ok('narrow viewport edit/preview tabs')
    await mobCtx.close()
  } catch (e) {
    fail('narrow viewport edit/preview tabs', e)
  }

  try {
    /* 2m-4. 文字版 PDF：菜单项触发打印链路（headless 下以空函数代替 window.print 防弹框）。
       覆盖：克隆纸张 → 调用打印 → 清理 [data-print-sheet] 容器 */
    const printCtx = await browser.newContext()
    const p4 = await printCtx.newPage()
    await p4.addInitScript(() => {
      window.print = () => {}
    })
    const printErrors = []
    p4.on('pageerror', (e) => printErrors.push(e.message))
    /* 新 context 无 IndexedDB 数据：先建简历再进编辑器 */
    await p4.goto(`${BASE}/#/`)
    await p4.getByRole('heading', { name: '我的简历' }).waitFor({ timeout: 15000 })
    const printId = await idbAddResume(p4, '打印测试', longMd, 'minimal')
    await p4.goto(`${BASE}/#/resume/${printId}`)
    await p4.reload()
    await p4.locator('.editor-canvas').waitFor({ timeout: 10000 })
    await p4.getByRole('button', { name: '文件' }).click()
    await p4.getByRole('menuitem', { name: /导出文字版 PDF/ }).click()
    await p4.waitForTimeout(400)
    if ((await p4.locator('[data-print-sheet]').count()) !== 0)
      throw new Error('print sheet host not cleaned up')
    if (printErrors.length) throw new Error('page errors: ' + printErrors.join(' | '))
    ok('text-vector pdf menu + print pipeline')
    await printCtx.close()
  } catch (e) {
    fail('text-vector pdf menu + print pipeline', e)
  }

  try {
    /* 2m-5. 排版档位：设置 → 切「紧凑」→ 编辑器画布与预览纸张挂 layout-compact → 恢复标准 */
    await page.goto(`${BASE}/#/resume/${scrollId}`)
    await page.locator('.editor-canvas').waitFor({ timeout: 10000 })
    await page.getByRole('button', { name: '设置' }).click()
    await page.getByTestId('layout-compact').waitFor({ timeout: 5000 })
    await page.getByTestId('layout-compact').click()
    await page.waitForTimeout(600)
    if ((await page.locator('.editor-canvas.layout-compact').count()) !== 1)
      throw new Error('editor canvas missing layout-compact class')
    if ((await page.locator('[data-testid="resume-paper"] .layout-compact').count()) < 1)
      throw new Error('preview paper missing layout-compact class')
    await page.getByTestId('layout-standard').click()
    await page.waitForTimeout(300)
    await page.keyboard.press('Escape')
    ok('layout density settings applied')
  } catch (e) {
    fail('layout density settings applied', e)
  }

  try {
    /* 2m-6. AI 多配置档：保存两套配置 → 下拉出现 → 切换 → 字段回填闭环 */
    await page.getByRole('button', { name: '设置' }).click()
    await page.getByTestId('ai-profile-save').waitFor({ timeout: 5000 })
    if ((await page.getByTestId('ai-profile-select').count()) !== 0)
      throw new Error('select should not exist before saving first profile')
    const keyInput = page.locator('#ai-api-key')
    await keyInput.fill('pk-1')
    await page.getByTestId('ai-profile-save').click()
    /* 已选中「配置 1」：选回空选项 → 再保存为「配置 2」 */
    const select = page.getByTestId('ai-profile-select')
    await select.waitFor({ timeout: 5000 })
    await select.selectOption('')
    await keyInput.fill('pk-2')
    await page.getByTestId('ai-profile-save').click()
    const optCount = await select.locator('option').count()
    if (optCount < 2) throw new Error(`expected >=2 profile options, got ${optCount}`)
    /* 切到「配置 1」→ Key 输入回填 */
    await select.selectOption({ label: '配置 1' })
    await page.waitForTimeout(300)
    const val = await keyInput.inputValue()
    if (val !== 'pk-1') throw new Error(`expected key pk-1 after switch, got ${val}`)
    ok('ai profile save/switch/refill')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
  } catch (e) {
    fail('ai profile save/switch/refill', e)
  }

  try {
    /* 2m-7. Word（.docx）导出：文件菜单 → 下载 blod */
    /* 确保设置弹窗已关闭（前用例 Escape），避免遮挡顶栏「文件」按钮 */
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    await page.getByRole('button', { name: '文件' }).click()
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 60000 }),
      page.getByRole('menuitem', { name: /导出 Word/ }).click(),
    ])
    const p = await dl.path()
    if (!p) throw new Error('no docx download path')
    ok('docx export downloads')
  } catch (e) {
    fail('docx export downloads', e)
  }

  try {
    /* 2m-8. PWA 资源：manifest 与 SW 在服务端可达（.webmanifest / sw.js）；PWA 注册在 dev 不启用 */
    for (const asset of ['manifest.webmanifest', 'sw.js', 'icon-192.png', 'icon-512.png']) {
      const res = await page.request.get(`${BASE}/${asset}`)
      if (!res.ok()) throw new Error(`${asset} => ${res.status()}`)
    }
    const manifest = await (await page.request.get(`${BASE}/manifest.webmanifest`)).json()
    if (!manifest.name || !manifest.display) throw new Error('manifest fields missing')
    ok('pwa static assets served')
  } catch (e) {
    fail('pwa static assets served', e)
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
    await page.getByText('已删除').first().waitFor({ timeout: 5000 })
    ok('delete confirm dialog')
  } catch (e) {
    fail('delete confirm dialog', e)
  }

  try {
    /* 2n-1. 窄屏顶栏：不横向溢出（<768 折叠进「更多」），工具条不换行撑高，功能仍可达。
       回归背景：实测顶栏完整操作组最小需 768px，390px 下曾整页横向溢出 342px */
    for (const w of [390, 480, 640]) {
      const narrowCtx = await browser.newContext({ viewport: { width: w, height: 860 } })
      const np = await narrowCtx.newPage()
      await np.goto(`${BASE}/#/`)
      await np.getByRole('heading', { name: '我的简历' }).waitFor({ timeout: 15000 })
      const nid = await idbAddResume(np, '窄屏测试', '# 窄屏\n\n一段内容。', 'minimal')
      await np.goto(`${BASE}/#/resume/${nid}`)
      await np.reload()
      await np.locator('.editor-canvas').waitFor({ timeout: 15000 })
      await np.waitForTimeout(600)
      const m = await np.evaluate(() => ({
        over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        toolbarH: document.querySelector('[data-testid="editor-toolbar"]')?.getBoundingClientRect().height,
      }))
      if (m.over > 0) throw new Error(`W${w}：页面横向溢出 ${m.over}px（顶栏未折叠）`)
      if (m.toolbarH !== 44) throw new Error(`W${w}：工具条高度 ${m.toolbarH}px，期望 44（仍会换行）`)
      /* 「更多」菜单里关键入口仍可达（模板 / 导出 Word / 设置） */
      await np.getByTestId('header-more').click()
      await np.getByRole('menuitem', { name: /^模板/ }).waitFor({ timeout: 3000 })
      await np.getByRole('menuitem', { name: /导出 Word/ }).waitFor({ timeout: 3000 })
      await np.keyboard.press('Escape')
      /* 编辑器工具条「更多」含语法检查 / JD 匹配 */
      await np.getByTestId('editor-more').click()
      await np.getByRole('menuitem', { name: '语法检查' }).waitFor({ timeout: 3000 })
      await np.getByRole('menuitem', { name: /JD 匹配/ }).waitFor({ timeout: 3000 })
      await np.keyboard.press('Escape')
      await narrowCtx.close()
    }
    ok('narrow header + toolbar fold, no horizontal overflow')
  } catch (e) {
    fail('narrow header fold', e)
  }

  try {
    /* 2n-2. 列表搜索 / 清除搜索 / 无结果态 */
    await page.goto(`${BASE}/#/`)
    await page.getByRole('button', { name: '新建简历' }).waitFor({ timeout: 10000 })
    await idbAddResume(page, 'ZZZ 唯一标题', '# ZZZ\n\n一段内容。', 'minimal')
    await page.reload()
    await page.getByRole('button', { name: '新建简历' }).waitFor({ timeout: 10000 })
    const total = await page.locator('[role="button"]').count()
    const search = page.getByTestId('resume-search')
    await search.fill('ZZZ 唯一标题')
    await page.waitForTimeout(300)
    const hit = await page.locator('[role="button"]').count()
    if (hit !== 1) throw new Error(`搜索命中 ${hit} 张卡片，期望 1`)
    await search.fill('绝不存在的关键字qqq')
    await page.waitForTimeout(300)
    if ((await page.locator('[role="button"]').count()) !== 0) throw new Error('无结果时仍在渲染卡片')
    await page.getByRole('button', { name: '清除搜索' }).click()
    await page.waitForTimeout(300)
    const back = await page.locator('[role="button"]').count()
    if (back !== total) throw new Error(`清除搜索后 ${back} 张卡片，期望 ${total}`)
    ok('list search + no-match state')
  } catch (e) {
    fail('list search', e)
  }

  try {
    /* 2n-3. 删除可撤销：卡片数 -1 → 点提示条「撤销」→ 恢复原 id 与标题 */
    await page.goto(`${BASE}/#/`)
    await page.getByRole('button', { name: '新建简历' }).waitFor({ timeout: 10000 })
    await idbAddResume(page, '撤销测试简历', '# 撤销测试\n\n一段内容。', 'minimal')
    await page.reload()
    await page.locator('[role="button"]').first().waitFor({ timeout: 10000 })
    const before = await page.locator('[role="button"]').count()
    const card = page.getByText('撤销测试简历').first()
    const cardBox = page.locator('[role="button"]').filter({ hasText: '撤销测试简历' }).first()
    await cardBox.hover()
    await cardBox.locator('button[aria-label="文档操作"]').click()
    await page.getByRole('menuitem', { name: '删除' }).click()
    await page.getByRole('button', { name: '删除', exact: true }).click()
    await page.getByText('已删除').first().waitFor({ timeout: 5000 })
    await page.waitForTimeout(400)
    const afterDel = await page.locator('[role="button"]').count()
    if (afterDel !== before - 1) throw new Error(`删除后 ${afterDel} 张卡片，期望 ${before - 1}`)
    await page.getByRole('button', { name: '撤销' }).click()
    await page.getByText('已恢复', { exact: false }).first().waitFor({ timeout: 5000 })
    await page.waitForTimeout(400)
    const afterUndo = await page.locator('[role="button"]').count()
    if (afterUndo !== before) throw new Error(`撤销后 ${afterUndo} 张卡片，期望 ${before}`)
    if (!(await card.isVisible())) throw new Error('撤销后标题未恢复')
    ok('delete undo restores resume')
  } catch (e) {
    fail('delete undo', e)
  }

  try {
    /* 2n-4. 预览纸张观感：降亮度浮层只存在于预览层（兄弟节点），不在纸张内部 → 导出不带 */
    await page.goto(`${BASE}/#/`)
    await page.getByRole('button', { name: '新建简历' }).waitFor({ timeout: 10000 })
    const toneId = await idbAddResume(page, '纸张观感测试', longMd, 'minimal')
    await page.goto(`${BASE}/#/resume/${toneId}`)
    await page.reload()
    await page.locator('.editor-canvas').waitFor({ timeout: 10000 })
    await page.getByRole('button', { name: '设置' }).click()
    await page.getByTestId('paper-dim').waitFor({ timeout: 5000 })
    await page.getByTestId('paper-dim').click()
    await page.waitForTimeout(400)
    if ((await page.locator('.paper-tone-overlay.paper-tone-dim').count()) !== 1)
      throw new Error('未出现降亮度浮层')
    if ((await page.locator('[data-testid="resume-paper"] .paper-tone-overlay').count()) !== 0)
      throw new Error('浮层落在纸张内部，会被导出到 PDF/长图')
    await page.getByTestId('paper-white').click()
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    ok('preview paper tone stays on screen only')
  } catch (e) {
    fail('preview paper tone', e)
  }

  try {
    /* 2o-1. 智能一页双向适配：内容不足一页时也要撑满（原先只有"超页才压缩"）。
       6 个块的内容应进入舒展档并报「已撑满至 1 页」 */
    await page.goto(`${BASE}/#/`)
    await page.getByRole('button', { name: '新建简历' }).waitFor({ timeout: 10000 })
    const shortMd = Array.from(
      { length: 6 },
      () => '## 段落标题\n\n- 条目内容用于撑高页面，包含一些描述文字。\n- 第二条目内容。'
    ).join('\n\n')
    const growId = await idbAddResume(page, '短内容撑满', shortMd, 'minimal')
    await page.goto(`${BASE}/#/resume/${growId}`)
    await page.reload()
    await page.locator('.editor-canvas').waitFor({ timeout: 10000 })
    await page.waitForTimeout(3200) /* 等智能一页收敛（静默期 1.35s + 余量） */
    const layerCls = (await page.locator('.rs-scale-layer').first().getAttribute('class')) || ''
    if (!/rs-airy|rs-roomy/.test(layerCls))
      throw new Error(`内容不足一页未进入舒展档：${layerCls}`)
    await page.getByText(/已撑满至 1 页/).first().waitFor({ timeout: 5000 })
    /* 节奏档不能挂在模板根上：会被 React 已提交的档盖住量尺的临时档 → 决策失真 */
    const rootCls =
      (await page.locator('.rs-scale-layer > *').first().getAttribute('class')) ||
      ''
    if (/rs-airy|rs-roomy|rs-compact|rs-tight/.test(rootCls))
      throw new Error(`模板根不应挂节奏档：${rootCls}`)
    ok('smart one page expands short content to fill')
  } catch (e) {
    fail('smart one page expand', e)
  }

  try {
    /* 2o-2. 编辑后档位不来回跳：历史 bug 是量尺被模板根盖住 → 提交了一个错误中间档
       （预览先松后紧跳一下）。一次内容变化只允许一次档位切换。 */
    const readCls = () =>
      page.evaluate(() => {
        const el = document.querySelector('.rs-scale-layer')
        return (
          ['rs-compact', 'rs-tight', 'rs-airy', 'rs-roomy'].find((c) => el?.classList.contains(c)) ??
          '原始'
        )
      })
    await page.locator('.ProseMirror').click()
    await page.keyboard.press('Control+End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('## 追加板块\n\n- 新增条目，用于改变文档高度并触发重新收敛。')
    const seq = []
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(200)
      seq.push(await readCls())
    }
    let flips = 0
    for (let i = 1; i < seq.length; i++) if (seq[i] !== seq[i - 1]) flips++
    if (flips > 1) throw new Error(`档位来回切换 ${flips} 次：${[...new Set(seq)].join(' → ')} [${seq.join(',')}]`)
    ok('smart one page level changes at most once per edit')
  } catch (e) {
    fail('smart one page stability', e)
  }

  try {
    /* 2p-1. 表格在 Markdown 往返中不丢：列对齐 + 多段落单元格 + 单元格内竖线。
       历史 bug：单元格多一个段落时整张表被写成 `[table]` 占位符，内容全丢；
       对齐属性也没有 GFM 标记，源码模式改一笔就全部丢失（且自动保存会落库）。 */
    await page.goto(`${BASE}/#/`)
    await page.getByRole('heading', { name: '我的简历' }).waitFor({ timeout: 15000 })
    const mp = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
    const th = (t, align) => ({ type: 'tableHeader', attrs: { align }, content: [mp(t)] })
    const td = (t, align, extra) => ({
      type: 'tableCell',
      attrs: { align },
      content: extra ? [mp(t), mp(extra)] : [mp(t)],
    })
    const tableDoc = JSON.stringify({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '陈墨' }] },
        {
          type: 'table',
          content: [
            { type: 'tableRow', content: [th('年份', 'right'), th('经历', 'center')] },
            { type: 'tableRow', content: [td('2022', 'right'), td('某公司', 'center', '第二段')] },
          ],
        },
      ],
    })
    const tableId = await idbAddResume(page, '表格保真', tableDoc, 'minimal')
    await page.goto(`${BASE}/#/resume/${tableId}`)
    await page.reload()
    await page.locator('.editor-canvas').waitFor({ timeout: 15000 })
    await page.waitForTimeout(800)
    const readAligns = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('.ProseMirror table th, .ProseMirror table td')].map((c) => ({
          align: c.getAttribute('data-align'),
          text: c.textContent,
        }))
      )
    const alignsBefore = await readAligns()
    if (alignsBefore.length !== 4) throw new Error(`表格未正确渲染：${alignsBefore.length} 个单元格`)

    /* 导出 .md：必须是管道表格，含 GFM 对齐标记，且单元格内容不丢 */
    const [mdDl] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      (async () => {
        await page.getByRole('button', { name: '文件' }).click()
        await page.getByRole('menuitem', { name: /导出 \.md/ }).click()
      })(),
    ])
    const mdTable = fs.readFileSync(await mdDl.path(), 'utf-8')
    if (mdTable.includes('[table]')) throw new Error('表格被写成 [table] 占位符')
    if (!mdTable.includes('---:') || !mdTable.includes(':---:')) throw new Error('缺少 GFM 对齐标记')
    if (!mdTable.includes('第二段')) throw new Error('多段落单元格内容丢失')

    /* 源码模式往返（真实改一笔才会回写）后对齐必须保持 */
    await page.getByRole('button', { name: '源码', exact: true }).click()
    const srcBox = page.getByTestId('source-editor')
    await srcBox.waitFor({ timeout: 5000 })
    await srcBox.click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type('\n\n## 触发回写')
    await page.waitForTimeout(900)
    await page.getByRole('button', { name: '源码', exact: true }).click()
    await page.locator('.ProseMirror').waitFor({ timeout: 5000 })
    await page.waitForTimeout(500)
    const alignsAfter = await readAligns()
    if (alignsAfter.length !== alignsBefore.length)
      throw new Error(`往返后单元格数变化：${alignsBefore.length} → ${alignsAfter.length}`)
    alignsAfter.forEach((c, i) => {
      if (c.align !== alignsBefore[i].align)
        throw new Error(`第 ${i} 格对齐 ${alignsBefore[i].align} → ${c.align}`)
    })
    ok('markdown roundtrip preserves table cells + alignment')
  } catch (e) {
    fail('table markdown fidelity', e)
  }

  try {
    /* 2p-2. 备份不含任何明文密钥：顶层 aiApiKey 与配置档内的 apiKey 都必须清空
       （UI 明确承诺「不含 API Key」，只剥顶层字段会漏掉 aiProfiles[].apiKey） */
    await page.goto(`${BASE}/#/`)
    await page.getByRole('heading', { name: '我的简历' }).waitFor({ timeout: 15000 })
    await page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const open = indexedDB.open('ink-resume')
          open.onsuccess = () => {
            const db = open.result
            const tx = db.transaction('settings', 'readwrite')
            const store = tx.objectStore('settings')
            store.put({ key: 'aiApiKey', value: 'sk-top-secret' })
            store.put({
              key: 'aiProfiles',
              value: [
                { id: 'p1', name: '档1', baseUrl: 'https://x/v1', model: 'm', apiKey: 'sk-profile-secret' },
              ],
            })
            tx.oncomplete = () => {
              db.close()
              resolve()
            }
            tx.onerror = () => reject(tx.error)
          }
        })
    )
    await page.reload()
    await page.getByRole('button', { name: '设置' }).click()
    const [bkDl] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      page.getByRole('button', { name: '导出 JSON' }).click(),
    ])
    const backup = fs.readFileSync(await bkDl.path(), 'utf-8')
    if (backup.includes('sk-top-secret') || backup.includes('sk-profile-secret')) {
      throw new Error('备份文件包含明文密钥')
    }
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    ok('backup export contains no api keys')
  } catch (e) {
    fail('backup key hygiene', e)
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
