import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AgentEvent, UsageWindow } from '@shared/agents'
import { newClaudeState, parseClaudeLine, type ClaudeTurnResult } from './claude-events'
import { collapse } from './sessions'

const FIXTURE = resolve(import.meta.dirname, '../../../tests/fixtures/agents/claude-stream.jsonl')
const NOW = '2026-10-08T04:46:20.000Z'

function run(lines: unknown[]) {
  const state = newClaudeState()
  const events: AgentEvent[] = []
  let sessionId: string | null = null
  let usage: UsageWindow[] | null = null
  let result: ClaudeTurnResult | null = null
  for (const line of lines) {
    const out = parseClaudeLine(line, state, NOW)
    events.push(...out.events)
    sessionId = out.sessionId ?? sessionId
    usage = out.usage ?? usage
    result = out.result ?? result
  }
  return { events, sessionId, usage, result }
}

const lines = readFileSync(FIXTURE, 'utf8')
  .split('\n')
  .filter((line) => line !== '')
  .map((line) => JSON.parse(line) as unknown)

describe('parseClaudeLine on a real stream-json turn', () => {
  it('maps text, the tool call and its result, the turn and the usage windows', () => {
    const { events, sessionId, usage, result } = run(lines)
    expect(sessionId).toBe('862074e2-d25c-4095-9ad8-f82ad55fafdf')
    expect(result).toEqual({ isError: false, costUsd: 0.20924500000000001 })
    expect(usage).toEqual([
      { label: '5 hour', usedPercent: 16, resetsAt: 1791444000 },
      { label: '7 day', usedPercent: 53, resetsAt: 1791813600 }
    ])
    expect(collapse(events).map((event) => [event.kind, event.id])).toEqual([
      ['assistant', 'msg_011CfpANS3pmHK1CryRzq7cJ:0'],
      ['tool', 'toolu_01TybZq2ZeeeGRa1UuAXRXMP'],
      ['assistant', 'msg_011CfpANb4JTqza7gg9myK2A:0'],
      ['turn', '8798e90e-1a82-4952-a045-d27c41c27e04']
    ])
    const tools = events.filter((event) => event.kind === 'tool')
    expect(tools).toEqual([
      expect.objectContaining({ name: 'Read', summary: '/tmp/probe/a.txt', status: 'running', output: null, at: '2026-10-08T04:46:14.939Z' }),
      expect.objectContaining({ name: 'Read', status: 'ok', output: '1\thello\n2\t', at: '2026-10-08T04:46:14.939Z' })
    ])
    expect(events.at(-1)).toEqual({
      kind: 'turn',
      id: '8798e90e-1a82-4952-a045-d27c41c27e04',
      at: NOW,
      durationMs: 4547,
      costUsd: 0.20924500000000001,
      inputTokens: 4 + 49771 + 42915,
      outputTokens: 157
    })
  })

  it('adds nothing when a line or a content block repeats', () => {
    const doubled: unknown[] = []
    for (const line of lines) doubled.push(line, line)
    const once = run(lines).events
    const twice = run(doubled).events
    expect(twice.filter((event) => event.kind !== 'turn')).toEqual(once.filter((event) => event.kind !== 'turn'))
  })

  it('reports an error result as a failed turn', () => {
    const { events, result } = run([{ type: 'result', subtype: 'error_max_turns', is_error: true, uuid: 'r1', duration_ms: 5 }])
    expect(result).toEqual({ isError: true, costUsd: null })
    expect(events.map((event) => event.kind)).toEqual(['error', 'turn'])
    expect(events[0]).toMatchObject({ text: 'Claude stopped: error_max_turns' })
  })

  it('truncates long tool output', () => {
    const tool = { type: 'assistant', message: { id: 'm', content: [{ type: 'tool_use', id: 't', name: 'Bash', input: { command: 'yes\n| head' } }] } }
    const output = { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't', content: 'y'.repeat(10_000), is_error: true }] } }
    const { events } = run([tool, output])
    expect(events[0]).toMatchObject({ summary: 'yes | head' })
    expect(events[1]).toMatchObject({ status: 'error' })
    expect((events[1] as { output: string }).output.length).toBeLessThan(4200)
  })
})
