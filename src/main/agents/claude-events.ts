import type { AgentEvent, UsageWindow } from '@shared/agents'
import { oneLine, toolSummary, truncateOutput, usageWindow, type ToolEvent } from './events'

export type ClaudeParseState = {
  // Transcripts on disk carry the user's prompts; prot records its own prompts for a live stream.
  userPrompts: boolean
  seen: Set<string>
  blockCount: Map<string, number>
  tools: Map<string, ToolEvent>
}

export function newClaudeState(userPrompts = false): ClaudeParseState {
  return { userPrompts, seen: new Set(), blockCount: new Map(), tools: new Map() }
}

export type ClaudeTurnResult = { isError: boolean; costUsd: number | null }

export type ClaudeLine = {
  events: AgentEvent[]
  sessionId: string | null
  model: string | null
  usage: UsageWindow[] | null
  result: ClaudeTurnResult | null
}

type Block = {
  type?: unknown
  id?: unknown
  text?: unknown
  thinking?: unknown
  name?: unknown
  input?: unknown
  tool_use_id?: unknown
  content?: unknown
  is_error?: unknown
}

type Line = {
  type?: unknown
  subtype?: unknown
  uuid?: unknown
  timestamp?: unknown
  session_id?: unknown
  model?: unknown
  isMeta?: unknown
  isSidechain?: unknown
  isCompactSummary?: unknown
  origin?: unknown
  message?: { id?: unknown; model?: unknown; content?: unknown }
  rate_limit_info?: { unifiedWindows?: unknown; rateLimitType?: unknown; utilization?: unknown; resetsAt?: unknown }
  duration_ms?: unknown
  total_cost_usd?: unknown
  is_error?: unknown
  result?: unknown
  errors?: unknown
  usage?: { input_tokens?: unknown; output_tokens?: unknown; cache_creation_input_tokens?: unknown; cache_read_input_tokens?: unknown }
}

const WINDOW_LABELS: Record<string, string> = {
  five_hour: '5 hour',
  seven_day: '7 day',
  seven_day_opus: '7 day Opus',
  seven_day_sonnet: '7 day Sonnet'
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function emptyLine(): ClaudeLine {
  return { events: [], sessionId: null, model: null, usage: null, result: null }
}

export function claudeUsage(info: Line['rate_limit_info']): UsageWindow[] | null {
  if (!info) return null
  const windows: UsageWindow[] = []
  const unified = info.unifiedWindows
  if (typeof unified === 'object' && unified !== null) {
    for (const [key, value] of Object.entries(unified as Record<string, { utilization?: unknown; resetsAt?: unknown }>)) {
      const utilization = num(value?.utilization)
      if (utilization === null) continue
      const window = usageWindow(WINDOW_LABELS[key] ?? key.replace(/_/g, ' '), utilization * 100, value.resetsAt)
      if (window) windows.push(window)
    }
  } else if (typeof info.rateLimitType === 'string' && num(info.utilization) !== null) {
    const window = usageWindow(WINDOW_LABELS[info.rateLimitType] ?? info.rateLimitType, (info.utilization as number) * 100, info.resetsAt)
    if (window) windows.push(window)
  }
  return windows.length > 0 ? windows : null
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content as Block[]) {
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
    else if (block.type === 'image') parts.push('[image]')
  }
  return parts.join('\n')
}

const COMMAND_NAME = /<command-name>([^<]*)<\/command-name>/
const COMMAND_ARGS = /<command-args>([^<]*)<\/command-args>/

function promptText(content: unknown): string {
  let text = ''
  if (typeof content === 'string') text = content
  else if (Array.isArray(content)) {
    const parts: string[] = []
    for (const block of content as Block[]) {
      if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
      else if (block.type === 'image') parts.push('[image]')
    }
    text = parts.join('\n')
  }
  const command = COMMAND_NAME.exec(text)
  if (command && command[1] !== undefined) {
    const args = COMMAND_ARGS.exec(text)?.[1]?.trim()
    return args ? `${command[1]} ${args}` : command[1]
  }
  return text.trim()
}

// A prompt the person typed, not a tool result, skill body, hook output or other injected user line.
export function isRealPrompt(line: Line): boolean {
  if (line.type !== 'user' || line.isMeta === true || line.isSidechain === true || line.isCompactSummary === true) return false
  const content = line.message?.content
  if (Array.isArray(content)) {
    for (const block of content as Block[]) {
      if (block.type === 'tool_result') return false
    }
  }
  if (typeof line.origin === 'object' && line.origin !== null) {
    return (line.origin as { kind?: unknown }).kind === 'human'
  }
  const text = typeof content === 'string' ? content.trim() : promptText(content)
  if (text === '') return false
  if (text.startsWith('<') && !text.startsWith('<command-')) return false
  if (text.startsWith('[Request interrupted')) return false
  if (text.startsWith('This session is being continued from a previous conversation')) return false
  return true
}

