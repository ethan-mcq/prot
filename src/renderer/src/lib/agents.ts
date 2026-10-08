import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type {
  AgentEvent,
  AgentProvider,
  AgentRepo,
  AgentsState,
  AgentSummary,
  ProviderInfo,
  UsageWindow
} from '@shared/agents'
import { AGENT_PROVIDERS } from '@shared/agents'
import { relativeTime } from '@/lib/paths'
import { errorMessage } from '@/lib/utils'

export type AgentSection = 'working' | 'needs' | 'prot' | 'claude-app' | 'codex-app'

// A section with no empty message is hidden while it has nothing in it.
export const AGENT_SECTIONS: { id: AgentSection; title: string; empty: string | null }[] = [
  { id: 'working', title: 'Working', empty: 'No agents are working.' },
  { id: 'needs', title: 'Needs you', empty: 'Nothing needs you.' },
  { id: 'prot', title: 'prot', empty: 'Agents you start in prot show up here.' },
  { id: 'claude-app', title: 'Claude app', empty: null },
  { id: 'codex-app', title: 'Codex app', empty: null }
]

export function agentSection(agent: AgentSummary): AgentSection {
  if (agent.status === 'running') return 'working'
  if (agent.status === 'failed' || (agent.status === 'idle' && agent.unread)) return 'needs'
  if (agent.source === 'claude-app') return 'claude-app'
  if (agent.source === 'codex-app') return 'codex-app'
  return 'prot'
}

export function newestFirst(agents: AgentSummary[]): AgentSummary[] {
  return [...agents].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
}

export type SectionedAgents = Record<AgentSection, { agents: AgentSummary[]; total: number }>

export function sectionAgents(agents: AgentSummary[], hidden: AgentProvider[]): SectionedAgents {
  const out: SectionedAgents = {
    working: { agents: [], total: 0 },
    needs: { agents: [], total: 0 },
    prot: { agents: [], total: 0 },
    'claude-app': { agents: [], total: 0 },
    'codex-app': { agents: [], total: 0 }
  }
  for (const agent of newestFirst(agents)) {
    const section = out[agentSection(agent)]
    section.total += 1
    if (!hidden.includes(agent.provider)) section.agents.push(agent)
  }
  return out
}

export function withAgent(state: AgentsState, agent: AgentSummary): AgentsState {
  let found = false
  const agents: AgentSummary[] = []
  for (const existing of state.agents) {
    if (existing.id === agent.id) {
      found = true
      agents.push(agent)
    } else {
      agents.push(existing)
    }
  }
  if (!found) agents.push(agent)
  return { ...state, agents }
}

export function withoutAgent(state: AgentsState, id: string): AgentsState {
  return { ...state, agents: state.agents.filter((agent) => agent.id !== id) }
}

export function withUsage(state: AgentsState, provider: AgentProvider, usage: UsageWindow[]): AgentsState {
  return { ...state, providers: state.providers.map((info) => (info.provider === provider ? { ...info, usage } : info)) }
}

export function withRepo(state: AgentsState, repo: AgentRepo): AgentsState {
  return { ...state, repos: [repo, ...state.repos.filter((r) => r.path !== repo.path)] }
}

// Elapsed time of the current turn, or how long ago the agent last changed when its start is unknown.
export function runningFor(agent: AgentSummary, now: number): string {
  if (agent.turnStartedAt === null) return relativeTime(agent.updatedAt, now)
  return formatDuration(now - Date.parse(agent.turnStartedAt))
}

