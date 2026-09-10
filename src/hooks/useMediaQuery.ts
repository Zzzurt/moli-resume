import { useEffect, useState } from 'react'

/**
 * 响应式媒体查询 hook。
 * 用于「同一处 UI 在窄屏需要换成另一套 DOM 结构」的场景——
 * 纯 CSS（hidden/lg:flex 双份 DOM）会渲染两套节点，对可访问性与测试定位都不利，
 * 因此这里在 JS 层按断点切换渲染分支。
 *
 * 初始值按当前窗口立即求值，避免首帧闪两套布局。
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)

  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches)
    // query 变化（理论上不会）时对齐一次，保证与传入串一致
    setMatches(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}

/** 窄屏断点：<768px（Tailwind md）。顶栏完整操作组实测最小需 768px 宽 */
export const NARROW_QUERY = '(max-width: 767.98px)'

/** 编辑区窄屏断点：<1024px（Tailwind lg）。此宽度以下分栏不可用，改「编辑/预览」标签页 */
export const NARROW_EDITOR_QUERY = '(max-width: 1023.98px)'
