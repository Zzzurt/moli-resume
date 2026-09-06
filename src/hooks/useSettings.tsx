import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { AppSettings, ThemeMode } from '@/types'
import { DEFAULT_SETTINGS } from '@/types'
import { loadSettings, saveSetting } from '@/lib/db'
import type { ReactNode } from 'react'

interface SettingsContextValue {
  settings: AppSettings
  loaded: boolean
  theme: ThemeMode
  update: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void
  toggleTheme: () => void
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    loadSettings().then((s) => {
      setSettings(s)
      setLoaded(true)
      // 初始化时立即应用主题，避免闪烁
      document.documentElement.classList.toggle('dark', s.theme === 'dark')
    })
  }, [])

  const update = useCallback(
    <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
      setSettings((prev) => ({ ...prev, [key]: value }))
      void saveSetting(key, value)
    },
    []
  )

  const toggleTheme = useCallback(() => {
    setSettings((prev) => {
      const next: ThemeMode = prev.theme === 'dark' ? 'light' : 'dark'
      void saveSetting('theme', next)
      document.documentElement.classList.toggle('dark', next === 'dark')
      return { ...prev, theme: next }
    })
  }, [])

  return (
    <SettingsContext.Provider value={{ settings, loaded, theme: settings.theme, update, toggleTheme }}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings 必须在 SettingsProvider 内使用')
  return ctx
}
