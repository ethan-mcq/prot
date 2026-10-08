import { describe, expect, it } from 'vitest'
import type { AgentEvent, AgentsState, AgentSummary, ProviderInfo } from '@shared/agents'
import {
  groupTranscript,
  runLabel,
  type ToolEvent,
  agentSection,
  chooseModel,
  formatCost,
  formatDuration,
  formatReset,
  formatTokens,
  parseChoice,
  resolveChoice,
  runningFor,
  sectionAgents,
  upsertEvent,
  withAgent,
  withoutAgent
} from './agents'

function agent(patch: Partial<AgentSummary>): AgentSummary {
  return {
    id: 'a',
    source: 'prot',
    provider: 'claude',
    title: 'Fix it',
    repoPath: '/r',
    repoName: 'r',
    cwd: '/r',
    branch: 'main',
    worktree: null,
    model: 'opus',
    effort: 'high',
    permission: 'auto',
    sessionId: null,
    status: 'idle',
    unread: false,
    createdAt: '2026-10-07T10:00:00Z',
    updatedAt: '2026-10-07T10:00:00Z',
    lastMessage: null,
    pr: null,
    changes: null,
    costUsd: null,
    turnStartedAt: null,
    ...patch
  }
}

function provider(patch: Partial<ProviderInfo>): ProviderInfo {
  return {
    provider: 'claude',
    installed: true,
    binary: '/bin/claude',
    version: '2.0.0',
    signedIn: true,
    account: 'claude.ai',
    models: [
      { id: 'opus', label: 'Opus 5.5', efforts: ['low', 'high', 'max'], defaultEffort: 'high' },
      { id: 'haiku', label: 'Haiku 5.5', efforts: [], defaultEffort: '' }
    ],
    defaultModel: 'opus',
    defaultEffort: 'max',
    permissions: [
      { id: 'auto', label: 'Auto', hint: '' },
      { id: 'plan', label: 'Plan', hint: '' }
    ],
    defaultPermission: 'auto',
    usage: [],
    ...patch
  }
}

const codex = provider({
  provider: 'codex',
  models: [{ id: 'gpt', label: 'GPT', efforts: ['low', 'medium'], defaultEffort: 'medium' }],
  defaultModel: 'gpt',
  defaultEffort: 'low',
  permissions: [{ id: 'auto', label: 'Auto', hint: '' }, { id: 'read-only', label: 'Read only', hint: '' }],
  defaultPermission: 'auto'
})

describe('sectionAgents', () => {
  it('puts running first, then failed or unread idle, then prot agents and outside sessions by app', () => {
    expect(agentSection(agent({ status: 'running', source: 'claude-app' }))).toBe('working')
    expect(agentSection(agent({ status: 'failed' }))).toBe('needs')
    expect(agentSection(agent({ status: 'idle', unread: true }))).toBe('needs')
    expect(agentSection(agent({ status: 'stopped', unread: true }))).toBe('prot')
    expect(agentSection(agent({ status: 'idle' }))).toBe('prot')
    expect(agentSection(agent({ source: 'claude-app' }))).toBe('claude-app')
    expect(agentSection(agent({ source: 'codex-app', provider: 'codex' }))).toBe('codex-app')
  })

  it('sorts newest first and counts filtered-out agents in the total', () => {
    const sections = sectionAgents(
      [
        agent({ id: 'old', updatedAt: '2026-10-07T09:00:00Z' }),
        agent({ id: 'new', updatedAt: '2026-10-07T11:00:00Z' }),
        agent({ id: 'cx', provider: 'codex' })
      ],
      ['codex']
    )
    expect(sections.prot.agents.map((a) => a.id)).toEqual(['new', 'old'])
    expect(sections.prot.total).toBe(3)
    expect(sections.working.total).toBe(0)
  })
})

describe('dash state', () => {
  const base: AgentsState = { agents: [agent({})], repos: [], providers: [] }

  it('adds unknown agents, replaces known ones and removes archived ones', () => {
    const next = withAgent(base, agent({ id: 'b' }))
    expect(next.agents.map((a) => a.id)).toEqual(['a', 'b'])
    expect(withAgent(next, agent({ title: 'New' })).agents[0]?.title).toBe('New')
    expect(withoutAgent(next, 'a').agents.map((a) => a.id)).toEqual(['b'])
  })

  it('times the turn from turnStartedAt, else says when the agent last changed', () => {
    const now = Date.parse('2026-10-07T10:02:13Z')
    expect(runningFor(agent({ turnStartedAt: '2026-10-07T10:00:00Z' }), now)).toBe('2m 13s')
    expect(runningFor(agent({ updatedAt: '2026-10-07T09:55:00Z' }), now)).toBe('7m ago')
  })

  it('upserts transcript events by id', () => {
    const tool: AgentEvent = { kind: 'tool', id: 't', at: '', name: 'Bash', summary: 'ls', output: null, status: 'running' }
    const done: AgentEvent = { ...tool, output: 'a', status: 'ok' }
    const text: AgentEvent = { kind: 'assistant', id: 'x', at: '', text: 'hi' }
    expect(upsertEvent(upsertEvent([tool], text), done)).toEqual([done, text])
  })
})

