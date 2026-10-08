import type { AgentEvent } from '@shared/agents'
import { oneLine, toolSummary, truncateOutput, unwrapShell, type ToolEvent } from './events'

export type CodexParseState = {
  // codex exec numbers items from item_0 in every process, so ids get a per-turn prefix.
  prefix: string
  turnStartedAt: number | null
  tools: Map<string, ToolEvent>
}

export function newCodexState(prefix: string): CodexParseState {
  return { prefix, turnStartedAt: null, tools: new Map() }
}

export type CodexLine = {
  events: AgentEvent[]
  threadId: string | null
  // turn.completed or turn.failed was seen.
  ended: boolean
  failed: boolean
}

type Item = {
  id?: unknown
  type?: unknown
  text?: unknown
  message?: unknown
  command?: unknown
  aggregated_output?: unknown
  exit_code?: unknown
  status?: unknown
  changes?: unknown
  server?: unknown
  tool?: unknown
  arguments?: unknown
  result?: unknown
  error?: unknown
  query?: unknown
}

type Line = {
  type?: unknown
  thread_id?: unknown
  item?: Item
  usage?: { input_tokens?: unknown; output_tokens?: unknown }
  error?: { message?: unknown }
  message?: unknown
}

const TOOL_TYPES = new Set(['command_execution', 'file_change', 'mcp_tool_call', 'web_search'])

// Config warnings ("Codex is ignoring 1 unrecognized configuration setting") are not the agent's errors.
export function isConfigWarning(message: string): boolean {
  return /unrecognized configuration|config\.toml/i.test(message)
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function mcpResultText(result: unknown): string {
  const content = (result as { content?: unknown } | null)?.content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content as { type?: unknown; text?: unknown }[]) {
    if (typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n')
}

function fileChangeSummary(changes: unknown): string {
  if (!Array.isArray(changes)) return ''
  const paths: string[] = []
  for (const change of changes as { path?: unknown }[]) {
    if (typeof change.path === 'string') paths.push(change.path)
  }
  return oneLine(paths.join(', '))
}

function toolFor(item: Item, id: string, at: string, previous: ToolEvent | undefined): ToolEvent {
  const status = str(item.status)
  let name = 'tool'
  let summary = ''
  let output: string | null = null
  let state: ToolEvent['status'] = 'running'
  const done = status !== null && status !== 'in_progress'
  if (item.type === 'command_execution') {
    name = 'Bash'
    summary = oneLine(unwrapShell(str(item.command) ?? ''))
    const text = str(item.aggregated_output)
    output = text ? truncateOutput(text) : null
    const exit = num(item.exit_code)
    if (done) state = status === 'completed' && (exit === null || exit === 0) ? 'ok' : 'error'
  } else if (item.type === 'file_change') {
    name = 'Edit'
    summary = fileChangeSummary(item.changes)
    if (done) state = status === 'completed' ? 'ok' : 'error'
  } else if (item.type === 'mcp_tool_call') {
    name = `${str(item.server) ?? 'mcp'}.${str(item.tool) ?? 'tool'}`
    summary = toolSummary(item.arguments)
    const error = str((item.error as { message?: unknown } | null)?.message)
    const text = error ?? mcpResultText(item.result)
    output = text ? truncateOutput(text) : null
    if (done) state = status === 'completed' && !error ? 'ok' : 'error'
  } else if (item.type === 'web_search') {
    name = 'WebSearch'
    summary = oneLine(str(item.query) ?? '')
    // web_search items have no status; completion is the item.completed line.
    state = previous || status ? 'ok' : 'running'
  }
  return { kind: 'tool', id, at: previous?.at ?? at, name, summary, output, status: state }
}

// Maps one `codex exec --json` line. Tool events come back again, same id, when the item completes.
export function parseCodexLine(raw: unknown, state: CodexParseState, now: string): CodexLine {
  const out: CodexLine = { events: [], threadId: null, ended: false, failed: false }
  if (typeof raw !== 'object' || raw === null) return out
  const line = raw as Line
  const type = line.type
  if (type === 'thread.started') {
    out.threadId = str(line.thread_id)
  } else if (type === 'turn.started') {
    state.turnStartedAt = Date.parse(now)
  } else if (type === 'item.started' || type === 'item.updated' || type === 'item.completed') {
    const item = line.item
    const itemId = str(item?.id)
    if (!item || !itemId) return out
    const id = `${state.prefix}:${itemId}`
    const completed = type === 'item.completed'
    if (item.type === 'agent_message' && completed) {
      const text = str(item.text)
      if (text && text.trim() !== '') out.events.push({ kind: 'assistant', id, at: now, text })
    } else if (item.type === 'reasoning' && completed) {
      const text = str(item.text)
      if (text && text.trim() !== '') out.events.push({ kind: 'thinking', id, at: now, text })
    } else if (item.type === 'error') {
      const text = str(item.message)
      if (text && !isConfigWarning(text)) out.events.push({ kind: 'error', id, at: now, text })
    } else if (typeof item.type === 'string' && TOOL_TYPES.has(item.type)) {
      const tool = toolFor(item, id, now, state.tools.get(id))
      if (completed && tool.status === 'running') tool.status = 'ok'
      state.tools.set(id, tool)
      out.events.push(tool)
    }
  } else if (type === 'turn.completed') {
    out.ended = true
    const started = state.turnStartedAt
    out.events.push({
      kind: 'turn',
      id: `${state.prefix}:turn`,
      at: now,
      durationMs: started === null ? null : Math.max(0, Date.parse(now) - started),
      costUsd: null,
      inputTokens: num(line.usage?.input_tokens),
      outputTokens: num(line.usage?.output_tokens)
    })
  } else if (type === 'turn.failed') {
    out.ended = true
    out.failed = true
    const text = str(line.error?.message) ?? 'The turn failed'
    out.events.push({ kind: 'error', id: `${state.prefix}:failed`, at: now, text })
  } else if (type === 'error') {
    const text = str(line.message)
    if (text && !isConfigWarning(text)) out.events.push({ kind: 'error', id: `${state.prefix}:error:${now}`, at: now, text })
  }
  return out
}
