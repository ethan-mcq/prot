import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ArrowUp,
  Brain,
  Check,
  ChevronRight,
  LoaderCircle,
  PanelRight,
  Square,
  X
} from 'lucide-react'
import { toast } from 'sonner'
import type { AgentDetail, AgentEvent, AgentFileChange, AgentPr, AgentSummary, ProviderInfo } from '@shared/agents'
import { agentFileUrl, isImageMime, PROVIDER_NAMES } from '@shared/agents'
import { parsePatch } from '@shared/diff'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { DiffStat } from '@/components/diff-stat'
import { buildRows, LineRow } from '@/components/diff-view'
import { FileIcon } from '@/components/file-icon'
import { Markdown } from '@/components/markdown'
import { PaneButton } from '@/components/pane'
import { PrBadge, ProviderMark, STATUS_TEXT, StatusDot } from '@/components/agent-bits'
import {
  AttachButton,
  AttachmentStrip,
  ContextWheel,
  FileChips,
  ImageThumbs,
  useAttachments,
  useCommands,
  useSlashMenu
} from '@/components/agent-composer'
import {
  effortLabel,
  formatCost,
  formatDuration,
  formatTokens,
  groupTranscript,
  modelLabel,
  permissionLabel,
  readFlag,
  runLabel,
  runningFor,
  upsertEvent,
  useNow,
  writeFlag,
  type AgentsStore,
  type ToolEvent,
  type TranscriptItem
} from '@/lib/agents'
import { languageFor } from '@/lib/highlight'
import { useHighlighted } from '@/lib/hooks'
import { splitPath } from '@/lib/paths'
import { cn, errorMessage } from '@/lib/utils'

const PANEL_KEY = 'prot:agents:panel-open'

export function AgentView({
  id,
  store,
  onSelect,
  onOpenPull
}: {
  id: string
  store: AgentsStore
  onSelect: (id: string) => void
  onOpenPull: (pr: AgentPr) => void
}) {
  const listed = store.state?.agents.find((agent) => agent.id === id) ?? null
  const providers = store.state?.providers ?? []
  const [detail, setDetail] = useState<AgentDetail | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [panelOpen, setPanelOpen] = useState(() => readFlag(PANEL_KEY, true))
  const [panelTab, setPanelTab] = useState<PanelTab>('activity')
  const [activeRun, setActiveRun] = useState<string | null>(null)
  const [changes, setChanges] = useState<AgentFileChange[] | null>(null)
  const [changesTick, setChangesTick] = useState(0)
  const [file, setFile] = useState<string | null>(null)
  const agent: AgentSummary | null = listed ?? detail

  useEffect(() => {
    let live = true
    let loaded = false
    let pending: AgentEvent[] = []
    const unsubscribe = window.prot.agents.onChange((change) => {
      if (change.agent.id !== id) return
      if (change.agent.unread) void window.prot.agents.markRead(id)
      if (change.event?.kind === 'turn') setChangesTick((n) => n + 1)
      if (!loaded) {
        if (change.event) pending.push(change.event)
        return
      }
      const event = change.event
      setDetail((prev) => (prev ? { ...prev, ...change.agent, transcript: event ? upsertEvent(prev.transcript, event) : prev.transcript } : prev))
    })
    window.prot.agents
      .get(id)
      .then((next) => {
        if (!live) return
        loaded = true
        let transcript = next.transcript
        for (const event of pending) transcript = upsertEvent(transcript, event)
        pending = []
        setDetail({ ...next, transcript })
      })
      .catch((error: unknown) => {
        if (live) setLoadError(errorMessage(error))
      })
    void window.prot.agents.markRead(id)
    return () => {
      live = false
      unsubscribe()
    }
  }, [id])

  const stat = agent?.changes ? `${agent.changes.files}:${agent.changes.additions}:${agent.changes.deletions}` : ''
  useEffect(() => {
    let live = true
    window.prot.agents
      .changes(id)
      .then((next) => {
        if (live) setChanges(next)
      })
      .catch(() => {
        if (live) setChanges([])
      })
    return () => {
      live = false
    }
  }, [id, changesTick, stat])

  function togglePanel() {
    setPanelOpen(!panelOpen)
    writeFlag(PANEL_KEY, !panelOpen)
  }

  function openRun(runId: string) {
    setActiveRun(runId)
    setPanelTab('activity')
    if (!panelOpen) togglePanel()
  }

  if (!agent) {
    return (
      <div className="pane flex h-full items-center justify-center font-mono text-[12px] text-muted-foreground">
        {loadError ? <p role="alert" className="text-destructive">! {loadError}</p> : <LoaderCircle aria-label="Loading agent" className="size-4 animate-spin" />}
      </div>
    )
  }

  return (
    <div className="pane flex h-full flex-col overflow-hidden">
      <Header
        agent={agent}
        providers={providers}
        panelOpen={panelOpen}
        changeCount={changes?.length ?? 0}
        onTogglePanel={togglePanel}
        onOpenPull={onOpenPull}
      />
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {file ? (
            <PatchPane agentId={agent.id} path={file} tick={changesTick} onClose={() => setFile(null)} />
          ) : (
            <Transcript agent={agent} detail={detail} error={loadError} activeRun={panelOpen && panelTab === 'activity' ? activeRun : null} onOpenRun={openRun} />
          )}
          <FollowUp agent={agent} store={store} onSelect={onSelect} />
        </div>
        {panelOpen && (
          <SidePanel
            tab={panelTab}
            onTab={setPanelTab}
            changeCount={changes?.length ?? 0}
            activity={<ActivityPanel events={detail?.transcript ?? []} activeRun={activeRun} />}
            changes={<ChangesPanel changes={changes} selected={file} onSelect={setFile} />}
          />
        )}
      </div>
    </div>
  )
}