describe('formatting', () => {
  it('formats durations', () => {
    expect(formatDuration(400)).toBe('0s')
    expect(formatDuration(45_000)).toBe('45s')
    expect(formatDuration(133_000)).toBe('2m 13s')
    expect(formatDuration(3_840_000)).toBe('1h 04m')
    expect(formatDuration(97_200_000)).toBe('1d 3h')
  })

  it('formats usage resets given in epoch seconds', () => {
    const now = Date.parse('2026-10-07T10:00:00Z')
    const at = (ms: number) => (now + ms) / 1000
    expect(formatReset(null, now)).toBeNull()
    expect(formatReset(at(-1000), now)).toBe('resets now')
    expect(formatReset(at(42 * 60000), now)).toBe('resets in 42m')
    expect(formatReset(at(3 * 3600000 + 5 * 60000), now)).toBe('resets in 3h 05m')
    expect(formatReset(at(52 * 3600000), now)).toBe('resets in 2d 4h')
  })

  it('formats tokens and cost', () => {
    expect(formatTokens(812)).toBe('812')
    expect(formatTokens(1234)).toBe('1.2k')
    expect(formatTokens(48_900)).toBe('49k')
    expect(formatTokens(2_300_000)).toBe('2.3M')
    expect(formatCost(0.004)).toBe('<$0.01')
    expect(formatCost(1.5)).toBe('$1.50')
  })
})

describe('composer choice', () => {
  it('uses the provider default model and effort', () => {
    expect(chooseModel(provider({}), undefined, undefined)).toEqual({ model: 'opus', effort: 'max' })
    expect(chooseModel(provider({}), 'haiku', 'high')).toEqual({ model: 'haiku', effort: '' })
    expect(chooseModel(provider({}), 'opus', 'low')).toEqual({ model: 'opus', effort: 'low' })
    expect(chooseModel(provider({}), 'gone', undefined)).toEqual({ model: 'opus', effort: 'max' })
  })

  it('keeps a stored choice that is still valid', () => {
    const choice = resolveChoice([provider({}), codex], [{ path: '/r', name: 'r', branch: null }], {
      provider: 'codex',
      model: 'gpt',
      effort: 'low',
      permission: 'read-only',
      worktree: false,
      repoPath: '/r'
    })
    expect(choice).toEqual({ provider: 'codex', model: 'gpt', effort: 'low', permission: 'read-only', worktree: false, repoPath: '/r' })
  })

  it('falls back to a signed-in provider and drops what no longer applies', () => {
    const choice = resolveChoice([provider({}), { ...codex, signedIn: false }], [{ path: '/x', name: 'x', branch: null }], {
      provider: 'codex',
      model: 'gpt',
      permission: 'read-only',
      repoPath: '/gone'
    })
    expect(choice).toEqual({ provider: 'claude', model: 'opus', effort: 'max', permission: 'auto', worktree: true, repoPath: '/x' })
    expect(resolveChoice([], [], null)).toBeNull()
  })

  it('parses stored choices defensively', () => {
    expect(parseChoice(null)).toBeNull()
    expect(parseChoice({ provider: 'gemini', model: 3, worktree: false })).toEqual({ worktree: false })
  })
})

describe('transcript runs', () => {
  const at = '2026-10-07T00:00:00Z'
  const tool = (id: string, status: 'running' | 'ok' | 'error', name = 'Bash'): ToolEvent => ({ kind: 'tool', id, at, name, summary: id, output: null, status })

  it('folds tool calls and the thinking between them into one run per gap between messages', () => {
    const events: AgentEvent[] = [
      { kind: 'user', id: 'u', at, text: 'go' },
      tool('t1', 'ok'),
      { kind: 'thinking', id: 'th', at, text: 'hmm' },
      tool('t2', 'ok'),
      { kind: 'assistant', id: 'a', at, text: 'done' },
      { kind: 'thinking', id: 'th2', at, text: 'alone' },
      tool('t3', 'running')
    ]
    const items = groupTranscript(events)
    expect(items.map((item) => (item.kind === 'run' ? `run:${item.events.map((e) => e.id).join(',')}` : item.event.id))).toEqual([
      'u',
      'run:t1,th,t2',
      'a',
      'run:th2,t3'
    ])
  })

  it('keeps thinking with no tool calls inline', () => {
    const items = groupTranscript([{ kind: 'thinking', id: 'th', at, text: 'x' }])
    expect(items).toEqual([{ kind: 'event', event: { kind: 'thinking', id: 'th', at, text: 'x' } }])
  })

  it('labels a run by running, completed, subagent and failed counts', () => {
    expect(runLabel([tool('a', 'ok')])).toBe('1 tool call')
    expect(runLabel([tool('a', 'ok'), tool('b', 'running'), tool('c', 'running')])).toBe('2 running, 1 completed')
    expect(runLabel([tool('a', 'ok', 'Task'), tool('b', 'error')])).toBe('2 tool calls · 1 subagent · 1 failed')
  })
})
