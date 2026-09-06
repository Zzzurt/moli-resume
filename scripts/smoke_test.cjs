// 墨历简历编辑器 · 块级富文本（Tiptap）端到端冒烟测试（开发用脚本，不参与构建）
const { chromium } = require('playwright')
const path = require('path')
const fs = require('fs')

const BASE = 'http://localhost:5173'
const SHOT = path.join(__dirname, 'shots')
fs.mkdirSync(SHOT, { recursive: true })

// 1x1 测试图片（证件照上传用）
const PHOTO = path.join(SHOT, 'test-photo.png')
fs.writeFileSync(PHOTO, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))

const errors = []
function check(name, cond) {
  console.log((cond ? 'PASS ' : 'FAIL ') + name)
  if (!cond) errors.push(name)
}

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const consoleErrors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })

  await page.goto(BASE)
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(800)

  // 1. 列表页空状态
  check('列表页标题', (await page.locator('text=我的简历').count()) > 0)
  check('空状态引导', (await page.locator('text=从这里开始你的第一份简历').count()) > 0)
  await page.screenshot({ path: `${SHOT}/01-list-empty.png` })

  // 2. 创建示例简历（Markdown 内容 → 首次打开自动迁移为 JSON）
  await page.click('text=创建示例简历')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1500)
  check('进入编辑器(URL)', page.url().includes('/resume/'))

  const pm = page.locator('.ProseMirror')
  check('ProseMirror 编辑器挂载', (await pm.count()) === 1)
  check('WYSIWYG: 编辑器内 h1 渲染', (await page.locator('.editor-canvas .ProseMirror h1').count()) >= 1)
  check('WYSIWYG: 编辑器内列表渲染', (await page.locator('.editor-canvas .ProseMirror ul').count()) >= 1)
  await page.screenshot({ path: `${SHOT}/02-editor-wysiwyg.png` })

  // 3. 编辑器块 data-index 绑定
  const editorBlocks = page.locator('.editor-canvas .ProseMirror > [data-index]')
  check('编辑器块 data-index', (await editorBlocks.count()) >= 10)
  check('编辑器首块 data-index=0', (await editorBlocks.first().getAttribute('data-index')) === '0')

  // 4. 预览渲染 + data-index 对齐
  check('预览纸张', (await page.locator('.resume-paper').count()) === 1)
  check('预览姓名', (await page.locator('.resume-paper h1').first().innerText()).trim() === '陈墨')
  const pvBlocks = page.locator('.resume-paper [data-index]')
  check('预览块 data-index', (await pvBlocks.count()) >= 10)
  check('编辑/预览块数一致', (await editorBlocks.count()) === (await pvBlocks.count()))
  check('简约模板类（预览）', (await page.locator('.resume-paper .tpl-minimal').count()) === 1)

  // 5. 点击预览块 → 编辑器对应块滚动 + 闪烁高亮
  await pvBlocks.nth(6).click()
  await page.waitForTimeout(400)
  check('点击预览→编辑器块高亮', (await page.locator('.block-flash-overlay').count()) === 1)
  await page.screenshot({ path: `${SHOT}/03-click-to-block.png` })

  // 6. WYSIWYG 输入：清空重写（Markdown 输入规则即时转换）
  await pm.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('# 测试简历')
  await page.keyboard.press('Enter')
  await page.keyboard.type('- 邮箱：test@example.com')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)
  check('输入规则: # → h1', (await page.locator('.editor-canvas .ProseMirror h1').innerText()).trim() === '测试简历')
  check('输入规则: - → 列表', (await page.locator('.editor-canvas .ProseMirror li').count()) === 1)

  // 7. 斜杠命令：/ → 菜单 → 标题二
  await page.keyboard.type('/')
  await page.waitForTimeout(350)
  check('斜杠菜单弹出', (await page.locator('.slash-menu .slash-item').count()) >= 5)
  await page.screenshot({ path: `${SHOT}/04-slash-menu.png` })
  await page.click('.slash-item:has-text("标题二")')
  await page.waitForTimeout(200)
  await page.keyboard.type('工作经历')
  await page.keyboard.press('Enter')
  await page.keyboard.type('负责核心业务的前端架构与性能优化')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)
  check('斜杠命令: 转为 H2', (await page.locator('.editor-canvas .ProseMirror h2').innerText()).trim() === '工作经历')
  check('预览同步 H2', (await page.locator('.resume-paper h2').innerText()).trim() === '工作经历')

  // 8. 悬浮工具栏：选中文本 → 加粗（点击文字实体上，避免落到行尾空白）
  await page
    .locator('.editor-canvas .ProseMirror p', { hasText: '负责核心业务' })
    .dblclick({ position: { x: 40, y: 11 } })
  await page.waitForTimeout(350)
  check('悬浮工具栏出现', (await page.locator('.bubble-toolbar').count()) === 1)
  await page.screenshot({ path: `${SHOT}/05-bubble-toolbar.png` })
  await page.click('.bubble-toolbar button[title="加粗"]')
  await page.waitForTimeout(300)
  check('加粗生效', (await page.locator('.editor-canvas .ProseMirror strong').count()) >= 1)
  await page.keyboard.press('Escape')

  // 9. Drag Handle：hover 块 → 手柄 → 点击 → 块菜单 → 删除
  const h2Box = await page.locator('.editor-canvas .ProseMirror h2').boundingBox()
  await page.mouse.move(h2Box.x + 80, h2Box.y + 12)
  await page.waitForTimeout(350)
  const handleBox = await page.locator('.drag-handle').boundingBox()
  check('拖拽手柄出现', !!handleBox)
  if (handleBox) {
    await page.screenshot({ path: `${SHOT}/06-drag-handle.png` })
    await page.mouse.click(handleBox.x + 8, handleBox.y + 8)
    await page.waitForTimeout(350)
    check('块菜单弹出', (await page.locator('.block-menu').count()) === 1)
    await page.screenshot({ path: `${SHOT}/07-block-menu.png` })
    const blockCountBefore = await page.locator('.editor-canvas .ProseMirror > [data-index]').count()
    await page.click('.block-menu button:has-text("删除此块")')
    await page.waitForTimeout(400)
    const blockCountAfter = await page.locator('.editor-canvas .ProseMirror > [data-index]').count()
    check('删除块生效', blockCountAfter === blockCountBefore - 1)
  }

  // 10. 证件照上传（简约模板 → 浮动右上）
  check('照片占位框', (await page.locator('.photo-empty').count()) === 1)
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('.photo-empty').click(),
  ])
  await fileChooser.setFiles(PHOTO)
  await page.waitForTimeout(600)
  check('证件照已显示', (await page.locator('.resume-paper .photo-spot img').count()) === 1)
  await page.screenshot({ path: `${SHOT}/08-photo.png` })

  // 11. 模板切换：经典
  await page.click('button:has-text("简约")')
  await page.waitForTimeout(300)
  await page.click('div[role="menuitem"]:has-text("经典")')
  await page.waitForTimeout(500)
  check('经典模板类（预览）', (await page.locator('.resume-paper .tpl-classic').count()) === 1)
  await page.screenshot({ path: `${SHOT}/09-classic.png` })

  // 12. 模板切换：现代（双栏 + 侧栏照片）
  await page.click('button:has-text("经典")')
  await page.waitForTimeout(300)
  await page.click('div[role="menuitem"]:has-text("现代")')
  await page.waitForTimeout(500)
  check('现代模板类（预览）', (await page.locator('.resume-paper .tpl-modern').count()) === 1)
  check('现代侧栏', (await page.locator('.rs-sidebar').count()) === 1)
  check('侧栏照片', (await page.locator('.rs-sidebar .photo-spot img').count()) === 1)
  await page.screenshot({ path: `${SHOT}/10-modern.png` })

  // 13. 深色模式（编辑区跟随，纸张保持白底）
  await page.click('button[aria-label="切换主题"]')
  await page.waitForTimeout(400)
  check('深色模式 html.dark', await page.evaluate('document.documentElement.classList.contains("dark")'))
  await page.screenshot({ path: `${SHOT}/11-dark.png` })
  await page.click('button[aria-label="切换主题"]')
  await page.waitForTimeout(300)

  // 14. 保存状态指示
  check(
    '保存状态指示',
    (await page.locator('text=已保存').count()) > 0 ||
      (await page.locator('text=保存中').count()) > 0 ||
      (await page.locator('text=待保存').count()) > 0
  )

  // 15. 设置弹窗
  await page.click('button[aria-label="设置"]')
  await page.waitForTimeout(400)
  check('设置弹窗', (await page.locator('text=AI 模型').count()) > 0)
  check('Base URL 输入框', (await page.locator('#ai-base-url').count()) === 1)
  check('API Key 输入框', (await page.locator('#ai-api-key').count()) === 1)
  check('数据备份区', (await page.locator('text=数据备份').count()) > 0)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  // 16. 返回列表 → 卡片存在
  await page.click('button[aria-label="返回列表"]')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(800)
  check('列表出现卡片', (await page.locator('text=我的简历').count()) > 0 && (await page.locator('.group').count()) >= 1)
  await page.screenshot({ path: `${SHOT}/12-list-card.png` })

  console.log('\n控制台错误:', consoleErrors.length ? consoleErrors : '无')
  await browser.close()

  console.log()
  if (errors.length) {
    console.log(`共 ${errors.length} 项失败:`, errors)
    process.exit(1)
  }
  console.log('全部通过')
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