function Chip({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span title={title} className="inline-flex max-w-full items-center gap-1 rounded-[4px] border border-pane-border px-1.5 leading-[18px]">
      {children}
    </span>
  )
}

function Header({
  agent,
  providers,
  panelOpen,
  changeCount,
  onTogglePanel,
  onOpenPull
}: {
  agent: AgentSummary
  providers: ProviderInfo[]
  panelOpen: boolean
  changeCount: number
  onTogglePanel: () => void
  onOpenPull: (pr: AgentPr) => void
}) {
  const model = modelLabel(providers, agent.provider, agent.model)
  const permission = permissionLabel(providers, agent.provider, agent.permission)
  const permissionHint = providers.find((p) => p.provider === agent.provider)?.permissions.find((p) => p.id === agent.permission)?.hint
  const where = [agent.repoName, agent.branch].filter(Boolean).join(' · ')

  function stop() {
    window.prot.agents.stop(agent.id).catch((error: unknown) => {
      toast.error('Could not stop the agent', { description: errorMessage(error) })
    })
  }

  return (
    <header className="shrink-0 border-b border-pane-border py-2 pr-2 pl-3.5">
      <div className="flex items-center gap-2">
        <StatusDot status={agent.status} />
        <h1 className="min-w-0 flex-1 truncate text-[13px] font-semibold" title={agent.title}>
          {agent.title}
        </h1>
        <span className="flex shrink-0 items-center gap-0.5">
          {agent.status === 'running' && (
            <Button size="xs" variant="outline" aria-label="Stop agent" onClick={stop} className="mr-1 font-mono text-[11px]">
              <Square className="size-2.5 fill-current" />
              Stop
            </Button>
          )}
          <PaneButton
            aria-label="Activity and changes"
            aria-pressed={panelOpen}
            title={panelOpen ? 'Hide activity and changes' : 'Show activity and changes'}
            onClick={onTogglePanel}
            className={cn('relative', panelOpen && 'text-foreground')}
          >
            <PanelRight />
            {changeCount > 0 && !panelOpen && (
              <span aria-hidden className="absolute -top-0.5 -right-0.5 flex size-3 items-center justify-center rounded-full bg-primary font-mono text-[8.5px] leading-none text-primary-foreground">
                {changeCount > 9 ? '9+' : changeCount}
              </span>
            )}
          </PaneButton>
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-4 font-mono text-[10.5px] text-muted-foreground">
        <Chip>
          <ProviderMark provider={agent.provider} />
          {PROVIDER_NAMES[agent.provider]}
        </Chip>
        {model && <Chip>{model}</Chip>}
        {agent.effort && <Chip>{effortLabel(agent.effort).toLowerCase()}</Chip>}
        {permission && <Chip title={permissionHint}>{permission}</Chip>}
        <span className={cn(agent.status === 'failed' && 'text-destructive', agent.status === 'running' && 'text-added')}>
          {STATUS_TEXT[agent.status]}
        </span>
        {agent.source !== 'prot' && <span>· from the {agent.source === 'claude-app' ? 'Claude' : 'Codex'} app</span>}
        <span aria-hidden>·</span>
        <span className="min-w-0 truncate" title={agent.cwd}>
          {where || agent.cwd}
        </span>
        {agent.pr && (
          <button
            type="button"
            aria-label={`Open pull request #${agent.pr.number}`}
            title={agent.pr.title}
            onClick={() => agent.pr && onOpenPull(agent.pr)}
            className="rounded-[3px] outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <PrBadge pr={agent.pr} />
          </button>
        )}
        {agent.costUsd !== null && <span className="ml-auto tabular-nums">{formatCost(agent.costUsd)}</span>}
      </div>
    </header>
  )
}