export function claudePromptText(line: unknown): string | null {
  const value = line as Line
  if (!isRealPrompt(value)) return null
  const text = promptText(value.message?.content)
  return text === '' ? null : text
}

function blockId(state: ClaudeParseState, messageId: string): string {
  const index = state.blockCount.get(messageId) ?? 0
  state.blockCount.set(messageId, index + 1)
  return `${messageId}:${index}`
}

function assistantEvents(line: Line, state: ClaudeParseState, at: string): AgentEvent[] {
  const events: AgentEvent[] = []
  const content = line.message?.content
  if (!Array.isArray(content)) return events
  const messageId = str(line.message?.id) ?? str(line.uuid) ?? at
  for (const block of content as Block[]) {
    if (block.type === 'text' || block.type === 'thinking') {
      const text = block.type === 'text' ? str(block.text) : str(block.thinking)
      if (!text || text.trim() === '') continue
      // stream-json repeats a message id once per content block; a block seen before is skipped.
      const key = `${messageId}|${block.type}|${text}`
      if (state.seen.has(key)) continue
      state.seen.add(key)
      events.push({ kind: block.type === 'text' ? 'assistant' : 'thinking', id: blockId(state, messageId), at, text })
    } else if (block.type === 'tool_use') {
      const id = str(block.id)
      if (!id || state.tools.has(id)) continue
      const tool: ToolEvent = {
        kind: 'tool',
        id,
        at,
        name: str(block.name) ?? 'tool',
        summary: toolSummary(block.input),
        output: null,
        status: 'running'
      }
      state.tools.set(id, tool)
      events.push(tool)
    }
  }
  return events
}

function userEvents(line: Line, state: ClaudeParseState, at: string): AgentEvent[] {
  const events: AgentEvent[] = []
  const content = line.message?.content
  if (Array.isArray(content)) {
    for (const block of content as Block[]) {
      if (block.type !== 'tool_result') continue
      const id = str(block.tool_use_id)
      const tool = id ? state.tools.get(id) : undefined
      if (!id || !tool || tool.status !== 'running') continue
      const done: ToolEvent = {
        ...tool,
        output: truncateOutput(resultText(block.content)),
        status: block.is_error === true ? 'error' : 'ok'
      }
      state.tools.set(id, done)
      events.push(done)
    }
  }
  if (state.userPrompts) {
    const text = claudePromptText(line)
    if (text) events.push({ kind: 'user', id: str(line.uuid) ?? `user:${at}`, at, text })
  }
  return events
}

function resultEvents(line: Line, at: string): { events: AgentEvent[]; result: ClaudeTurnResult } {
  const usage = line.usage ?? {}
  const input = num(usage.input_tokens)
  let inputTokens: number | null = null
  if (input !== null) inputTokens = input + (num(usage.cache_creation_input_tokens) ?? 0) + (num(usage.cache_read_input_tokens) ?? 0)
  const id = str(line.uuid) ?? `result:${at}`
  const costUsd = num(line.total_cost_usd)
  const events: AgentEvent[] = []
  const isError = line.is_error === true || (typeof line.subtype === 'string' && line.subtype !== 'success')
  if (isError) {
    let text = str(line.result) ?? ''
    if (text === '' && Array.isArray(line.errors)) text = line.errors.filter((error) => typeof error === 'string').join('\n')
    if (text === '') text = `Claude stopped: ${String(line.subtype ?? 'error')}`
    events.push({ kind: 'error', id: `${id}:error`, at, text })
  }
  events.push({
    kind: 'turn',
    id,
    at,
    durationMs: num(line.duration_ms),
    costUsd,
    inputTokens,
    outputTokens: num(usage.output_tokens)
  })
  return { events, result: { isError, costUsd } }
}

// Maps one stream-json or transcript line. Tool events come back again, same id, when their result arrives.
export function parseClaudeLine(raw: unknown, state: ClaudeParseState, now: string): ClaudeLine {
  const out = emptyLine()
  if (typeof raw !== 'object' || raw === null) return out
  const line = raw as Line
  if (line.isSidechain === true) return out
  const at = str(line.timestamp) ?? now
  if (line.type === 'system' && line.subtype === 'init') {
    out.sessionId = str(line.session_id)
    out.model = str(line.model)
  } else if (line.type === 'assistant') {
    out.events = assistantEvents(line, state, at)
    out.model = str(line.message?.model)
  } else if (line.type === 'user') {
    out.events = userEvents(line, state, at)
  } else if (line.type === 'rate_limit_event') {
    out.usage = claudeUsage(line.rate_limit_info)
  } else if (line.type === 'result') {
    const { events, result } = resultEvents(line, at)
    out.events = events
    out.result = result
    out.sessionId = str(line.session_id)
  }
  return out
}

export function claudeTitleText(text: string): string {
  return oneLine(text).slice(0, 120)
}
