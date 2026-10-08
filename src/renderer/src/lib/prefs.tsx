import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { PromptKind, PromptLibraries, PromptLibrary } from '@shared/prompts'
import type { KeysState, Settings } from '@shared/types'

type Loaded = { settings: Settings; keys: KeysState; prompts: PromptLibraries }

type Prefs = Loaded & {
  resolvedTheme: 'light' | 'dark'
  updateSettings: (patch: Partial<Settings>) => Promise<void>
  setAnthropicKey: (key: string | null) => Promise<void>
  setPrompts: (kind: PromptKind, library: PromptLibrary) => void
}

const PrefsContext = createContext<Prefs | null>(null)

export function usePrefs(): Prefs {
  const prefs = useContext(PrefsContext)
  if (!prefs) throw new Error('usePrefs outside PrefsProvider')
  return prefs
}

const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)')

function useSystemDark(): boolean {
  const [dark, setDark] = useState(() => darkQuery().matches)
  useEffect(() => {
    const query = darkQuery()
    const onChange = () => setDark(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return dark
}

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const systemDark = useSystemDark()

  useEffect(() => {
    Promise.all([window.prot.settings.get(), window.prot.keys.get(), window.prot.prompts.get('guide'), window.prot.prompts.get('chat'), window.prot.prompts.get('agent')]).then(
      ([settings, keys, guide, chat, agent]) => setLoaded({ settings, keys, prompts: { guide, chat, agent } })
    )
  }, [])

  const theme = loaded?.settings.theme ?? 'system'
  const resolvedTheme = theme === 'dark' || (theme === 'system' && systemDark) ? 'dark' : 'light'

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolvedTheme === 'dark')
    document.documentElement.style.colorScheme = resolvedTheme
  }, [resolvedTheme])

  const updateSettings = useCallback(async (patch: Partial<Settings>) => {
    const settings = await window.prot.settings.set(patch)
    setLoaded((prev) => (prev ? { ...prev, settings } : prev))
  }, [])

  const setAnthropicKey = useCallback(async (key: string | null) => {
    const keys = await window.prot.keys.setAnthropic(key)
    setLoaded((prev) => (prev ? { ...prev, keys } : prev))
  }, [])

  const setPrompts = useCallback((kind: PromptKind, library: PromptLibrary) => {
    setLoaded((prev) => (prev ? { ...prev, prompts: { ...prev.prompts, [kind]: library } } : prev))
  }, [])

  if (!loaded) return null
  return (
    <PrefsContext.Provider value={{ ...loaded, resolvedTheme, updateSettings, setAnthropicKey, setPrompts }}>
      {children}
    </PrefsContext.Provider>
  )
}
