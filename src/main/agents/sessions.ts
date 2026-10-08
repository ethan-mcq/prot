import { createReadStream } from 'node:fs'
import { open, readdir, readFile, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { createInterface } from 'node:readline'
import type { AgentEvent, AgentProvider, UsageWindow } from '@shared/agents'
import { claudePromptText, claudeTitleText, newClaudeState, parseClaudeLine } from './claude-events'
import { isConfigWarning, mcpResultText } from './codex-events'
import { oneLine, toolSummary, truncateOutput, unwrapShell, usageWindow, windowLabel, type ToolEvent } from './events'

export const SESSION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
export const SESSION_CAP = 40
export const RUNNING_WINDOW_MS = 90 * 1000
const HEAD_MAX_BYTES = 8 * 1024 * 1024
const TAIL_BYTES = 256 * 1024
const CODEX_DAY_DIRS = 30
export const TRANSCRIPT_EVENT_CAP = 2000

export type OutsideSession = {
  provider: AgentProvider
  sessionId: string
  file: string
  title: string
  cwd: string
  gitBranch: string | null
  model: string | null
  effort: string | null
  createdAt: string
  updatedAt: string
  running: boolean
  // When the newest turn started, if the tail of the file shows one.
  lastTurnAt: string | null
  lastMessage: string | null
  costUsd: number | null
}

type FileEntry = { file: string; mtimeMs: number; size: number }

type Cached = { mtimeMs: number; size: number; session: OutsideSession | null }

const summaryCache = new Map<string, Cached>()

function parseJson(line: string): Record<string, unknown> | null {
  if (line === '') return null
  try {
    const value = JSON.parse(line) as unknown
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

// Streams lines from the start until visit returns true or maxBytes have been read.
async function readHead(file: string, visit: (line: Record<string, unknown>) => boolean): Promise<void> {
  const stream = createReadStream(file, { encoding: 'utf8', end: HEAD_MAX_BYTES })
  const lines = createInterface({ input: stream, crlfDelay: Infinity })
  try {
    for await (const text of lines) {
      const line = parseJson(text)
      if (line && visit(line)) break
    }
  } finally {
    lines.close()
    stream.destroy()
  }
}

// The complete lines in the last `bytes` of the file, oldest first.
async function readTail(file: string, size: number, bytes = TAIL_BYTES): Promise<Record<string, unknown>[]> {
  const start = Math.max(0, size - bytes)
  const handle = await open(file, 'r')
  try {
    const buffer = Buffer.alloc(size - start)
    await handle.read(buffer, 0, buffer.length, start)
    const parts = buffer.toString('utf8').split('\n')
    if (start > 0) parts.shift()
    const lines: Record<string, unknown>[] = []
    for (const part of parts) {
      const line = parseJson(part)
      if (line) lines.push(line)
    }
    return lines
  } finally {
    await handle.close()
  }
}

async function readLines(file: string): Promise<Record<string, unknown>[]> {
  const lines: Record<string, unknown>[] = []
  for (const text of (await readFile(file, 'utf8')).split('\n')) {
    const line = parseJson(text)
    if (line) lines.push(line)
  }
  return lines
}

async function statEntry(file: string): Promise<FileEntry | null> {
  try {
    const info = await stat(file)
    return info.isFile() ? { file, mtimeMs: info.mtimeMs, size: info.size } : null
  } catch {
    return null
  }
}

async function listDir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir)
  } catch {
    return []
  }
}

function recent(entries: FileEntry[], now: number): FileEntry[] {
  const fresh: FileEntry[] = []
  for (const entry of entries) {
    if (now - entry.mtimeMs <= SESSION_WINDOW_MS) fresh.push(entry)
  }
  fresh.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return fresh
}

