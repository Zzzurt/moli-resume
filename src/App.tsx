import { RouterProvider, createHashRouter, useParams } from 'react-router-dom'
import { Toaster } from 'sonner'
import { ListPage } from './pages/ListPage'
import { EditorPage } from './pages/EditorPage'
import { SettingsProvider } from './hooks/useSettings'

/**
 * :id 变化时强制重挂载编辑器。
 * 若不加 key，/resume/1 → /resume/2 直跳会复用组件实例，旧简历的
 * initialized 守卫/草稿状态残留，甚至把 A 的内容存进 B。
 */
function EditorRoute() {
  const { id } = useParams()
  return <EditorPage key={id ?? 'none'} />
}

const router = createHashRouter([
  {
    path: '/',
    element: <ListPage />,
  },
  {
    path: '/resume/:id',
    element: <EditorRoute />,
  },
])

export default function App() {
  return (
    <SettingsProvider>
      <RouterProvider router={router} />
      <Toaster position="top-center" richColors />
    </SettingsProvider>
  )
}
