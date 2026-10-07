import { useCallback, useState } from 'react'
import { DEFAULT_FILTERS, parseFilters, type InboxFilters } from '@shared/inbox'

const FILTERS_KEY = 'prot:inbox:filters'
const COLLAPSED_KEY = 'prot:inbox:collapsed'

function read(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? null : JSON.parse(raw)
  } catch {
    return null
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
  }
}

export function useInboxFilters(): [InboxFilters, (filters: InboxFilters) => void] {
  const [filters, setFilters] = useState(() => {
    const stored = read(FILTERS_KEY)
    return stored === null ? DEFAULT_FILTERS : parseFilters(stored)
  })
  const update = useCallback((next: InboxFilters) => {
    setFilters(next)
    write(FILTERS_KEY, next)
  }, [])
  return [filters, update]
}

export function useCollapsed(): { isCollapsed: (key: string) => boolean; toggle: (key: string) => void } {
  const [collapsed, setCollapsed] = useState(() => {
    const stored = read(COLLAPSED_KEY)
    const keys = new Set<string>()
    if (Array.isArray(stored)) {
      for (const key of stored) if (typeof key === 'string') keys.add(key)
    }
    return keys
  })
  const toggle = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (!next.delete(key)) next.add(key)
      write(COLLAPSED_KEY, [...next])
      return next
    })
  }, [])
  return { isCollapsed: (key) => collapsed.has(key), toggle }
}
