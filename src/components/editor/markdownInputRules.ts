import { Extension } from '@tiptap/core'
import {
  InputRule,
  inputRules,
  wrappingInputRule,
  textblockTypeInputRule,
} from '@tiptap/pm/inputrules'

/**
 * Markdown 快捷输入：
 * 像书写 Markdown 一样直接打语法即时转换，无需依赖斜杠菜单——
 *   # ~ ###### + 空格   → 标题一~六
 *   - / * + 空格        → 无序列表
 *   1. / 1) 空格        → 有序列表
 *   > 空格              → 引用
 *   ---                 → 分割线
 *   ```                 → 代码块
 *   **粗** / __粗__     → 加粗（输入收尾符即触发）
 *   *斜* / _斜_         → 斜体
 *   ~~删~~              → 删除线
 *   `码`                → 行内代码
 */

/**
 * 行内标记规则：输入收尾定界符后把包裹文本转为 mark 并删除定界符。
 * delimLen 为一侧定界符长度。InputRule 触发时收尾定界符尚未插入文档
 * （handleTextInput 先拦截，随后插入动作被吞掉），start..end 只覆盖文档中
 * 已有的「前定界符 + 内容 + 半个 ** 收尾」；斜体用 (?:^|[^x]) 前缀替代
 * lookbehind（Safari < 16.4 不支持），因此各段位置从 match 长度反推。
 */
function markRule(regexp: RegExp, markName: string, delimLen: number): InputRule {
  return new InputRule(regexp, (state, match, start, end) => {
    const markType = state.schema.marks[markName]
    const content = match[1]
    if (!content) return null
    const tr = state.tr
    const prefixLen = match[0].length - content.length - 2 * delimLen
    const textStart = start + prefixLen + delimLen
    const textEnd = textStart + content.length
    const openStart = textStart - delimLen
    if (textEnd < end) tr.delete(textEnd, end)
    tr.delete(openStart, textStart)
    tr.addMark(openStart, openStart + content.length, markType.create())
    tr.removeStoredMark(markType)
    return tr
  })
}

/** 代码块规则：输入 ``` 后把当前空段落转为代码块 */
function codeBlockRule(): InputRule {
  return new InputRule(/^```$/, (state, _match, start, end) => {
    const $start = state.doc.resolve(start)
    if ($start.parent.type.name !== 'paragraph' || $start.parent.content.size > 0) return null
    const tr = state.tr.deleteRange(start, end)
    tr.setBlockType(start, start, state.schema.nodes.codeBlock)
    return tr
  })
}

export function createMarkdownInputRules(): Extension {
  return Extension.create({
    name: 'markdownInputRules',
    addProseMirrorPlugins() {
      const rules = [
        // 块级：标题（# ~ ######）
        textblockTypeInputRule(/^(#{1,6})\s$/, this.editor.schema.nodes.heading, (match) => ({
          level: Number(match[1].length),
        })),
        // 块级：无序 / 有序列表
        wrappingInputRule(/^\s*([-*+])\s$/, this.editor.schema.nodes.bulletList),
        wrappingInputRule(/^\s*1([.)])\s$/, this.editor.schema.nodes.orderedList, (match) => ({
          order: Number(match[1]) || 1,
        })),
        // 块级：引用 / 分割线 / 代码块
        wrappingInputRule(/^\s*>\s$/, this.editor.schema.nodes.blockquote),
        new InputRule(/^(?:---|___|\*\*\*)$/, (state, _match, start, end) => {
          const $start = state.doc.resolve(start)
          if ($start.parent.type.name !== 'paragraph' || $start.parent.content.size > 3) return null
          return state.tr.replaceRangeWith(start, end, state.schema.nodes.horizontalRule.create())
        }),
        codeBlockRule(),
        // 行内：加粗 / 斜体 / 删除线 / 行内代码（(?:^|[^x]) 替代 lookbehind）
        markRule(/(?:\*\*|__)([^*_\n]+)\1$/, 'bold', 2),
        markRule(/(?:^|[^*])\*([^*\n]+)\*(?!\*)$/, 'italic', 1),
        markRule(/(?:^|[^_])_([^_\n]+)_(?!_)$/, 'italic', 1),
        markRule(/~~([^~\n]+)~~$/, 'strike', 2),
        markRule(/`([^`\n]+)`$/, 'code', 1),
      ]

      return [inputRules({ rules })]
    },
  })
}
