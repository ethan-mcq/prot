import { cpSync, mkdtempSync, readdirSync, statSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearSessionCache,
  latestCodexUsage,
  listClaudeSessions,
  listCodexSessions,
  readClaudeTranscript,
  readCodexTranscript
} from './sessions'

const FIXTURES = resolve(import.meta.dirname, '../../../tests/fixtures/agents')
const NOW = Date.parse('2026-10-08T05:00:00.000Z')
const CLAUDE_ID = '3253eaf7-a224-4b39-b4a6-33ba51d8e490'
const CODEX_ID = '01a119d5-62bb-7f83-8422-0e99cfb0098f'

function touchAll(dir: string, time: Date): void {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) touchAll(path, time)
    else utimesSync(path, time, time)
  }
}

// Fixture copies with every file modified an hour before NOW, so they fall inside the 7 day window.
function home(name: string): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'prot-sessions-')), name)
  cpSync(join(FIXTURES, name), dir, { recursive: true })
  touchAll(dir, new Date(NOW - 60 * 60 * 1000))
  return dir
}

beforeEach(() => clearSessionCache())

describe('Claude sessions', () => {
  it('lists recent sessions with the custom title, cwd, branch, model and cost, skipping excluded and promptless ones', async () => {
    const dir = home('claude-home')
    const sessions = await listClaudeSessions(dir, new Set(['9b1f4c2e-0000-4000-8000-000000000001']), NOW)
    expect(sessions).toEqual([
      {
        provider: 'claude',
        sessionId: CLAUDE_ID,
        file: join(dir, 'projects/-tmp-repo', `${CLAUDE_ID}.jsonl`),
        title: 'Fix login redirect loop',
        cwd: '/tmp/repo',
        gitBranch: 'feat/login',
        model: 'claude-opus-5-5',
        effort: null,
        createdAt: '2026-10-07T10:00:00.000Z',
        updatedAt: new Date(NOW - 60 * 60 * 1000).toISOString(),
        running: false,
        lastTurnAt: '2026-10-07T10:02:00.000Z',
        lastMessage: 'Opened a PR with the fix.',
        costUsd: 1.25
      }
    ])
  })

  it('skips sessions older than 7 days and marks a file written in the last 90 s running', async () => {
    const dir = home('claude-home')
    expect(await listClaudeSessions(dir, new Set(), NOW + 8 * 24 * 60 * 60 * 1000)).toEqual([])
    const fresh = await listClaudeSessions(dir, new Set(), NOW - 60 * 60 * 1000 + 30_000)
    expect(fresh.map((session) => [session.title, session.running])).toEqual([
      ['Fix login redirect loop', true],
      ['started by prot', true]
    ])
  })

  it('reads the transcript: real prompts only, tool pairs collapsed, no sidechain lines', async () => {
    const dir = home('claude-home')
    const events = await readClaudeTranscript(join(dir, 'projects/-tmp-repo', `${CLAUDE_ID}.jsonl`))
    expect(events.map((event) => [event.kind, event.kind === 'tool' ? `${event.name} ${event.summary} ${event.status}` : 'text' in event ? event.text : ''])).toEqual([
      ['user', 'Fix the login redirect\nit loops forever'],
      ['thinking', 'Look at the auth middleware first.'],
      ['tool', 'Grep redirect in src/auth ok'],
      ['tool', 'Bash npm test -- auth error'],
      ['assistant', 'The middleware redirects to itself when the session cookie is missing.'],
      ['user', 'ship it'],
      ['assistant', 'Opened a PR with the fix.']
    ])
  })
})

describe('Codex sessions', () => {
  it('lists top-level threads with the session_index title and skips guardian threads', async () => {
    const dir = home('codex-home')
    const sessions = await listCodexSessions(dir, new Set(), NOW)
    expect(sessions).toEqual([
      {
        provider: 'codex',
        sessionId: CODEX_ID,
        file: join(dir, 'sessions/2026/10/07', `rollout-2026-10-07T21-46-17-${CODEX_ID}.jsonl`),
        title: 'Read a.txt',
        cwd: '/tmp/repo',
        gitBranch: null,
        model: 'gpt-6-luna',
        effort: 'low',
        createdAt: '2026-10-08T04:46:17.287Z',
        updatedAt: new Date(NOW - 60 * 60 * 1000).toISOString(),
        running: false,
        lastTurnAt: '2026-10-08T04:46:17.394Z',
        lastMessage: 'hello',
        costUsd: null
      }
    ])
    expect(await listCodexSessions(dir, new Set([CODEX_ID]), NOW)).toEqual([])
  })

  it('reads the transcript from item_completed events without duplicating response_items', async () => {
    const dir = home('codex-home')
    const events = await readCodexTranscript(join(dir, 'sessions/2026/10/07', `rollout-2026-10-07T21-46-17-${CODEX_ID}.jsonl`))
    expect(events).toEqual([
      { kind: 'user', id: '01a119d5-6812-7ef2-8def-b86cbc4d1639', at: '2026-10-08T04:46:18.643Z', text: 'Read a.txt and reply with its contents' },
      { kind: 'tool', id: 'exec-b4a70dd7-a35a-4d82-aada-321f8ae983cc', at: '2026-10-08T04:46:20.471Z', name: 'Bash', summary: 'cat a.txt', output: 'hello\n', status: 'ok' },
      { kind: 'assistant', id: 'msg_012de7dbf69e6894016ac7201cffcc81959da00e9ec21eef79', at: '2026-10-08T04:46:21.062Z', text: 'hello' },
      {
        kind: 'turn',
        id: 'turn:01a119d5-632e-7971-ab64-e5cf2fcc49f3',
        at: '2026-10-08T04:46:21.276Z',
        durationMs: 3883,
        costUsd: null,
        inputTokens: 30808,
        outputTokens: 40
      }
    ])
  })

  it('reads the newest rate limits', async () => {
    expect(await latestCodexUsage(home('codex-home'), NOW)).toEqual([{ label: '7 day', usedPercent: 57, resetsAt: 1792019096 }])
  })
})
