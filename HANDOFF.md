# HANDOFF：胶囊模板 + 主题色自定义（✅ 已全部完成，2026-09-06）

> 交接时间：2026-09-06。本文档由上一个 agent 写于「模板美化」任务进行到一半时。
> **完成记录（2026-09-06 第二棒 agent）**：下列剩余工作 1~5 全部完成并验证通过——
> tsc ✓、冒烟 8/8 ✓、8 模板截图 ✓、主题色注入验证（pill/business × 默认/橙/紫）✓、
> 顶栏菜单真实点击 → 编辑器+预览即时同步 ✓、生产 build ✓。
> 新增验证脚本：`scripts/shoot_accent.cjs`（主题色注入截图）、`scripts/shoot_editor_accent.cjs`（编辑器同步+菜单交互）。
> 实现备注：accentColor 内联在 tpl-* 元素本身（祖先覆盖会被类定义赢过，详见 Preview.tsx accentStyle 注释）；
> Playwright 验证 settings 类全局状态时，hash 路由 goto 是同文档导航不重载页面，必须 page.reload() 才能重读 IndexedDB。
> 前置上下文：本会话已完成 智能一页 v2（密度分级）、7 个模板（minimal/classic/modern/tech标准/elegant雅致/sleek清爽/business商务）、
> h3 `主体 | 日期` 右对齐拆分（DocRenderer.splitEntryHeading，已验证）。全部回归通过后才开始的当前任务。

## 任务背景

用户要求参考 **Magic Resume** 与 **木及简历** 的模板做法。调研结论（已完成）：

- **Magic Resume**（github.com/JOYCEQL/magic-resume，Apache 2.0）：模板 = 4 个 artboard React 组件按 templateId 分发；
  核心思路是「一套排版 + 实时可调 ThemeConfig」（primaryColor/fontSize/lineHeight/margin/imageShape），
  theme 定义在 `src/theme/themeConfig.ts`（默认 primaryColor #3B82F6、Inter、14px、1.6、margin 40）。
- **木及简历**（github.com/hua1995116/react-resume-site，开源）：主题 = Less 文件（public/themes：default/blue/orange/purple）。
  default 主题签名元素：**h1 28px/900 白字压在 accent 色带内（padding 20px 0，左右 50px 边距）**；
  **h2 = 居中圆角胶囊（border-radius 32px、#eee 底）+ 左右通栏细线（::before/::after 1px #ededed）**；
  PingFang SC、正文 14px、列表 13px、**方形列表标记（list-style: square）**、行高 1.8/20px、代码块 chip 底 rgba(27,31,35,0.05) 圆角 4px。

据此决定落地两件事：**① 主题色实时自定义（学 Magic Resume）②「胶囊」模板（学木及）**。

## 当前状态（代码已改的部分，直接可用）

1. `src/types/index.ts` — ✅ 已改：
   - `TemplateId` 已含 `'pill'`（共 8 个 id）
   - `AppSettings` 已加 `accentColor?: string`（空 = 模板默认）
   - `TEMPLATES` 已含 pill 条目（name 胶囊，dotClass `bg-[#3b82f6]`）
2. `src/components/preview/DocRenderer.tsx` — ✅ 已改：h2 渲染为 `<h2><span className="h2-inner">{inner}</span></h2>`（胶囊模板布局锚点；其他模板 span 为 inline 不受影响）
3. `src/components/preview/DocRenderer.tsx` — ✅ 此前已完成并验证：`splitEntryHeading`（h3 按最后一个 `|` 拆主体/日期，分隔符丢弃）

## 剩余工作（按顺序做）

### 1. `src/index.css`：新增 `.tpl-pill` 模板块

插在 `.tpl-business` 块之后（表格操作浮层 section 之前）。要点：
- 走统一的 `--rs-*` 密度变量体系（参考任意现有模板块的 calc 写法，density 类 rs-compact/rs-tight 自动生效）
- 设计规格（源自木及分析，CSS 自行实现）：
  - `--rs-accent: #3b82f6; --rs-secondary: #6b7280; --rs-rule: #ededed; --rs-lh: 1.7; --rs-pad-y: 36px; --rs-h2t: 20px; --rs-h2b: 8px; --rs-h3t: 12px; --rs-pg/lst: 5px; --rs-lit: 2px; --rs-hrg: 16px`
  - 字体 PingFang/雅黑 sans 栈，font-size 14px，color #333，padding `calc(var(--rs-pad-y) * var(--rs-pyk, 1)) 50px`
  - **h1 = 顶部色带**：`background: var(--rs-accent); color: #fff; text-align: center; font-size: 25px; font-weight: 800; padding: 14px 16px; margin: 0 0 16px; letter-spacing: 0.05em`
  - `h1 + p`：居中、secondary、weight 600
  - **联系方式行**：`.tpl-pill > ul:first-of-type` 居中横排、`·` 分隔（照抄 `.tpl-tech > ul:first-of-type` 的写法，分隔符 content 改 `'·'`、色 #d1d5db）——只匹配模板容器直接子列表
  - **胶囊节标题（必须 scoped 到预览，编辑器 PM DOM 没有 .h2-inner）**：
    ```css
    .resume-paper .tpl-pill h2 { display: flex; align-items: center; gap: 14px; font-size: 15px; font-weight: 700; color: #333; margin: calc(var(--rs-h2t) * var(--rs-h2tk, 1)) 0 calc(var(--rs-h2b) * var(--rs-h2bk, 1)); }
    .resume-paper .tpl-pill h2::before, .resume-paper .tpl-pill h2::after { content: ''; flex: 1; border-top: 1px solid #ededed; }
    .resume-paper .tpl-pill .h2-inner { background: #eef2f7; border-radius: 32px; padding: 5px 18px; }
    ```
  - ul 方块标记：`list-style: square`，`li::marker { color: #9ca3af }`
  - code chip：`background: rgba(27,31,35,0.05); border-radius: 4px; padding: 0 4px; font-size: 12.5px`
  - h3 13.5px/700 #333；blockquote/hr/table 按其他模板同款模式写
  - 暗色画布：`.dark .editor-canvas.tpl-*` 选择器列表里补 `.tpl-pill`（已核实：business 已在列表中，pill 未加——其 CSS 块尚不存在）