// Tool events are re-sent with the same id when they finish.
export function upsertEvent(events: AgentEvent[], event: AgentEvent): AgentEvent[] {
  const index = events.findIndex((e) => e.id === event.id)
  if (index === -1) return [...events, event]
  const next = [...events]
  next[index] = event
  return next
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  if (total < 60) return `${total}s`
  const minutes = Math.floor(total / 60)
  if (minutes < 60) return `${minutes}m ${String(total % 60).padStart(2, '0')}s`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

// resetsAt is epoch seconds.
export function formatReset(resetsAt: number | null, now: number): string | null {
  if (resetsAt === null) return null
  const minutes = Math.ceil((resetsAt * 1000 - now) / 60000)
  if (minutes <= 0) return 'resets now'
  if (minutes < 60) return `resets in ${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `resets in ${hours}h ${String(minutes % 60).padStart(2, '0')}m`
  return `resets in ${Math.floor(hours / 24)}d ${hours % 24}h`
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1e6) return `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k`
  return `${(n / 1e6).toFixed(1)}M`
}

export function formatCost(usd: number): string {
  if (usd > 0 && usd < 0.01) return '<$0.01'
  return `$${usd.toFixed(2)}`
}

const EFFORT_NAMES: Record<string, string> = {
  none: 'None',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max'
}

export function effortLabel(effort: string): string {
  return EFFORT_NAMES[effort] ?? effort.charAt(0).toUpperCase() + effort.slice(1)
}

export function providerReady(info: ProviderInfo): boolean {
  return info.installed && info.signedIn
}

export function providerProblem(info: ProviderInfo): string | null {
  if (!info.installed) return 'not installed'
  if (!info.signedIn) return 'not signed in'
  return null
}

export function modelLabel(providers: ProviderInfo[], provider: AgentProvider, model: string | null): string | null {
  if (model === null) return null
  const info = providers.find((p) => p.provider === provider)
  return info?.models.find((m) => m.id === model)?.label ?? model
}

export function permissionLabel(providers: ProviderInfo[], provider: AgentProvider, permission: string | null): string | null {
  if (permission === null) return null
  const info = providers.find((p) => p.provider === provider)
  return info?.permissions.find((p) => p.id === permission)?.label ?? permission
}

export type ComposerChoice = {
  provider: AgentProvider
  model: string
  effort: string
  permission: string
  worktree: boolean
  repoPath: string | null
}

export function chooseModel(info: ProviderInfo, modelId: string | undefined, effort: string | undefined): { model: string; effort: string } {
  const model = info.models.find((m) => m.id === modelId) ?? info.models.find((m) => m.id === info.defaultModel) ?? info.models[0]
  if (!model) return { model: modelId ?? info.defaultModel, effort: effort ?? info.defaultEffort }
  if (effort !== undefined && model.efforts.includes(effort)) return { model: model.id, effort }
  if (model.id === info.defaultModel && model.efforts.includes(info.defaultEffort)) return { model: model.id, effort: info.defaultEffort }
  return { model: model.id, effort: model.defaultEffort }
}

export function resolveChoice(
  providers: ProviderInfo[],
  repos: AgentRepo[],
  stored: Partial<ComposerChoice> | null
): ComposerChoice | null {
  const storedInfo = providers.find((p) => p.provider === stored?.provider)
  const info =
    (storedInfo && providerReady(storedInfo) ? storedInfo : undefined) ?? providers.find(providerReady) ?? storedInfo ?? providers[0]
  if (!info) return null
  const same = stored?.provider === info.provider
  const { model, effort } = chooseModel(info, same ? stored?.model : undefined, same ? stored?.effort : undefined)
  const permission =
    same && info.permissions.some((p) => p.id === stored?.permission) && stored?.permission !== undefined
      ? stored.permission
      : info.defaultPermission
  const repoPath = repos.some((r) => r.path === stored?.repoPath) ? (stored?.repoPath ?? null) : (repos[0]?.path ?? null)
  return { provider: info.provider, model, effort, permission, worktree: stored?.worktree ?? true, repoPath }
}

const CHOICE_KEY = 'prot:agents:composer'
const HIDDEN_KEY = 'prot:agents:hidden'

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

export function parseChoice(value: unknown): Partial<ComposerChoice> | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  const choice: Partial<ComposerChoice> = {}
  if (typeof raw.provider === 'string' && (AGENT_PROVIDERS as readonly string[]).includes(raw.provider)) {
    choice.provider = raw.provider as AgentProvider
  }
  if (typeof raw.model === 'string') choice.model = raw.model
  if (typeof raw.effort === 'string') choice.effort = raw.effort
  if (typeof raw.permission === 'string') choice.permission = raw.permission
  if (typeof raw.worktree === 'boolean') choice.worktree = raw.worktree
  if (typeof raw.repoPath === 'string') choice.repoPath = raw.repoPath
  return choice
}

export function readChoice(): Partial<ComposerChoice> | null {
  return parseChoice(read(CHOICE_KEY))
}

export function writeChoice(choice: ComposerChoice): void {
  write(CHOICE_KEY, choice)
}

export function readFlag(key: string, fallback: boolean): boolean {
  const value = read(key)
  return typeof value === 'boolean' ? value : fallback
}

export function writeFlag(key: string, value: boolean): void {
  write(key, value)
}

export function useHiddenProviders(): [AgentProvider[], (hidden: AgentProvider[]) => void] {
  const [hidden, setHidden] = useState<AgentProvider[]>(() => {
    const stored = read(HIDDEN_KEY)
    const out: AgentProvider[] = []
    if (Array.isArray(stored)) {
      for (const provider of AGENT_PROVIDERS) if (stored.includes(provider)) out.push(provider)
    }
    return out
  })
  const update = useCallback((next: AgentProvider[]) => {
    setHidden(next)
    write(HIDDEN_KEY, next)
  }, [])
  return [hidden, update]
}

export function useNow(intervalMs: number, enabled = true): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs, enabled])
  return now
}

export type AgentsStore = {
  state: AgentsState | null
  error: string | null
  refreshing: boolean
  refresh: () => Promise<void>
  reload: () => Promise<void>
  upsert: (agent: AgentSummary) => void
  remove: (id: string) => void
  addRepo: (repo: AgentRepo) => void
}

export function useAgents(): AgentsStore {
  const [state, setState] = useState<AgentsState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    let live = true
    window.prot.agents
      .state()
      .then((next) => {
        if (live) setState(next)
      })
      .catch((failure: unknown) => {
        if (live) setError(errorMessage(failure))
      })
    const unsubscribe = window.prot.agents.onChange((change) => {
      setState((prev) => (prev ? withAgent(prev, change.agent) : prev))
    })
    const unsubscribeUsage = window.prot.agents.onUsage((change) => {
      setState((prev) => (prev ? withUsage(prev, change.provider, change.usage) : prev))
    })
    return () => {
      live = false
      unsubscribe()
      unsubscribeUsage()
    }
  }, [])

  const reload = useCallback(async () => {
    try {
      const next = await window.prot.agents.state()
      setState(next)
      setError(null)
    } catch (failure) {
      setError(errorMessage(failure))
    }
  }, [])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const next = await window.prot.agents.refresh()
      setState(next)
      setError(null)
    } catch (failure) {
      toast.error('Could not refresh agents', { description: errorMessage(failure) })
    } finally {
      setRefreshing(false)
    }
  }, [])

  const upsert = useCallback((agent: AgentSummary) => {
    setState((prev) => (prev ? withAgent(prev, agent) : prev))
  }, [])

  const remove = useCallback((id: string) => {
    setState((prev) => (prev ? withoutAgent(prev, id) : prev))
  }, [])

  const addRepo = useCallback((repo: AgentRepo) => {
    setState((prev) => (prev ? withRepo(prev, repo) : prev))
  }, [])

  return { state, error, refreshing, refresh, reload, upsert, remove, addRepo }
}

export type ToolEvent = Extract<AgentEvent, { kind: 'tool' }>

// A run is the tool calls (and the thinking between them) between two messages; it shows as one row.
export type TranscriptItem = { kind: 'event'; event: AgentEvent } | { kind: 'run'; id: string; events: AgentEvent[]; tools: ToolEvent[] }

const SUBAGENT_TOOLS = ['Task', 'Agent']

export function groupTranscript(events: AgentEvent[]): TranscriptItem[] {
  const items: TranscriptItem[] = []
  let run: Extract<TranscriptItem, { kind: 'run' }> | null = null
  for (const event of events) {
    if (event.kind === 'tool' || event.kind === 'thinking') {
      if (!run) {
        run = { kind: 'run', id: event.id, events: [], tools: [] }
        items.push(run)
      }
      run.events.push(event)
      if (event.kind === 'tool') run.tools.push(event)
      continue
    }
    run = null
    items.push({ kind: 'event', event })
  }
  // A run of thinking alone stays inline.
  const out: TranscriptItem[] = []
  for (const item of items) {
    if (item.kind === 'run' && item.tools.length === 0) {
      for (const event of item.events) out.push({ kind: 'event', event })
    } else out.push(item)
  }
  return out
}

export function runLabel(tools: ToolEvent[]): string {
  let running = 0
  let failed = 0
  let subagents = 0
  for (const tool of tools) {
    if (tool.status === 'running') running += 1
    if (tool.status === 'error') failed += 1
    if (SUBAGENT_TOOLS.includes(tool.name)) subagents += 1
  }
  const parts: string[] = []
  if (running > 0) parts.push(`${running} running, ${tools.length - running} completed`)
  else parts.push(`${tools.length} tool ${tools.length === 1 ? 'call' : 'calls'}`)
  if (subagents > 0) parts.push(`${subagents} ${subagents === 1 ? 'subagent' : 'subagents'}`)
  if (failed > 0) parts.push(`${failed} failed`)
  return parts.join(' · ')
}