function Transcript({
  agent,
  detail,
  error,
  activeRun,
  onOpenRun
}: {
  agent: AgentSummary
  detail: AgentDetail | null
  error: string | null
  activeRun: string | null
  onOpenRun: (id: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const transcript = detail?.transcript
  const running = agent.status === 'running'
  const now = useNow(1000, running)

  useLayoutEffect(() => {
    const element = ref.current
    if (element && pinned.current) element.scrollTop = element.scrollHeight
  }, [transcript, running])

  if (!detail) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center font-mono text-[12px] text-muted-foreground">
        {error ? (
          <p role="alert" className="text-destructive">
            ! {error}
          </p>
        ) : (
          <LoaderCircle aria-label="Loading transcript" className="size-4 animate-spin" />
        )}
      </div>
    )
  }

  const items = groupTranscript(detail.transcript)
  const lastItem = items[items.length - 1]
  const toolRunning = lastItem?.kind === 'run' && lastItem.tools.some((tool) => tool.status === 'running')
  return (
    <div
      ref={ref}
      role="log"
      aria-label="Transcript"
      onScroll={(event) => {
        const element = event.currentTarget
        pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80
      }}
      className="scroll-quiet min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pt-4 pb-5"
    >
      {detail.transcript.length === 0 && !running && (
        <p className="font-mono text-[12px] text-muted-foreground">No messages yet.</p>
      )}
      {items.map((item) =>
        item.kind === 'run' ? (
          <div key={item.id} className="space-y-1.5">
            <RunRow tools={item.tools} active={activeRun === item.id} onOpen={() => onOpenRun(item.id)} />
            <ImageThumbs paths={runImages(item.tools)} className="pl-1.5" />
          </div>
        ) : (
          <TranscriptEvent key={item.event.id} event={item.event} />
        )
      )}
      {running && !toolRunning && (
        <p className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
          <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
          working
          <span className="tabular-nums">{runningFor(agent, now)}</span>
        </p>
      )}
    </div>
  )
}

function TranscriptEvent({ event }: { event: AgentEvent }) {
  switch (event.kind) {
    case 'system':
      return <SystemCard event={event} />
    case 'user': {
      const attachments = event.attachments ?? []
      const images: string[] = []
      for (const item of attachments) {
        if (isImageMime(item.mime)) images.push(item.path)
      }
      return (
        <div className="flex flex-col items-end gap-1.5">
          <ImageThumbs paths={images} className="max-w-[85%] justify-end" />
          <FileChips attachments={attachments} />
          <p className="max-w-[85%] rounded-[10px] bg-selection px-3 py-2 font-mono text-[12.5px] leading-[1.6] whitespace-pre-wrap [overflow-wrap:anywhere]">
            {event.text}
          </p>
        </div>
      )
    }
    case 'assistant':
      return <AssistantText event={event} />
    case 'thinking':
      return <Thinking text={event.text} />
    case 'tool':
      return <ToolRow event={event} />
    case 'error':
      return (
        <p className="rounded-[6px] border border-destructive/30 bg-destructive/5 px-2.5 py-1.5 font-mono text-[11.5px] whitespace-pre-wrap text-destructive [overflow-wrap:anywhere]">
          ! {event.text}
        </p>
      )
    case 'turn':
      return <TurnFooter event={event} />
  }
}

