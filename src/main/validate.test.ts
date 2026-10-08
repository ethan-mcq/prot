import { describe, expect, it } from 'vitest'
import {
  parseAgentDiffPath,
  parseAgentId,
  parseAgentOpenTarget,
  parseAgentPrompt,
  parseAgentStartInput,
  parseChatRequest,
  parsePromptKind
} from './validate'

const context = { pull: null, story: null, step: null, chapter: null, flow: null, file: null, section: null, selection: null }
const request = (extra: Record<string, unknown>) => ({ id: 'c1', messages: [{ role: 'user', content: 'Why?' }], context, ...extra })

describe('parseChatRequest promptHash', () => {
  it.each([
    ['absent', {}, undefined],
    ['12 hex characters', { promptHash: '18b4da50330c' }, '18b4da50330c']
  ])('accepts a hash that is %s', (_case, extra, hash) => {
    expect(parseChatRequest(request(extra)).promptHash).toBe(hash)
  })

  it.each([[{ promptHash: '18B4DA50330C' }], [{ promptHash: '18b4da' }], [{ promptHash: null }]])('rejects %j', (extra) => {
    expect(() => parseChatRequest(request(extra))).toThrow(/prompt hash/)
  })
})

describe('parsePromptKind', () => {
  it.each([
    ['guide', 'guide'],
    ['chat', 'chat']
  ])('accepts %s', (raw, kind) => {
    expect(parsePromptKind(raw)).toBe(kind)
  })

  it('rejects any other kind', () => {
    expect(() => parsePromptKind('review')).toThrow('Prompt kind must be one of guide, chat')
  })
})

describe('agent parsers', () => {
  const start = { provider: 'codex', repoPath: '/tmp/repo', prompt: 'Fix it', model: 'gpt-6-astra', effort: 'xhigh', permission: 'workspace-write', worktree: true }

  it('accepts a start input and a Claude alias model', () => {
    expect(parseAgentStartInput(start)).toEqual(start)
    expect(parseAgentStartInput({ ...start, provider: 'claude', model: 'opus[1m]', permission: 'plan' })).toMatchObject({ model: 'opus[1m]' })
  })

  it.each([
    [{ provider: 'gemini' }, /Provider/],
    [{ repoPath: 'relative/repo' }, /absolute/],
    [{ prompt: '   ' }, /must not be empty/],
    [{ model: 'gpt"; rm' }, /Invalid model/],
    [{ effort: 'high" sandbox="x' }, /Invalid effort/],
    [{ permission: 'plan' }, /Permission/],
    [{ worktree: 'yes' }, /worktree/]
  ])('rejects %j', (patch, error) => {
    expect(() => parseAgentStartInput({ ...start, ...patch })).toThrow(error)
  })

  it('checks ids, prompts, open targets and diff paths', () => {
    expect(parseAgentId('0f2b6c1e-8d4a-4c3b-9e7f-1a2b3c4d5e6f')).toBe('0f2b6c1e-8d4a-4c3b-9e7f-1a2b3c4d5e6f')
    expect(parseAgentId('codex-app:01a119d5-62bb-7f83-8422-0e99cfb0098f')).toBe('codex-app:01a119d5-62bb-7f83-8422-0e99cfb0098f')
    expect(() => parseAgentId('../agents')).toThrow('Invalid agent id')
    expect(() => parseAgentPrompt('x'.repeat(100_001))).toThrow('at most')
    expect(parseAgentOpenTarget('terminal')).toBe('terminal')
    expect(() => parseAgentOpenTarget('shell')).toThrow('Open target')
    expect(parseAgentDiffPath('src/a.ts')).toBe('src/a.ts')
    for (const bad of ['/etc/passwd', '../x', 'a/../../b', '', 'a\0b']) {
      expect(() => parseAgentDiffPath(bad)).toThrow()
    }
  })
})
