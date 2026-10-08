import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '@shared/agents'
import { newCodexState, parseCodexLine } from './codex-events'

const FIXTURE = resolve(import.meta.dirname, '../../../tests/fixtures/agents/codex-stream.jsonl')

const lines = readFileSync(FIXTURE, 'utf8')
  .split('\n')
  .filter((line) => line !== '')
  .map((line) => JSON.parse(line) as unknown)

describe('parseCodexLine on a real exec --json turn', () => {
  it('drops config warnings and pairs the command start and completion', () => {
    const state = newCodexState('t1')
    const events: AgentEvent[] = []
    let threadId: string | null = null
    let ended = false
    const times = ['2026-10-08T04:46:17.000Z', '2026-10-08T04:46:17.100Z', '2026-10-08T04:46:17.200Z', '2026-10-08T04:46:17.300Z']
    for (const [index, line] of lines.entries()) {
      const out = parseCodexLine(line, state, times[Math.min(index, 3)] ?? times[3]!)
      events.push(...out.events)
      threadId = out.threadId ?? threadId
      ended = ended || out.ended
    }
    expect(threadId).toBe('01a119d5-62bb-7f83-8422-0e99cfb0098f')
    expect(ended).toBe(true)
    expect(events).toEqual([
      { kind: 'tool', id: 't1:item_2', at: times[3], name: 'Bash', summary: 'cat a.txt', output: null, status: 'running' },
      { kind: 'tool', id: 't1:item_2', at: times[3], name: 'Bash', summary: 'cat a.txt', output: 'hello\n', status: 'ok' },
      { kind: 'assistant', id: 't1:item_3', at: times[3], text: 'hello' },
      { kind: 'turn', id: 't1:turn', at: times[3], durationMs: 0, costUsd: null, inputTokens: 30808, outputTokens: 40 }
    ])
  })

  it('times the turn from turn.started', () => {
    const state = newCodexState('t2')
    parseCodexLine({ type: 'turn.started' }, state, '2026-10-08T00:00:00.000Z')
    const out = parseCodexLine({ type: 'turn.completed', usage: {} }, state, '2026-10-08T00:00:02.500Z')
    expect(out.events[0]).toMatchObject({ durationMs: 2500, inputTokens: null })
  })

  it('maps a failed turn, a failed command, file changes, MCP calls and searches', () => {
    const state = newCodexState('t3')
    const at = '2026-10-08T00:00:00.000Z'
    const items = [
      { type: 'item.completed', item: { id: 'a', type: 'command_execution', command: 'bash -lc "false"', aggregated_output: '', exit_code: 1, status: 'failed' } },
      { type: 'item.completed', item: { id: 'b', type: 'file_change', changes: [{ path: 'src/a.ts', kind: 'update' }, { path: 'b.md', kind: 'add' }], status: 'completed' } },
      { type: 'item.completed', item: { id: 'c', type: 'mcp_tool_call', server: 'docs', tool: 'search', arguments: { query: 'auth' }, result: { content: [{ type: 'text', text: 'found' }] }, status: 'completed' } },
      { type: 'item.completed', item: { id: 'd', type: 'web_search', query: 'codex exec json' } },
      { type: 'item.completed', item: { id: 'e', type: 'reasoning', text: '**Planning**' } },
      { type: 'turn.failed', error: { message: 'stream disconnected' } }
    ]
    const events: AgentEvent[] = []
    let failed = false
    for (const line of items) {
      const out = parseCodexLine(line, state, at)
      events.push(...out.events)
      failed = failed || out.failed
    }
    expect(failed).toBe(true)
    expect(events.map((event) => (event.kind === 'tool' ? [event.name, event.summary, event.status, event.output] : [event.kind, 'text' in event ? event.text : '']))).toEqual([
      ['Bash', 'false', 'error', null],
      ['Edit', 'src/a.ts, b.md', 'ok', null],
      ['docs.search', 'auth', 'ok', 'found'],
      ['WebSearch', 'codex exec json', 'ok', null],
      ['thinking', '**Planning**'],
      ['error', 'stream disconnected']
    ])
  })
})