async function cachedSummary(
  entry: FileEntry,
  now: number,
  read: (entry: FileEntry) => Promise<OutsideSession | null>
): Promise<OutsideSession | null> {
  const cached = summaryCache.get(entry.file)
  let session: OutsideSession | null
  if (cached && cached.mtimeMs === entry.mtimeMs && cached.size === entry.size) session = cached.session
  else {
    try {
      session = await read(entry)
    } catch {
      session = null
    }
    summaryCache.set(entry.file, { mtimeMs: entry.mtimeMs, size: entry.size, session })
  }
  if (!session) return null
  return { ...session, running: now - entry.mtimeMs <= RUNNING_WINDOW_MS }
}

// Claude

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function assistantText(line: Record<string, unknown>): string | null {
  if (line.type !== 'assistant' || line.isSidechain === true) return null
  const content = (line.message as { content?: unknown } | undefined)?.content
  if (!Array.isArray(content)) return null
  let text: string | null = null
  for (const block of content as { type?: unknown; text?: unknown }[]) {
    if (block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') text = block.text
  }
  return text
}

async function readClaudeSummary(entry: FileEntry): Promise<OutsideSession | null> {
  const sessionId = basename(entry.file, '.jsonl')
  let firstPrompt: string | null = null
  let cwd: string | null = null
  let gitBranch: string | null = null
  let model: string | null = null
  let createdAt: string | null = null
  await readHead(entry.file, (line) => {
    if (!createdAt) createdAt = str(line.timestamp)
    if (!cwd) cwd = str(line.cwd)
    if (!gitBranch) gitBranch = str(line.gitBranch)
    if (!model && line.type === 'assistant') model = str((line.message as { model?: unknown } | undefined)?.model)
    if (!firstPrompt) firstPrompt = claudePromptText(line)
    return firstPrompt !== null && cwd !== null && model !== null
  })
  let customTitle: string | null = null
  let aiTitle: string | null = null
  let lastMessage: string | null = null
  let costUsd: number | null = null
  let lastTurnAt: string | null = null
  for (const line of await readTail(entry.file, entry.size)) {
    if (claudePromptText(line)) lastTurnAt = str(line.timestamp) ?? lastTurnAt
    if (line.type === 'custom-title') customTitle = str(line.customTitle) ?? customTitle
    else if (line.type === 'ai-title') aiTitle = str(line.aiTitle) ?? aiTitle
    else if (line.type === 'cost-state' && typeof line.totalCostUSD === 'number') costUsd = line.totalCostUSD
    const text = assistantText(line)
    if (text) lastMessage = text
    if (line.isSidechain !== true) {
      cwd = str(line.cwd) ?? cwd
      gitBranch = str(line.gitBranch) ?? gitBranch
      if (line.type === 'assistant') {
        const lineModel = str((line.message as { model?: unknown } | undefined)?.model)
        if (lineModel && !lineModel.startsWith('<')) model = lineModel
      }
    }
  }
  const title = customTitle ?? aiTitle ?? firstPrompt
  if (!title || !cwd) return null
  if (model && model.startsWith('<')) model = null
  return {
    provider: 'claude',
    sessionId,
    file: entry.file,
    title: claudeTitleText(title),
    cwd,
    gitBranch: gitBranch === 'HEAD' ? null : gitBranch,
    model,
    effort: null,
    createdAt: createdAt ?? new Date(entry.mtimeMs).toISOString(),
    updatedAt: new Date(entry.mtimeMs).toISOString(),
    running: false,
    lastTurnAt,
    lastMessage: lastMessage ? oneLine(lastMessage).slice(0, 300) : null,
    costUsd
  }
}

export async function listClaudeSessions(configDir: string, exclude: Set<string>, now = Date.now()): Promise<OutsideSession[]> {
  const projects = join(configDir, 'projects')
  const entries: FileEntry[] = []
  for (const project of await listDir(projects)) {
    const dir = join(projects, project)
    for (const name of await listDir(dir)) {
      if (!name.endsWith('.jsonl')) continue
      const id = name.slice(0, -'.jsonl'.length)
      if (!UUID.test(id) || exclude.has(id)) continue
      const entry = await statEntry(join(dir, name))
      if (entry) entries.push(entry)
    }
  }
  const sessions: OutsideSession[] = []
  for (const entry of recent(entries, now)) {
    if (sessions.length >= SESSION_CAP) break
    const session = await cachedSummary(entry, now, readClaudeSummary)
    if (session) sessions.push(session)
  }
  return sessions
}

export async function readClaudeTranscript(file: string): Promise<AgentEvent[]> {
  const state = newClaudeState(true)
  const events: AgentEvent[] = []
  const now = new Date().toISOString()
  for (const line of await readLines(file)) {
    for (const event of parseClaudeLine(line, state, now).events) events.push(event)
  }
  return collapse(events)
}

// Codex

function codexIdFromName(name: string): string | null {
  const match = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i.exec(name)
  return match && match[1] ? match[1] : null
}

async function codexFiles(home: string, now: number): Promise<FileEntry[]> {
  const root = join(home, 'sessions')
  const oldest = now - CODEX_DAY_DIRS * 24 * 60 * 60 * 1000
  const entries: FileEntry[] = []
  for (const year of await listDir(root)) {
    for (const month of await listDir(join(root, year))) {
      for (const day of await listDir(join(root, year, month))) {
        const dayStart = Date.UTC(Number(year), Number(month) - 1, Number(day))
        if (Number.isFinite(dayStart) && dayStart < oldest) continue
        const dir = join(root, year, month, day)
        for (const name of await listDir(dir)) {
          if (!name.startsWith('rollout-') || !name.endsWith('.jsonl')) continue
          const entry = await statEntry(join(dir, name))
          if (entry) entries.push(entry)
        }
      }
    }
  }
  return entries
}

async function codexTitles(home: string): Promise<Map<string, string>> {
  const titles = new Map<string, string>()
  try {
    for (const line of await readLines(join(home, 'session_index.jsonl'))) {
      const id = str(line.id)
      const name = str(line.thread_name)
      if (id && name && name.trim() !== '') titles.set(id, name)
    }
  } catch {
    // No index yet.
  }
  return titles
}

function textFrom(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content as { text?: unknown }[]) {
    if (typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('')
}

type Payload = Record<string, unknown> & { type?: unknown; item?: Record<string, unknown> }

function payloadOf(line: Record<string, unknown>): Payload | null {
  const payload = line.payload
  return typeof payload === 'object' && payload !== null ? (payload as Payload) : null
}

// Only messages the person typed: content_item_kinds marks injected context in newer rollouts.
function codexResponseUserText(payload: Payload): string | null {
  if (payload.type !== 'message' || payload.role !== 'user') return null
  const meta = payload.internal_chat_message_metadata_passthrough as { content_item_kinds?: unknown } | undefined
  if (Array.isArray(meta?.content_item_kinds) && !meta.content_item_kinds.every((kind) => kind === 'user.text')) return null
  const text = textFrom(payload.content).trim()
  if (text === '' || text.startsWith('<') || text.startsWith('# AGENTS.md')) return null
  return text
}

function codexUserText(line: Record<string, unknown>): string | null {
  const payload = payloadOf(line)
  if (!payload) return null
  if (line.type === 'event_msg' && payload.type === 'item_completed' && payload.item?.type === 'UserMessage') {
    const text = textFrom(payload.item.content).trim()
    return text === '' ? null : text
  }
  if (line.type === 'event_msg' && payload.type === 'user_message') {
    const text = str(payload.message)?.trim()
    return text ? text : null
  }
  if (line.type === 'response_item') return codexResponseUserText(payload)
  return null
}

function codexAssistantText(line: Record<string, unknown>): string | null {
  const payload = payloadOf(line)
  if (!payload) return null
  if (line.type === 'event_msg' && payload.type === 'item_completed' && payload.item?.type === 'AgentMessage') {
    return textFrom(payload.item.content) || null
  }
  if (line.type === 'event_msg' && payload.type === 'agent_message') return str(payload.message)
  if (line.type === 'response_item' && payload.type === 'message' && payload.role === 'assistant') return textFrom(payload.content) || null
  return null
}

async function readCodexSummary(entry: FileEntry, titles: Map<string, string>): Promise<OutsideSession | null> {
  let meta: Payload | null = null
  let firstPrompt: string | null = null
  let model: string | null = null
  let effort: string | null = null
  let skip = false
  await readHead(entry.file, (line) => {
    const payload = payloadOf(line)
    if (line.type === 'session_meta' && payload && !meta) {
      meta = payload
      // Subagent and approval-review threads have an object source; only top-level threads are listed.
      if (typeof payload.source !== 'string') {
        skip = true
        return true
      }
    }
    if (line.type === 'turn_context' && payload && !model) {
      model = str(payload.model)
      effort = str(payload.effort)
    }
    if (!firstPrompt) firstPrompt = codexUserText(line)
    return firstPrompt !== null && model !== null && meta !== null
  })
  const header = meta as Payload | null
  if (skip || !header) return null
  const sessionId = str(header.id)
  const cwd = str(header.cwd)
  if (!sessionId || !cwd) return null
  let lastMessage: string | null = null
  let lastTurnAt: string | null = null
  for (const line of await readTail(entry.file, entry.size)) {
    if (line.type === 'event_msg' && payloadOf(line)?.type === 'task_started') lastTurnAt = str(line.timestamp) ?? lastTurnAt
    const text = codexAssistantText(line)
    if (text && text.trim() !== '') lastMessage = text
    const payload = payloadOf(line)
    if (line.type === 'turn_context' && payload) {
      model = str(payload.model) ?? model
      effort = str(payload.effort) ?? effort
    }
  }
  const title = titles.get(sessionId) ?? firstPrompt
  if (!title) return null
  return {
    provider: 'codex',
    sessionId,
    file: entry.file,
    title: oneLine(title).slice(0, 120),
    cwd,
    gitBranch: str((header.git as { branch?: unknown } | undefined)?.branch),
    model,
    effort,
    createdAt: str(header.timestamp) ?? new Date(entry.mtimeMs).toISOString(),
    updatedAt: new Date(entry.mtimeMs).toISOString(),
    running: false,
    lastTurnAt,
    lastMessage: lastMessage ? oneLine(lastMessage).slice(0, 300) : null,
    costUsd: null
  }
}

export async function listCodexSessions(home: string, exclude: Set<string>, now = Date.now()): Promise<OutsideSession[]> {
  const entries: FileEntry[] = []
  for (const entry of await codexFiles(home, now)) {
    const id = codexIdFromName(basename(entry.file))
    if (id && exclude.has(id)) continue
    entries.push(entry)
  }
  const titles = await codexTitles(home)
  const sessions: OutsideSession[] = []
  for (const entry of recent(entries, now)) {
    if (sessions.length >= SESSION_CAP) break
    const session = await cachedSummary(entry, now, async (fresh) => {
      const summary = await readCodexSummary(fresh, titles)
      return summary && exclude.has(summary.sessionId) ? null : summary
    })
    if (session) sessions.push({ ...session, title: titles.get(session.sessionId) ?? session.title })
  }
  return sessions
}

function completeTool(tools: Map<string, ToolEvent>, id: string, output: string, ok: boolean): ToolEvent | null {
  const tool = tools.get(id)
  if (!tool) return null
  const done: ToolEvent = { ...tool, output: truncateOutput(output), status: ok ? 'ok' : 'error' }
  tools.set(id, done)
  return done
}

function itemEvent(item: Record<string, unknown>, at: string): AgentEvent | null {
  const id = str(item.id)
  if (!id) return null
  const type = item.type
  if (type === 'UserMessage') {
    const text = textFrom(item.content).trim()
    return text ? { kind: 'user', id, at, text } : null
  }
  if (type === 'AgentMessage') {
    const text = textFrom(item.content)
    return text.trim() ? { kind: 'assistant', id, at, text } : null
  }
  if (type === 'Reasoning') {
    const summary = Array.isArray(item.summary_text) ? item.summary_text.filter((part) => typeof part === 'string').join('\n') : ''
    return summary.trim() ? { kind: 'thinking', id, at, text: summary } : null
  }
  if (type === 'CommandExecution') {
    const command = Array.isArray(item.command) ? unwrapShell(item.command as string[]) : unwrapShell(str(item.command) ?? '')
    const output = str(item.aggregated_output) ?? str(item.formatted_output) ?? ''
    const ok = item.status === 'completed' && (item.exit_code === 0 || item.exit_code === undefined || item.exit_code === null)
    return { kind: 'tool', id, at, name: 'Bash', summary: oneLine(command), output: truncateOutput(output), status: ok ? 'ok' : 'error' }
  }
  if (type === 'FileChange') {
    const changes = typeof item.changes === 'object' && item.changes !== null ? Object.keys(item.changes) : []
    return { kind: 'tool', id, at, name: 'Edit', summary: oneLine(changes.join(', ')), output: null, status: item.status === 'failed' ? 'error' : 'ok' }
  }
  if (type === 'McpToolCall') {
    const name = `${str(item.server) ?? 'mcp'}.${str(item.tool) ?? 'tool'}`
    return {
      kind: 'tool',
      id,
      at,
      name,
      summary: toolSummary(item.arguments),
      output: truncateOutput(mcpResultText(item.result)),
      status: item.status === 'completed' ? 'ok' : 'error'
    }
  }
  if (type === 'Extension' && item.kind === 'web.search') {
    return { kind: 'tool', id, at, name: 'WebSearch', summary: oneLine(str(item.query) ?? ''), output: null, status: 'ok' }
  }
  if (type === 'ImageView') {
    return { kind: 'tool', id, at, name: 'ViewImage', summary: oneLine((str(item.path) ?? '').replace(/^file:\/\//, '')), output: null, status: 'ok' }
  }
  return null
}

function functionOutputText(output: unknown): string {
  if (typeof output === 'string') return output
  if (Array.isArray(output)) return textFrom(output)
  const content = (output as { content?: unknown } | null)?.content
  if (typeof content === 'string') return content
  return textFrom(content)
}

function parseArguments(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

// Newer rollouts log every item as event_msg item_completed; older ones only have response_items and
// event_msg user_message / agent_message. The two are read separately so nothing appears twice.
export function codexTranscriptEvents(lines: Record<string, unknown>[]): AgentEvent[] {
  const events: AgentEvent[] = []
  let itemized = false
  for (const line of lines) {
    if (line.type === 'event_msg' && payloadOf(line)?.type === 'item_completed') {
      itemized = true
      break
    }
  }
  const tools = new Map<string, ToolEvent>()
  const turnTokens = new Map<string, { input: number | null; output: number | null }>()
  for (const line of lines) {
    const payload = payloadOf(line)
    if (!payload) continue
    const at = str(line.timestamp) ?? new Date().toISOString()
    if (line.type === 'token_usage_record') {
      const usage = payload.turn_token_usage as { input_tokens?: unknown; output_tokens?: unknown } | undefined
      const turnId = str(payload.turn_id)
      if (turnId && usage) {
        turnTokens.set(turnId, {
          input: typeof usage.input_tokens === 'number' ? usage.input_tokens : null,
          output: typeof usage.output_tokens === 'number' ? usage.output_tokens : null
        })
      }
      continue
    }
    if (line.type === 'event_msg' && payload.type === 'task_complete') {
      const turnId = str(payload.turn_id) ?? at
      const tokens = turnTokens.get(turnId)
      events.push({
        kind: 'turn',
        id: `turn:${turnId}`,
        at,
        durationMs: typeof payload.duration_ms === 'number' ? payload.duration_ms : null,
        costUsd: null,
        inputTokens: tokens?.input ?? null,
        outputTokens: tokens?.output ?? null
      })
      continue
    }
    if (line.type === 'event_msg' && payload.type === 'turn_aborted') {
      events.push({ kind: 'error', id: `aborted:${str(payload.turn_id) ?? at}`, at, text: 'Turn interrupted' })
      continue
    }
    if (line.type === 'event_msg' && payload.type === 'error') {
      const text = str(payload.message)
      if (text && !isConfigWarning(text)) events.push({ kind: 'error', id: `error:${at}`, at, text })
      continue
    }
    if (itemized) {
      if (line.type === 'event_msg' && payload.type === 'item_completed' && payload.item) {
        const event = itemEvent(payload.item, at)
        if (event) events.push(event)
      }
      continue
    }
    if (line.type === 'event_msg' && payload.type === 'user_message') {
      const text = str(payload.message)?.trim()
      if (text) events.push({ kind: 'user', id: `user:${at}:${events.length}`, at, text })
    } else if (line.type === 'event_msg' && payload.type === 'agent_message') {
      const text = str(payload.message)
      if (text && text.trim()) events.push({ kind: 'assistant', id: `assistant:${at}:${events.length}`, at, text })
    } else if (line.type === 'event_msg' && payload.type === 'agent_reasoning') {
      const text = str(payload.text)
      if (text && text.trim()) events.push({ kind: 'thinking', id: `thinking:${at}:${events.length}`, at, text })
    } else if (line.type === 'response_item' && (payload.type === 'function_call' || payload.type === 'custom_tool_call')) {
      const callId = str(payload.call_id)
      if (!callId) continue
      const input = payload.type === 'function_call' ? parseArguments(payload.arguments) : payload.input
      const tool: ToolEvent = { kind: 'tool', id: callId, at, name: str(payload.name) ?? 'tool', summary: toolSummary(input), output: null, status: 'running' }
      tools.set(callId, tool)
      events.push(tool)
    } else if (line.type === 'response_item' && (payload.type === 'function_call_output' || payload.type === 'custom_tool_call_output')) {
      const callId = str(payload.call_id)
      const done = callId ? completeTool(tools, callId, functionOutputText(payload.output), true) : null
      if (done) events.push(done)
    }
  }
  return collapse(events)
}

export async function readCodexTranscript(file: string): Promise<AgentEvent[]> {
  return codexTranscriptEvents(await readLines(file))
}

export function codexUsageFrom(payload: Record<string, unknown>): UsageWindow[] | null {
  const limits = payload.rate_limits as Record<string, { used_percent?: unknown; window_minutes?: unknown; resets_at?: unknown } | null> | undefined
  if (!limits || typeof limits !== 'object') return null
  const windows: UsageWindow[] = []
  for (const key of ['primary', 'secondary']) {
    const limit = limits[key]
    if (!limit || typeof limit.window_minutes !== 'number') continue
    const window = usageWindow(windowLabel(limit.window_minutes), limit.used_percent, limit.resets_at)
    if (window) windows.push(window)
  }
  return windows.length > 0 ? windows : null
}

// The newest rate_limits any Codex session logged.
export async function latestCodexUsage(home: string, now = Date.now()): Promise<UsageWindow[]> {
  const entries = await codexFiles(home, now)
  entries.sort((a, b) => b.mtimeMs - a.mtimeMs)
  for (const entry of entries.slice(0, 8)) {
    let lines: Record<string, unknown>[]
    try {
      lines = await readTail(entry.file, entry.size)
    } catch {
      continue
    }
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]!
      const payload = payloadOf(line)
      if (line.type !== 'event_msg' || payload?.type !== 'token_count') continue
      const usage = codexUsageFrom(payload)
      if (usage) return usage
    }
  }
  return []
}

// One entry per id at its first position, holding the latest version.
export function collapse(events: AgentEvent[]): AgentEvent[] {
  const index = new Map<string, number>()
  const out: AgentEvent[] = []
  for (const event of events) {
    const at = index.get(event.id)
    if (at === undefined) {
      index.set(event.id, out.length)
      out.push(event)
    } else out[at] = event
  }
  return out.length > TRANSCRIPT_EVENT_CAP ? out.slice(out.length - TRANSCRIPT_EVENT_CAP) : out
}

export function clearSessionCache(): void {
  summaryCache.clear()
}
