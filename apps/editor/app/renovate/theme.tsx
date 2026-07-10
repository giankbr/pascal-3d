'use client'

import { Icon } from '@iconify/react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { Button } from '@/components/selia/button'

type Theme = 'light' | 'dark'

const STORAGE_KEY = 'renovate-theme'

interface RenovateThemeContextValue {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
}

const RenovateThemeContext = createContext<RenovateThemeContextValue | null>(null)

function readThemeFromDom(): Theme {
  const root = document.getElementById('renovate-root')
  return root?.classList.contains('dark') ? 'dark' : 'light'
}

function getPreferredTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(theme: Theme) {
  const root = document.getElementById('renovate-root')
  if (!root) return
  root.classList.toggle('dark', theme === 'dark')
  root.style.colorScheme = theme
}

export function RenovateThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('light')

  useEffect(() => {
    const initial = readThemeFromDom() || getPreferredTheme()
    setThemeState(initial)
    applyTheme(initial)
  }, [])

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next)
    localStorage.setItem(STORAGE_KEY, next)
    applyTheme(next)
  }, [])

  const toggleTheme = useCallback(() => {
    setThemeState((current) => {
      const next = current === 'dark' ? 'light' : 'dark'
      localStorage.setItem(STORAGE_KEY, next)
      applyTheme(next)
      return next
    })
  }, [])

  const value = useMemo(
    () => ({
      theme,
      setTheme,
      toggleTheme,
    }),
    [setTheme, theme, toggleTheme],
  )

  return <RenovateThemeContext.Provider value={value}>{children}</RenovateThemeContext.Provider>
}

export function useRenovateTheme() {
  const context = useContext(RenovateThemeContext)
  if (!context) {
    throw new Error('useRenovateTheme must be used within RenovateThemeProvider')
  }
  return context
}

export function ThemeToggle() {
  const { theme, toggleTheme } = useRenovateTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const isDark = mounted && theme === 'dark'

  return (
    <Button
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="shrink-0"
      onClick={toggleTheme}
      size="sm-icon"
      type="button"
      variant="outline"
    >
      <Icon className="size-4" icon={isDark ? 'tabler:sun' : 'tabler:moon'} />
    </Button>
  )
}
