import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  claudeArgs,
  claudeDefaults,
  claudeModels,
  codexArgs,
  codexModelsAndDefaults,
  findBinary,
  parseClaudeAuthStatus,
  parseCodexLoginStatus,
  parseShellPath,
  parseTopLevelToml,
  parseVersion,
  PERMISSIONS,
  type TurnSpec
} from './cli'

const FIXTURES = resolve(import.meta.dirname, '../../../tests/fixtures/agents')

const spec = (extra: Partial<TurnSpec>): TurnSpec => ({
  mode: 'first',
  prompt: '-fix the bug',
  model: 'claude-opus-5-5',
  effort: 'high',
  permission: 'auto',
  cwd: '/tmp/repo',
  sessionId: '11111111-1111-4111-8111-111111111111',
  ...extra
})

describe('claudeArgs', () => {
  const head = ['-p', '--output-format', 'stream-json', '--verbose', '--model', 'claude-opus-5-5', '--effort', 'high']

  it.each([
    ['first', ['--session-id', '11111111-1111-4111-8111-111111111111']],
    ['resume', ['--resume', '11111111-1111-4111-8111-111111111111']],
    ['fork', ['--resume', '11111111-1111-4111-8111-111111111111', '--fork-session']]
  ] as const)('builds a %s turn with the prompt after --', (mode, session) => {
    expect(claudeArgs(spec({ mode }))).toEqual([...head, '--permission-mode', 'auto', ...session, '--', '-fix the bug'])
  })

  it.each(PERMISSIONS.claude.map((option) => option.id))('passes permission %s as the permission mode', (permission) => {
    const args = claudeArgs(spec({ permission }))
    expect(args[args.indexOf('--permission-mode') + 1]).toBe(permission)
  })
})

describe('codexArgs', () => {
  it.each([
    ['auto', ['--approve-for-me']],
    ['workspace-write', ['-s', 'workspace-write']],
    ['read-only', ['-s', 'read-only']],
    ['full', ['--dangerously-bypass-approvals-and-sandbox']]
  ])('maps permission %s', (permission, flags) => {
    expect(codexArgs(spec({ permission, model: 'gpt-6-astra', effort: 'xhigh', sessionId: null }))).toEqual([
      'exec',
      '--json',
      '-m',
      'gpt-6-astra',
      '-c',
      'model_reasoning_effort="xhigh"',
      ...flags,
      '-C',
      '/tmp/repo',
      '--skip-git-repo-check',
      '--',
      '-fix the bug'
    ])
  })

  it.each([
    ['resume', 'resume'],
    ['fork', 'fork']
  ] as const)('puts every option before the %s subcommand', (mode, word) => {
    const args = codexArgs(spec({ mode, model: 'gpt-6-astra', sessionId: '01a119d5-62bb-7f83-8422-0e99cfb0098f' }))
    expect(args.slice(-4)).toEqual([word, '01a119d5-62bb-7f83-8422-0e99cfb0098f', '--', '-fix the bug'])
    expect(args.indexOf('-C')).toBeLessThan(args.indexOf(word))
  })

  it('rejects an unknown permission and a follow-up without a thread', () => {
    expect(() => codexArgs(spec({ permission: 'plan' }))).toThrow('Unknown Codex permission plan')
    expect(() => codexArgs(spec({ mode: 'resume', sessionId: null }))).toThrow('thread id')
  })
})

describe('probes', () => {
  it('reads versions, sign-in and the login shell PATH', () => {
    expect(parseVersion('2.1.278 (Claude Code)\n')).toBe('2.1.278')
    expect(parseVersion('codex-cli 0.160.0\n')).toBe('0.160.0')
    expect(parseClaudeAuthStatus('{"loggedIn":true,"authMethod":"claude.ai","email":"x@y.z"}')).toEqual({ signedIn: true, account: 'claude.ai' })
    expect(parseClaudeAuthStatus('not json')).toEqual({ signedIn: false, account: null })
    expect(parseCodexLoginStatus('Logged in using ChatGPT\n')).toEqual({ signedIn: true, account: 'ChatGPT' })
    expect(parseCodexLoginStatus('Not logged in\n')).toEqual({ signedIn: false, account: null })
    expect(parseShellPath('motd noise\n__PROT_PATH__/a:/b__PROT_PATH__')).toBe('/a:/b')
    expect(parseShellPath('nothing')).toBeNull()
  })

  it('finds a binary through the env override, else on PATH', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'prot-cli-'))
    const bin = join(dir, 'claude')
    writeFileSync(bin, '#!/bin/sh\n')
    chmodSync(bin, 0o755)
    expect(await findBinary('claude', '/nowhere', { PROT_CLAUDE_BIN: bin })).toBe(bin)
    expect(await findBinary('claude', '/nowhere', { PROT_CLAUDE_BIN: join(dir, 'missing') })).toBeNull()
    expect(await findBinary('claude', `/nowhere:${dir}`, {})).toBe(bin)
  })
})

describe('models', () => {
  it('reads the Claude default from settings.json and offers an alias model as-is', async () => {
    const defaults = await claudeDefaults(join(FIXTURES, 'claude-home'))
    expect(defaults).toEqual({ model: 'opus[1m]', effort: 'xhigh' })
    expect(claudeModels(defaults).map((model) => model.id)).toEqual([
      'opus[1m]',
      'claude-opus-5-5',
      'claude-sonnet-5-5',
      'claude-haiku-5-5',
      'claude-fable-5-1'
    ])
    expect(await claudeDefaults(join(FIXTURES, 'missing'))).toEqual({ model: 'claude-opus-5-5', effort: 'high' })
  })

  it('lists the visible Codex models and the config.toml default', async () => {
    const { models, defaults } = await codexModelsAndDefaults(join(FIXTURES, 'codex-home'))
    expect(defaults).toEqual({ model: 'gpt-6-astra', effort: 'xhigh' })
    expect(models.map((model) => [model.id, model.label, model.defaultEffort, model.efforts.length])).toEqual([
      ['gpt-6-astra', 'GPT-6-Astra', 'medium', 6],
      ['gpt-6-luna', 'GPT-6-Luna', 'medium', 5]
    ])
  })

  it('stops reading TOML at the first table', () => {
    expect(parseTopLevelToml('model = "a"\n[x]\nmodel = "b"\n')).toEqual({ model: 'a' })
  })
})