### 2. `src/components/preview/Preview.tsx`：接入 pill + accentColor

- `SINGLE_COL_CLASS` 加 `pill: 'tpl-pill'`
- 新 prop `accentColor?: string`（EditorPage 传 `settings.accentColor`）；`renderBody` 的两个 tpl div（单栏与双栏分支）加
  `style={accentColor ? ({ ['--rs-accent']: accentColor } as React.CSSProperties) : undefined}`
  ⚠️ 必须内联在 tpl 元素本身——tpl-* 类在自身上定义了 --rs-accent，祖先上的覆盖会被近处定义赢过
- 测量分身（measureRef 的 renderBody）自动带 accent ✓ 不用额外处理

### 3. `src/components/editor/TiptapEditor.tsx`

- `TPL_CLASS` 加 `pill: 'tpl-pill'`
- 加可选 prop `accentColor?: string`，编辑器画布 div（带 tplClass 的那个）同样内联 `--rs-accent`（同上 cast 写法），实现编辑区强调色同步

### 4. `src/components/layout/AppHeader.tsx`：主题色选择器

- 在「模板」下拉旁加一个「主题色」DropdownMenu；`useSettings()` 解构补 `settings, update`（当前只有 theme/toggleTheme）
- 预设色板：默认（清除 accentColor）+ 8 色：#2d6cdf / #4f46e5 / #0e7490 / #00a388 / #7c3aed / #e11d48 / #ea580c / #111827
- 选中调 `update('accentColor', hex)`，默认调 `update('accentColor', undefined)`；触发按钮显示当前色圆点
- persist 走现有 saveSetting，备份导出自动包含（Omit 的是 aiApiKey）

### 5. 验证（环境注意：npx/npm 不在 Git Bash PATH）

- node 路径：`/c/Users/Mr.Huo/AppData/Roaming/nvm/node.exe`；命令形如
  `<node> node_modules/typescript/bin/tsc --noEmit`、`<node> node_modules/vite/bin/vite.js --port 5199 --strictPort`（后台）、`<node> node_modules/vite/bin/vite.js build`
- 冒烟：先起 dev server，`BASE_URL=http://localhost:5199 <node> scripts/smoke.cjs`（8 项应全过）
- 截图：`scripts/shoot_templates.cjs` 存在（默认内容逐模板截图，数组里按需补 'business'/'pill'）；⚠️ 元素截图伪影——纸张高于预览滚动窗口时截图不完整，视口必须 ≥1500 高（脚本里已是 1600）
- 目检要点：pill 的色带/胶囊/细线/方块标记、主题色切换对 8 个模板即时生效、编辑器画布强调色同步、导出 PDF 颜色正确（内联 var 自动带出）
- 全过后 build、停 dev server、删 `scripts/shots*/` 临时目录

## 项目约定（新 agent 必读）

- 模板 = 纯 CSS 类 `tpl-<id>`，数据是统一的 Tiptap JSON；双栏模板（modern/sleek）用第一个 `---` 分侧栏，单栏模板注册在 Preview.SINGLE_COL_CLASS + TiptapEditor.TPL_CLASS
- 所有垂直节奏必须用 `calc(var(--rs-XX) * var(--rs-XXk, 1))` 变量写法，密度分级（rs-compact/rs-tight）才生效
- 智能一页：Preview.tsx 内密度状态机（0/1/2 档 + 迟滞缓存 + MIN_FIT_SCALE 0.85），不要动其收敛逻辑
- 条目排版约定：h3 `公司 · 职位 | 2022.03 - 至今` 自动日期右对齐；文档第一个列表在 tech/elegant/business(/pill) 中渲染为联系行
- 提交规范：本项目无 git 仓库（.gitignore 存在但未 init），不要自行 git init

## 参考链接（调研来源）

- Magic Resume：https://github.com/JOYCEQL/magic-resume （主题：src/theme/themeConfig.ts；模板：src/components/artboard/artboard-1~4）
- 木及简历：https://github.com/hua1995116/react-resume-site （主题：public/themes/*.less）
- 国内风格调研（搜索来源）：https://www.mujicv.com/ 、https://www.wondercv.com/
