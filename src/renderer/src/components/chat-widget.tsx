import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Eye, Loader2, Settings as SettingsIcon, Square, TextSelect, X } from 'lucide-react'
import { AI_MODELS, pullKey, type AiModel, type ChatEvent, type ChatMessage, type ViewContext } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Logo } from '@/components/logo'
import { Markdown } from '@/components/markdown'
import { pad2, splitPath } from '@/lib/paths'
import { usePrefs } from '@/lib/prefs'
import { errorMessage } from '@/lib/utils'
import { useViewStore } from '@/lib/view-context'

type Turn =
  | { role: 'user'; content: string }
  | { role: 'assistant'; id: string; content: string; status: 'streaming' | 'done' | 'failed'; error?: string }

type Threads = Record<string, Turn[]>

const MODEL_NAMES: Record<AiModel, string> = {
  'claude-opus-5-5': 'Claude Opus 5.5',
  'claude-sonnet-5-5': 'Claude Sonnet 5.5',
  'claude-haiku-4-5': 'Claude Haiku 4.5'
}

const STARTERS = ['Explain this chapter', 'What should I look at closely?', 'How does this flow connect?']

const SELECTION_LIMIT = 4000

function applyEvent(threads: Threads, event: ChatEvent): Threads {
  for (const [key, turns] of Object.entries(threads)) {
    const index = turns.findIndex((turn) => turn.role === 'assistant' && turn.id === event.id)
    const turn = turns[index]
    if (!turn || turn.role !== 'assistant') continue
    const next =
      event.type === 'delta'
        ? { ...turn, content: turn.content + event.text }
        : event.type === 'done'
          ? { ...turn, status: 'done' as const }
          : { ...turn, status: 'failed' as const, error: event.message }
    return { ...threads, [key]: turns.map((t, i) => (i === index ? next : t)) }
  }
  return threads
}

function seeing(view: ViewContext): string | null {
  if (!view.pull) return null
  const parts: string[] = []
  if (view.step?.kind === 'overview') parts.push('Overview')
  if (view.step?.kind === 'flow') parts.push('Flow')
  if (view.step?.kind === 'chapter') parts.push(`Chapter ${pad2(view.step.index + 1)}`)
  if (view.file) {
    const lines = view.file.visibleLines ? ` L${view.file.visibleLines[0]}-${view.file.visibleLines[1]}` : ''
    parts.push(`${splitPath(view.file.path).name}${lines}`)
  }
  return parts.join(' · ')
}

// The chat textarea steals focus (and the document selection) when clicked, so
// remember the last selection made inside the main pane instead of reading it at send time.
function useMainSelection() {
  const [selection, setSelection] = useState<string | null>(null)
  useEffect(() => {
    function onChange() {
      const current = window.getSelection()
      const text = current?.toString().trim()
      if (!current || !text) return
      const main = document.getElementById('main-pane')
      if (main && current.anchorNode && main.contains(current.anchorNode)) setSelection(text.slice(0, SELECTION_LIMIT))
    }
    document.addEventListener('selectionchange', onChange)
    return () => document.removeEventListener('selectionchange', onChange)
  }, [])
  return [selection, setSelection] as const
}

