import { readFileSync } from 'node:fs'
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { AGENT_PROVIDERS, type AgentEvent, type AgentProvider, type AgentSummary, type UsageWindow } from '@shared/agents'
import { collapse } from './sessions'

export type StoredAgent = AgentSummary & {
  archived: boolean
  // The outside session this agent was forked from, if any.
  forkedFrom: string | null
  // The agent system prompt version locked for this agent's turns.
  promptHash: string | null
}

type StoreFile = {
  agents: StoredAgent[]
  repos: string[]
  // Outside sessions archived from the dash.
  hidden: string[]
  usage: Partial<Record<AgentProvider, UsageWindow[]>>
}

const REPO_CAP = 20
const SAVE_DELAY_MS = 500
const AGENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    if (typeof item === 'string') out.push(item)
  }
  return out
}

function parseAgent(raw: unknown): StoredAgent | null {
  if (typeof raw !== 'object' || raw === null) return null
  const value = raw as Partial<StoredAgent>
  if (typeof value.id !== 'string' || !AGENT_ID.test(value.id)) return null
  if (!AGENT_PROVIDERS.includes(value.provider as AgentProvider)) return null
  if (typeof value.cwd !== 'string' || typeof value.title !== 'string') return null
  if (typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string') return null
  return {
    id: value.id,
    source: 'prot',
    provider: value.provider as AgentProvider,
    title: value.title,
    repoPath: value.repoPath ?? null,
    repoName: value.repoName ?? null,
    cwd: value.cwd,
    branch: value.branch ?? null,
    worktree: value.worktree ?? null,
    model: value.model ?? null,
    effort: value.effort ?? null,
    permission: value.permission ?? null,
    sessionId: value.sessionId ?? null,
    status: value.status ?? 'idle',
    turnStartedAt: value.turnStartedAt ?? null,
    unread: value.unread === true,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    lastMessage: value.lastMessage ?? null,
    pr: value.pr ?? null,
    changes: value.changes ?? null,
    costUsd: value.costUsd ?? null,
    archived: value.archived === true,
    forkedFrom: value.forkedFrom ?? null,
    promptHash: typeof value.promptHash === 'string' ? value.promptHash : null
  }
}

function parseUsage(raw: unknown): StoreFile['usage'] {
  const usage: StoreFile['usage'] = {}
  if (typeof raw !== 'object' || raw === null) return usage
  for (const provider of AGENT_PROVIDERS) {
    const windows = (raw as Record<string, unknown>)[provider]
    if (!Array.isArray(windows)) continue
    const valid: UsageWindow[] = []
    for (const window of windows as Partial<UsageWindow>[]) {
      if (typeof window?.label === 'string' && typeof window.usedPercent === 'number') {
        valid.push({ label: window.label, usedPercent: window.usedPercent, resetsAt: typeof window.resetsAt === 'number' ? window.resetsAt : null })
      }
    }
    usage[provider] = valid
  }
  return usage
}

export function parseStoreFile(raw: unknown): StoreFile {
  const value = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const agents: StoredAgent[] = []
  if (Array.isArray(value.agents)) {
    for (const item of value.agents) {
      const agent = parseAgent(item)
      if (agent) agents.push(agent)
    }
  }
  return { agents, repos: strings(value.repos), hidden: strings(value.hidden), usage: parseUsage(value.usage) }
}

// agents.json holds the agent list; agents/<id>.jsonl holds each agent's transcript, one event version per line.
export class AgentStore {
  private data: StoreFile
  private readonly file: string
  private readonly transcripts: string
  private saving: Promise<void> = Promise.resolve()
  private timer: NodeJS.Timeout | null = null
  private readonly appends = new Map<string, Promise<void>>()

  constructor(root: string) {
    this.file = join(root, 'agents.json')
    this.transcripts = join(root, 'agents')
    try {
      this.data = parseStoreFile(JSON.parse(readFileSync(this.file, 'utf8')))
    } catch {
      this.data = parseStoreFile(null)
    }
  }

  agents(): StoredAgent[] {
    return this.data.agents
  }

  get(id: string): StoredAgent | undefined {
    return this.data.agents.find((agent) => agent.id === id)
  }

  add(agent: StoredAgent): void {
    this.data.agents = [...this.data.agents, agent]
    this.scheduleSave()
  }

  repos(): string[] {
    return this.data.repos
  }

  addRepo(path: string): void {
    const repos = [path]
    for (const repo of this.data.repos) {
      if (repo !== path && repos.length < REPO_CAP) repos.push(repo)
    }
    this.data.repos = repos
    this.scheduleSave()
  }

  isHidden(id: string): boolean {
    return this.data.hidden.includes(id)
  }

  hide(id: string): void {
    if (this.isHidden(id)) return
    this.data.hidden = [...this.data.hidden, id]
    this.scheduleSave()
  }

  usage(provider: AgentProvider): UsageWindow[] {
    return this.data.usage[provider] ?? []
  }

  setUsage(provider: AgentProvider, windows: UsageWindow[]): void {
    this.data.usage = { ...this.data.usage, [provider]: windows }
    this.scheduleSave()
  }

  // Agents are mutated in place by the manager; this batches the write.
  scheduleSave(): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.save().catch((error: unknown) => console.error('Could not save agents.json', error))
    }, SAVE_DELAY_MS)
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    await this.save()
  }

  private save(): Promise<void> {
    const text = JSON.stringify(this.data, null, 2)
    const write = this.saving
      .catch(() => {})
      .then(async () => {
        await mkdir(dirname(this.file), { recursive: true })
        const tmp = `${this.file}.tmp`
        await writeFile(tmp, text)
        await rename(tmp, this.file)
      })
    this.saving = write
    return write
  }

  private transcriptFile(id: string): string {
    if (!AGENT_ID.test(id)) throw new Error('Invalid agent id')
    return join(this.transcripts, `${id}.jsonl`)
  }

  appendEvents(id: string, events: AgentEvent[]): Promise<void> {
    if (events.length === 0) return Promise.resolve()
    const file = this.transcriptFile(id)
    let text = ''
    for (const event of events) text += `${JSON.stringify(event)}\n`
    const previous = this.appends.get(id) ?? Promise.resolve()
    const next = previous
      .catch(() => {})
      .then(async () => {
        await mkdir(this.transcripts, { recursive: true })
        await appendFile(file, text)
      })
    this.appends.set(id, next)
    return next
  }

  async readTranscript(id: string): Promise<AgentEvent[]> {
    const file = this.transcriptFile(id)
    await (this.appends.get(id) ?? Promise.resolve()).catch(() => {})
    let text: string
    try {
      text = await readFile(file, 'utf8')
    } catch {
      return []
    }
    const events: AgentEvent[] = []
    for (const line of text.split('\n')) {
      if (line === '') continue
      try {
        events.push(JSON.parse(line) as AgentEvent)
      } catch {
        continue
      }
    }
    return collapse(events)
  }
}
