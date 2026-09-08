import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { Button } from '@/components/ui/button'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * 全局渲染异常兜底：任何组件渲染崩溃时展示恢复界面，避免整页白屏。
 * 简历内容有自动保存（防抖 700ms 落库），刷新后基本不丢最近修改。
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[墨历] 界面渲染异常', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-screen flex-col items-center justify-center gap-3 bg-background p-6 text-center">
          <p className="text-sm font-semibold">界面出现了点问题</p>
          <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
            页面发生了意外错误。你的简历内容会自动保存在本机浏览器，刷新页面即可恢复，通常不会丢失最近的修改。
          </p>
          <div className="mt-1 flex gap-2">
            <Button size="sm" onClick={() => window.location.reload()}>
              刷新页面
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => this.setState({ error: null })}
            >
              尝试继续
            </Button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