export function ChatWidget() {
  const { view, chatOpen, setChatOpen } = useViewStore()
  const { keys } = usePrefs()
  const [threads, setThreads] = useState<Threads>({})
  const [setup, setSetup] = useState(false)
  const [selection, setSelection] = useMainSelection()
  const threadKey = view.pull ? pullKey(view.pull.ref) : 'none'
  const turns = threads[threadKey] ?? []
  const streaming = turns.find((turn) => turn.role === 'assistant' && turn.status === 'streaming')

  useEffect(() => window.prot.ai.onEvent((event) => setThreads((prev) => applyEvent(prev, event))), [])

  function send(text: string) {
    const id = crypto.randomUUID()
    const history: Turn[] = [...turns, { role: 'user', content: text }]
    const messages: ChatMessage[] = history
      .filter((turn) => turn.role === 'user' || (turn.status === 'done' && turn.content))
      .map((turn) => ({ role: turn.role, content: turn.content }))
    setThreads((prev) => ({
      ...prev,
      [threadKey]: [...history, { role: 'assistant', id, content: '', status: 'streaming' }]
    }))
    window.prot.ai
      .chat({ id, messages, context: { ...view, selection } })
      .catch((error: unknown) =>
        setThreads((prev) => applyEvent(prev, { id, type: 'error', message: errorMessage(error) }))
      )
    setSelection(null)
  }

  if (!chatOpen) {
    return (
      <button
        type="button"
        aria-label="Ask prot"
        title="Ask prot"
        onClick={() => setChatOpen(true)}
        className="fixed right-6 bottom-6 z-40 size-[52px] rounded-full shadow-[0_6px_20px_rgb(0_0_0/0.18)] ring-1 ring-black/5 transition-transform hover:scale-105 active:scale-95 dark:ring-white/15"
      >
        <Logo tile={false} className="size-full" />
      </button>
    )
  }

  const showSetup = setup || !keys.anthropic
  const context = seeing(view)

  return (
    <aside
      aria-label="Ask prot"
      data-hotkeys-off
      onKeyDown={(event) => {
        if (event.key === 'Escape') setChatOpen(false)
      }}
      className="fixed right-6 bottom-6 z-40 flex h-[560px] max-h-[calc(100vh-48px)] w-[400px] flex-col overflow-hidden rounded-2xl border bg-popover shadow-[0_12px_40px_rgb(0_0_0/0.16)] animate-in fade-in-0 slide-in-from-bottom-2 duration-150"
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <Logo className="size-6" />
        <span className="text-sm font-semibold">Ask prot</span>
        <ModelName />
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Chat settings"
          aria-pressed={showSetup}
          onClick={() => setSetup(!setup)}
          disabled={!keys.anthropic}
          className="text-muted-foreground"
        >
          <SettingsIcon className="size-4" />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Close chat" onClick={() => setChatOpen(false)} className="text-muted-foreground">
          <X className="size-4" />
        </Button>
      </header>
      {showSetup ? (
        <KeySetup onDone={() => setSetup(false)} />
      ) : (
        <>
          <div className="flex shrink-0 items-center gap-1.5 border-b bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground">
            <Eye className="size-3 shrink-0" />
            <span className="truncate" title={context ?? undefined}>
              {context ? `Seeing: ${context}` : 'Open a pull request so prot can see it'}
            </span>
          </div>
          <Messages turns={turns} onStarter={send} canStart={view.pull !== null} />
          <Composer
            busy={streaming !== undefined}
            selection={selection}
            onClearSelection={() => setSelection(null)}
            onSend={send}
            onStop={() => {
              if (streaming?.role === 'assistant') void window.prot.ai.cancel(streaming.id)
            }}
          />
        </>
      )}
    </aside>
  )
}

function ModelName() {
  const { settings } = usePrefs()
  return <span className="font-mono text-[10.5px] text-muted-foreground">{MODEL_NAMES[settings.model]}</span>
}

function Messages({ turns, onStarter, canStart }: { turns: Turn[]; onStarter: (text: string) => void; canStart: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const last = turns[turns.length - 1]
  const lastLength = last?.content.length ?? 0

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 120
    if (nearBottom || last?.role === 'user') element.scrollTop = element.scrollHeight
  }, [turns.length, lastLength, last?.role])

  if (turns.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col justify-end gap-2 p-4">
        <p className="mb-2 font-serif text-lg">What would you like to know?</p>
        {STARTERS.map((starter) => (
          <button
            key={starter}
            type="button"
            disabled={!canStart}
            onClick={() => onStarter(starter)}
            className="rounded-lg border bg-card px-3 py-2 text-left text-[13px] transition-colors hover:bg-accent disabled:opacity-50"
          >
            {starter}
          </button>
        ))}
      </div>
    )
  }

  return (
    <div ref={ref} role="log" aria-label="Conversation" className="scroll-quiet min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
      {turns.map((turn, i) =>
        turn.role === 'user' ? (
          <div key={i} className="flex justify-end">
            <p className="max-w-[85%] rounded-2xl rounded-br-md bg-muted px-3 py-2 text-[13px] leading-5 whitespace-pre-wrap">
              {turn.content}
            </p>
          </div>
        ) : (
          <div key={turn.id} className="space-y-1.5">
            {turn.content ? (
              <Markdown className="text-[13.5px] leading-6">{turn.content}</Markdown>
            ) : turn.status === 'streaming' ? (
              <Loader2 aria-label="Thinking" className="size-4 animate-spin text-muted-foreground" />
            ) : null}
            {turn.status === 'failed' && (
              <p role="alert" className="text-xs text-destructive">
                {turn.error}
              </p>
            )}
          </div>
        )
      )}
    </div>
  )
}

