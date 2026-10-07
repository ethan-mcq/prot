import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { ViewContext } from '@shared/types'

export const EMPTY_VIEW: ViewContext = {
  pull: null,
  step: null,
  chapter: null,
  flow: null,
  file: null,
  section: null,
  selection: null
}

type ViewStore = {
  view: ViewContext
  updateView: (patch: Partial<ViewContext>) => void
  questions: string[]
  setQuestions: (questions: string[]) => void
  chatOpen: boolean
  setChatOpen: (open: boolean) => void
}

const ViewStoreContext = createContext<ViewStore | null>(null)

export function useViewStore(): ViewStore {
  const store = useContext(ViewStoreContext)
  if (!store) throw new Error('useViewStore outside ViewProvider')
  return store
}

export function ViewProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<ViewContext>(EMPTY_VIEW)
  const [questions, setQuestions] = useState<string[]>([])
  const [chatOpen, setChatOpen] = useState(false)
  const updateView = useCallback((patch: Partial<ViewContext>) => setView((prev) => ({ ...prev, ...patch })), [])
  const value = useMemo(
    () => ({ view, updateView, questions, setQuestions, chatOpen, setChatOpen }),
    [view, updateView, questions, chatOpen]
  )
  return <ViewStoreContext.Provider value={value}>{children}</ViewStoreContext.Provider>
}