function runImages(tools: ToolEvent[]): string[] {
  const out: string[] = []
  for (const tool of tools) {
    for (const path of tool.images ?? []) {
      if (!out.includes(path)) out.push(path)
    }
  }
  return out
}

const MARKDOWN_IMAGE = /!\[[^\]]*\]\(\s*<?([^)>\s]+)/g

function imagePath(src: string): string {
  try {
    return decodeURI(src.replace(/^file:\/\//, ''))
  } catch {
    return src
  }
}

// Markdown images of files the event found render inline; the rest show as thumbnails under the text.
function AssistantText({ event }: { event: Extract<AgentEvent, { kind: 'assistant' }> }) {
  const images = event.images ?? []
  const inline: string[] = []
  for (const match of event.text.matchAll(MARKDOWN_IMAGE)) inline.push(imagePath(match[1] ?? ''))
  const rest = images.filter((path) => !inline.includes(path))
  return (
    <div className="space-y-2">
      <Markdown
        className="text-[13px] leading-[1.7] text-foreground/90"
        image={(src) => {
          const path = imagePath(src)
          return images.includes(path) ? agentFileUrl(path) : null
        }}
      >
        {event.text}
      </Markdown>
      <ImageThumbs paths={rest} />
    </div>
  )
}

function RunRow({ tools, active, onOpen }: { tools: ToolEvent[]; active: boolean; onOpen: () => void }) {
  const running = tools.some((tool) => tool.status === 'running')
  const failed = tools.some((tool) => tool.status === 'error')
  const label = runLabel(tools)
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title="Show these steps in Activity"
      onClick={onOpen}
      className={cn(
        'flex items-center gap-1.5 rounded-[5px] px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
        active && 'bg-selection text-foreground'
      )}
    >
      {running ? (
        <LoaderCircle aria-hidden className="size-3 animate-spin" />
      ) : failed ? (
        <X aria-hidden className="size-3 text-removed" />
      ) : (
        <Check aria-hidden className="size-3 text-added" />
      )}
      {label}
      <ChevronRight aria-hidden className="size-3" />
    </button>
  )
}

function SystemCard({ event }: { event: Extract<AgentEvent, { kind: 'system' }> }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-[6px] border border-dashed border-frame">
      <button
        type="button"
        aria-expanded={open}
        aria-label={`System prompt ${event.name}`}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left font-mono text-[11px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <ChevronRight aria-hidden className={cn('size-3 transition-transform', open && 'rotate-90')} />
        system prompt · <span className="text-foreground">{event.name}</span>
      </button>
      {open && (
        <pre className="scroll-quiet max-h-80 overflow-auto border-t border-dashed border-frame px-2.5 py-2 font-mono text-[11.5px] leading-[1.55] whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">
          {event.text}
        </pre>
      )}
    </div>
  )
}

function Thinking({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 rounded-[3px] font-mono text-[11px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <ChevronRight aria-hidden className={cn('size-3 transition-transform', open && 'rotate-90')} />
        <Brain aria-hidden className="size-3" />
        Thinking
      </button>
      {open && (
        <p className="mt-1.5 ml-1.5 border-l border-frame pl-3 font-copy text-[12px] leading-[1.7] whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">
          {text}
        </p>
      )}
    </div>
  )
}

function ToolRow({ event }: { event: Extract<AgentEvent, { kind: 'tool' }> }) {
  const [open, setOpen] = useState(false)
  const output = event.output?.trimEnd() ?? ''
  return (
    <div className="rounded-[6px] border border-pane-border">
      <button
        type="button"
        aria-expanded={output ? open : undefined}
        aria-label={`${event.name} ${event.summary}`.trim()}
        disabled={!output}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 rounded-[6px] px-2 py-1 text-left font-mono text-[11.5px] outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 disabled:hover:bg-transparent"
      >
        {event.status === 'running' ? (
          <LoaderCircle aria-label="running" className="size-3 shrink-0 animate-spin text-muted-foreground" />
        ) : event.status === 'ok' ? (
          <Check aria-label="ok" className="size-3 shrink-0 text-added" />
        ) : (
          <X aria-label="error" className="size-3 shrink-0 text-removed" />
        )}
        <span className="shrink-0 font-medium">{event.name}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground" title={event.summary}>
          {event.summary}
        </span>
        {output && <ChevronRight aria-hidden className={cn('size-3 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />}
      </button>
      {open && output && (
        <pre
          className={cn(
            'scroll-quiet max-h-80 overflow-auto border-t border-pane-border bg-muted px-2.5 py-2 font-mono text-[11.5px] leading-[1.55] whitespace-pre-wrap [overflow-wrap:anywhere]',
            event.status === 'error' && 'text-destructive'
          )}
        >
          {output}
        </pre>
      )}
    </div>
  )
}

function TurnFooter({ event }: { event: Extract<AgentEvent, { kind: 'turn' }> }) {
  const parts: string[] = []
  if (event.durationMs !== null) parts.push(formatDuration(event.durationMs))
  if (event.costUsd !== null) parts.push(formatCost(event.costUsd))
  if (event.inputTokens !== null) parts.push(`${formatTokens(event.inputTokens)} in`)
  if (event.outputTokens !== null) parts.push(`${formatTokens(event.outputTokens)} out`)
  return (
    <div className="flex items-center gap-2 py-1 font-mono text-[10.5px] text-muted-foreground tabular-nums">
      <span aria-hidden className="flex-1 border-t border-dashed border-frame" />
      <span>{parts.length > 0 ? parts.join(' · ') : 'turn done'}</span>
      <span aria-hidden className="flex-1 border-t border-dashed border-frame" />
    </div>
  )
}

function FollowUp({ agent, store, onSelect }: { agent: AgentSummary; store: AgentsStore; onSelect: (id: string) => void }) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const attachments = useAttachments()
  const commands = useCommands(agent.repoPath ?? agent.cwd)
  const slash = useSlashMenu({ text, setText, textarea, commands, provider: agent.provider, placement: 'above' })
  const outside = agent.source !== 'prot'
  const running = agent.status === 'running'
  const ready = text.trim().length > 0 && !running && !sending && !attachments.busy

  async function send() {
    if (!ready) return
    setSending(true)
    try {
      const next = await window.prot.agents.send(agent.id, text.trim(), attachments.items)
      store.upsert(next)
      setText('')
      attachments.clear()
      if (next.id !== agent.id) onSelect(next.id)
    } catch (error) {
      toast.error(outside ? 'Could not continue the session' : 'Could not send the message', { description: errorMessage(error) })
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="shrink-0 border-t border-pane-border p-2.5">
      <div
        {...attachments.dropProps}
        className={cn(
          'relative rounded-[9px] border border-pane-border bg-muted/40 p-1 pl-2.5 font-mono focus-within:border-frame',
          attachments.dragging && 'border-frame bg-selection/40'
        )}
      >
        {slash.menu}
        <AttachmentStrip attachments={attachments} />
        <div className="flex items-end gap-2">
          <span aria-hidden className="py-1.5 text-[12.5px] leading-5 text-muted-foreground">
            ›
          </span>
          <Textarea
            ref={textarea}
            aria-label="Message agent"
            placeholder={running ? 'The agent is working…' : outside ? 'Continue in prot (forks the session)' : 'Send a follow-up, / for skills'}
            value={text}
            disabled={running || sending}
            {...slash.inputProps}
            onChange={(event) => {
              setText(event.target.value)
              slash.track(event.target)
            }}
            onSelect={(event) => slash.track(event.currentTarget)}
            onPaste={attachments.onPaste}
            onKeyDown={(event) => {
              if (slash.onKeyDown(event)) return
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                void send()
              }
            }}
            rows={2}
            className="max-h-48 min-h-0 resize-none border-0 bg-transparent p-0 py-1.5 font-mono text-[12.5px] leading-5 shadow-none focus-visible:ring-0 disabled:opacity-60 dark:bg-transparent"
          />
          <AttachButton attachments={attachments} disabled={running || sending} />
          <ContextWheel context={agent.context} />
          {outside ? (
            <Button size="sm" aria-label="Continue in prot" disabled={!ready} onClick={() => void send()} className="h-7 rounded-[7px] px-2.5 font-mono text-[11.5px]">
              {sending ? <LoaderCircle className="animate-spin" /> : <ArrowUp />}
              Continue in prot
            </Button>
          ) : (
            <Button size="icon-sm" aria-label="Send" title="Send (⌘↵)" disabled={!ready} onClick={() => void send()} className="size-7 rounded-[7px]">
              {sending ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
            </Button>
          )}
        </div>
      </div>
      <p className="px-1 pt-1.5 font-mono text-[10.5px] text-muted-foreground">
        {outside ? 'Continue in prot (forks the session) · ⌘↵' : running ? 'Follow-ups open when the turn ends' : '⌘↵ to send'}
      </p>
    </div>
  )
}

type PanelTab = 'activity' | 'changes'

function SidePanel({
  tab,
  onTab,
  changeCount,
  activity,
  changes
}: {
  tab: PanelTab
  onTab: (tab: PanelTab) => void
  changeCount: number
  activity: ReactNode
  changes: ReactNode
}) {
  const tabs: { id: PanelTab; label: string; count: number | null }[] = [
    { id: 'activity', label: 'Activity', count: null },
    { id: 'changes', label: 'Changes', count: changeCount }
  ]
  return (
    <aside aria-label={tab === 'activity' ? 'Activity' : 'Changes'} className="flex w-[320px] shrink-0 flex-col border-l border-pane-border">
      <div role="tablist" aria-label="Side panel" className="flex h-9 shrink-0 items-center gap-1 px-2">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => onTab(item.id)}
            className={cn(
              'flex h-6 items-center gap-1.5 rounded-[6px] px-2 font-mono text-[11.5px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
              tab === item.id ? 'bg-tab-active text-foreground shadow-raised' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {item.label}
            {item.count !== null && item.count > 0 && <span className="tabular-nums">{item.count}</span>}
          </button>
        ))}
      </div>
      {tab === 'activity' ? activity : changes}
    </aside>
  )
}

function ActivityPanel({ events, activeRun }: { events: AgentEvent[]; activeRun: string | null }) {
  const listRef = useRef<HTMLDivElement>(null)
  const runs: Extract<TranscriptItem, { kind: 'run' }>[] = []
  for (const item of groupTranscript(events)) {
    if (item.kind === 'run') runs.push(item)
  }

  useEffect(() => {
    const list = listRef.current
    const run = activeRun ? list?.querySelector<HTMLElement>(`[data-run="${CSS.escape(activeRun)}"]`) : null
    if (list && run) list.scrollTop = run.offsetTop - list.offsetTop - 8
  }, [activeRun])

  return (
    <div ref={listRef} className="scroll-quiet relative min-h-0 flex-1 space-y-3 overflow-y-auto px-2 pb-3">
      {runs.length === 0 ? (
        <p className="px-1.5 py-1 font-mono text-[11.5px] text-muted-foreground">No tool calls yet.</p>
      ) : (
        runs.map((run, index) => (
          <section
            key={run.id}
            data-run={run.id}
            aria-label={`Steps ${index + 1}`}
            className={cn('space-y-1.5 rounded-[7px] p-1', activeRun === run.id && 'bg-selection/60')}
          >
            <p className="px-1 font-mono text-[10.5px] text-muted-foreground">
              [{index + 1}] {runLabel(run.tools)}
            </p>
            {run.events.map((event) =>
              event.kind === 'tool' ? <ToolRow key={event.id} event={event} /> : event.kind === 'thinking' ? <Thinking key={event.id} text={event.text} /> : null
            )}
          </section>
        ))
      )}
    </div>
  )
}

function ChangesPanel({
  changes,
  selected,
  onSelect
}: {
  changes: AgentFileChange[] | null
  selected: string | null
  onSelect: (path: string | null) => void
}) {
  let additions = 0
  let deletions = 0
  for (const change of changes ?? []) {
    additions += change.additions
    deletions += change.deletions
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-7 shrink-0 items-center justify-end pr-3 pl-3 font-mono text-[11.5px] text-muted-foreground">
        <DiffStat additions={additions} deletions={deletions} className="text-[11px]" />
      </div>
      <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {changes === null ? (
          <LoaderCircle aria-label="Loading changes" className="mx-auto mt-4 size-3.5 animate-spin text-muted-foreground" />
        ) : changes.length === 0 ? (
          <p className="px-1.5 py-1 font-mono text-[11.5px] text-muted-foreground">No changes yet.</p>
        ) : (
          <ul className="space-y-px">
            {changes.map((change) => {
              const { name, dir } = splitPath(change.path)
              const isSelected = selected === change.path
              return (
                <li key={change.path}>
                  <button
                    type="button"
                    aria-label={change.path}
                    aria-current={isSelected ? 'true' : undefined}
                    title={`${change.path} (${change.status})`}
                    onClick={() => onSelect(isSelected ? null : change.path)}
                    className={cn(
                      'flex w-full items-center gap-1.5 rounded-[5px] px-1.5 py-1 text-left font-mono text-[11.5px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                      isSelected ? 'bg-selection' : 'hover:bg-accent'
                    )}
                  >
                    <FileIcon path={change.path} className="size-3.5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">
                      <span className={cn(change.status === 'removed' && 'text-removed line-through', (change.status === 'added' || change.status === 'untracked') && 'text-added')}>
                        {name}
                      </span>
                      {dir && <span className="ml-1.5 text-[10.5px] text-muted-foreground">{dir}</span>}
                    </span>
                    <DiffStat additions={change.additions} deletions={change.deletions} className="text-[10.5px]" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

function PatchPane({ agentId, path, tick, onClose }: { agentId: string; path: string; tick: number; onClose: () => void }) {
  const [patch, setPatch] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setError(null)
    window.prot.agents
      .diff(agentId, path)
      .then((next) => {
        if (live) setPatch(next)
      })
      .catch((failure: unknown) => {
        if (live) setError(errorMessage(failure))
      })
    return () => {
      live = false
    }
  }, [agentId, path, tick])

  return (
    <section aria-label={`Diff of ${path}`} className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-pane-border pr-2 pl-3.5">
        <FileIcon path={path} className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]" title={path}>
          {path}
        </span>
        <PaneButton aria-label="Back to transcript" title="Back to transcript" onClick={onClose}>
          <X />
        </PaneButton>
      </div>
      <div className="scroll-quiet min-h-0 flex-1 overflow-auto">
        {error ? (
          <p role="alert" className="px-4 py-6 font-mono text-[12px] text-destructive">
            ! {error}
          </p>
        ) : patch === null ? (
          <LoaderCircle aria-label="Loading diff" className="mx-auto mt-6 size-4 animate-spin text-muted-foreground" />
        ) : (
          <PatchView path={path} patch={patch} />
        )}
      </div>
    </section>
  )
}

function PatchView({ path, patch }: { path: string; patch: string }) {
  const lang = languageFor(path)
  const { rows, oldSide, newSide } = useMemo(() => buildRows(parsePatch(patch), false), [patch])
  const oldTokens = useHighlighted(oldSide, lang)
  const newTokens = useHighlighted(newSide, lang)
  if (rows.length === 0) {
    return (
      <p className="px-4 py-6 text-center font-mono text-[12px] text-muted-foreground">
        No textual diff for this file. It may be binary or only renamed.
      </p>
    )
  }
  return (
    <div className="py-1 font-mono text-[12px] leading-5">
      {rows.map((row) => {
        if (row.kind === 'gap') return null
        if (row.kind === 'hunk') {
          return (
            <div key={row.key} className="truncate py-0.5 pr-4 pl-[86px] text-hunk select-none">
              {row.header}
            </div>
          )
        }
        const side = row.tokenSide === 'old' ? oldTokens : newTokens
        return <LineRow key={row.key} line={row.line} tokens={side?.[row.tokenIndex]} />
      })}
    </div>
  )
}