function Composer({
  busy,
  selection,
  onClearSelection,
  onSend,
  onStop
}: {
  busy: boolean
  selection: string | null
  onClearSelection: () => void
  onSend: (text: string) => void
  onStop: () => void
}) {
  const [text, setText] = useState('')
  const ready = text.trim().length > 0 && !busy

  function submit() {
    if (!ready) return
    onSend(text.trim())
    setText('')
  }

  return (
    <div className="shrink-0 border-t p-3">
      {selection && (
        <div className="mb-2 flex items-center gap-1.5 rounded-md border bg-muted/50 px-2 py-1 text-[11px] text-muted-foreground">
          <TextSelect className="size-3 shrink-0" />
          <span className="min-w-0 flex-1 truncate font-mono" title={selection}>
            {selection}
          </span>
          <button type="button" aria-label="Drop selection" onClick={onClearSelection} className="hover:text-foreground">
            <X className="size-3" />
          </button>
        </div>
      )}
      <div className="flex items-end gap-2 rounded-xl border bg-background p-1.5 pl-3 focus-within:ring-[3px] focus-within:ring-ring/30">
        <Textarea
          autoFocus
          aria-label="Message prot"
          placeholder="Ask about this pull request"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              submit()
            }
          }}
          rows={1}
          className="max-h-40 min-h-0 resize-none border-0 bg-transparent p-0 py-1.5 text-[13px] shadow-none focus-visible:ring-0 dark:bg-transparent"
        />
        {busy ? (
          <Button size="icon-sm" variant="outline" aria-label="Stop" onClick={onStop} className="rounded-lg">
            <Square className="size-3 fill-current" />
          </Button>
        ) : (
          <Button size="icon-sm" aria-label="Send" disabled={!ready} onClick={submit} className="rounded-lg">
            <ArrowUp className="size-4" />
          </Button>
        )}
      </div>
    </div>
  )
}

function KeySetup({ onDone }: { onDone: () => void }) {
  const { keys, settings, updateSettings, setAnthropicKey } = usePrefs()
  const [key, setKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(value: string | null) {
    setSaving(true)
    setError(null)
    try {
      await setAnthropicKey(value)
      setKey('')
      if (value) onDone()
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5">
      <div className="space-y-1.5">
        <p className="font-serif text-lg">{keys.anthropic ? 'Chat settings' : 'Connect Claude'}</p>
        <p className="text-[13px] leading-5 text-muted-foreground">
          Ask prot and the AI guide use your own Anthropic API key.
          {keys.anthropic && ' A key is saved. Enter a new one to replace it.'}
        </p>
      </div>
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (key.trim()) void save(key.trim())
        }}
      >
        <Label htmlFor="anthropic-key" className="text-xs">
          Anthropic API key
        </Label>
        <Input
          id="anthropic-key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={keys.anthropic ? '••••••••••••' : 'sk-ant-…'}
          value={key}
          onChange={(event) => setKey(event.target.value)}
          className="font-mono"
        />
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={!key.trim() || saving}>
            {saving && <Loader2 className="animate-spin" />}
            Save
          </Button>
          {keys.anthropic && (
            <Button type="button" size="sm" variant="ghost" className="text-destructive" disabled={saving} onClick={() => void save(null)}>
              Remove key
            </Button>
          )}
        </div>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </form>
      <div className="space-y-2">
        <Label className="text-xs">Model</Label>
        <Select value={settings.model} onValueChange={(model) => void updateSettings({ model: model as AiModel })}>
          <SelectTrigger aria-label="Model" size="sm" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AI_MODELS.map((model) => (
              <SelectItem key={model} value={model}>
                {MODEL_NAMES[model]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {keys.anthropic && (
        <Button variant="outline" size="sm" className="mt-auto self-start" onClick={onDone}>
          Back to chat
        </Button>
      )}
    </div>
  )
}
