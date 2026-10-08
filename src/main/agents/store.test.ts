import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '@shared/agents'
import { AgentStore, type StoredAgent } from './store'

const ID = '0f2b6c1e-8d4a-4c3b-9e7f-1a2b3c4d5e6f'

const agent: StoredAgent = {
  id: ID,
  source: 'prot',
  provider: 'codex',
  title: 'Fix the login redirect',
  repoPath: '/tmp/repo',
  repoName: 'repo',
  cwd: '/tmp/repo',
  branch: 'main',
  worktree: null,
  model: 'gpt-6-astra',
  effort: 'high',
  permission: 'auto',
  sessionId: null,
  status: 'running',
  turnStartedAt: '2026-10-07T12:00:00.000Z',
  unread: false,
  createdAt: '2026-10-07T12:00:00.000Z',
  updatedAt: '2026-10-07T12:00:00.000Z',
  lastMessage: null,
  pr: null,
  changes: null,
  costUsd: null,
  context: { usedTokens: 12000, windowTokens: 200000 },
  archived: false,
  forkedFrom: null,
  promptHash: null
}

describe('AgentStore', () => {
  it('round-trips agents, repos, hidden sessions and usage through agents.json', async () => {
    const root = mkdtempSync(join(tmpdir(), 'prot-agents-'))
    const store = new AgentStore(root)
    store.add({ ...agent })
    store.addRepo('/tmp/a')
    store.addRepo('/tmp/b')
    store.addRepo('/tmp/a')
    store.hide('claude-app:3253eaf7-a224-4b39-b4a6-33ba51d8e490')
    store.setUsage('claude', [{ label: '5 hour', usedPercent: 16, resetsAt: 1791444000 }])
    await store.flush()

    const reloaded = new AgentStore(root)
    expect({
      agents: reloaded.agents(),
      repos: reloaded.repos(),
      hidden: reloaded.isHidden('claude-app:3253eaf7-a224-4b39-b4a6-33ba51d8e490'),
      usage: reloaded.usage('claude'),
      codex: reloaded.usage('codex')
    }).toEqual({
      agents: [agent],
      repos: ['/tmp/a', '/tmp/b'],
      hidden: true,
      usage: [{ label: '5 hour', usedPercent: 16, resetsAt: 1791444000 }],
      codex: []
    })
    expect(readFileSync(join(root, 'agents.json'), 'utf8')).toContain('"forkedFrom": null')
  })

  it('drops invalid agents and starts empty from a corrupt file', () => {
    const root = mkdtempSync(join(tmpdir(), 'prot-agents-'))
    writeFileSync(join(root, 'agents.json'), JSON.stringify({ agents: [{ ...agent, id: '../x' }, { ...agent, provider: 'gemini' }, agent] }))
    expect(new AgentStore(root).agents().map((entry) => entry.id)).toEqual([ID])
    writeFileSync(join(root, 'agents.json'), '{not json')
    expect(new AgentStore(root).agents()).toEqual([])
  })

  it('appends transcript events and reads back the latest version of each', async () => {
    const store = new AgentStore(mkdtempSync(join(tmpdir(), 'prot-agents-')))
    const running: AgentEvent = { kind: 'tool', id: 't1', at: 'a', name: 'Bash', summary: 'ls', output: null, status: 'running' }
    const user: AgentEvent = { kind: 'user', id: 'u1', at: 'a', text: 'hi' }
    void store.appendEvents(ID, [user, running])
    await store.appendEvents(ID, [{ ...running, status: 'ok', output: 'a.txt' }])
    expect(await store.readTranscript(ID)).toEqual([user, { ...running, status: 'ok', output: 'a.txt' }])
    expect(await store.readTranscript('0f2b6c1e-8d4a-4c3b-9e7f-000000000000')).toEqual([])
    await expect(store.readTranscript('../etc/passwd')).rejects.toThrow('Invalid agent id')
  })
})
