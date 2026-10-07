import { useEffect, useRef, useState } from 'react'
import { highlightLines, type Token } from './highlight'

type KeyHandler = (event: KeyboardEvent) => void

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

// Shortcuts stay out of the way of text entry, open dialogs and the chat panel.
export function useHotkeys(handlers: Record<string, KeyHandler>, enabled = true): void {
  const latest = useRef(handlers)
  latest.current = handlers
  useEffect(() => {
    if (!enabled) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return
      if (isTyping(event.target)) return
      if (event.target instanceof Element && event.target.closest('[role="dialog"],[data-hotkeys-off]')) return
      if (document.querySelector('[role="dialog"][data-state="open"]')) return
      const handler = latest.current[event.key]
      if (!handler) return
      event.preventDefault()
      handler(event)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled])
}

export function useHighlighted(lines: string[], lang: string | null): Token[][] | null {
  const text = lines.join('\n')
  const [result, setResult] = useState<{ text: string; tokens: Token[][] } | null>(null)
  useEffect(() => {
    if (!lang || text.length === 0) return
    let live = true
    highlightLines(text.split('\n'), lang)
      .then((tokens) => {
        if (live) setResult({ text, tokens })
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [text, lang])
  return result && result.text === text ? result.tokens : null
}
