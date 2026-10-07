import { describe, expect, it } from 'vitest'
import { fallbackRepo, parsePullInput, type PullInput, type RepoRef } from './pull-input'
import type { PullSummary } from './types'

const CAPY: RepoRef = { owner: 'capy-ai', repo: 'capy' }

describe('parsePullInput', () => {
  it.each<[string, RepoRef | null, PullInput]>([
    ['https://github.com/octo-labs/tools/pull/42', null, { ref: { owner: 'octo-labs', repo: 'tools', number: 42 } }],
    ['https://github.com/octo-labs/tools/pull/42/files', null, { ref: { owner: 'octo-labs', repo: 'tools', number: 42 } }],
    ['https://github.com/octo-labs/tools/pull/42/commits/abc123', null, { ref: { owner: 'octo-labs', repo: 'tools', number: 42 } }],
    ['https://github.com/octo-labs/tools/pull/42#discussion_r9001', null, { ref: { owner: 'octo-labs', repo: 'tools', number: 42 } }],
    ['https://github.com/octo-labs/tools/pull/42?w=1', null, { ref: { owner: 'octo-labs', repo: 'tools', number: 42 } }],
    ['  https://ghe.corp.example/infra/deploy.cfg/pull/7  ', null, { ref: { owner: 'infra', repo: 'deploy.cfg', number: 7 } }],
    ['octo-labs/tools#42', null, { ref: { owner: 'octo-labs', repo: 'tools', number: 42 } }],
    ['octo-labs/tools/pull/42', null, { ref: { owner: 'octo-labs', repo: 'tools', number: 42 } }],
    ['#5251', CAPY, { ref: { owner: 'capy-ai', repo: 'capy', number: 5251 } }],
    ['5251', CAPY, { ref: { owner: 'capy-ai', repo: 'capy', number: 5251 } }],
    ['#5251', null, { error: 'Include the repo, e.g. owner/repo#123' }],
    ['https://github.com/octo-labs/tools/issues/42', null, { error: "That's an issue link, not a pull request" }],
    ['octo-labs/tools/issues/42', CAPY, { error: "That's an issue link, not a pull request" }],
    ['https://github.com/octo-labs/tools', null, { error: "That link doesn't point to a pull request" }],
    ['https://github.com/octo-labs/tools/tree/main/42', null, { error: "That link doesn't point to a pull request" }],
    ['#0', CAPY, { error: 'Pull request numbers start at 1' }],
    ['', CAPY, { error: 'Use a PR link, owner/repo#123 or #123' }],
    ['fix the login bug', CAPY, { error: 'Use a PR link, owner/repo#123 or #123' }],
    ['octo-labs#42', CAPY, { error: 'Use a PR link, owner/repo#123 or #123' }]
  ])('%j with fallback %j', (text, fallback, expected) => {
    expect(parsePullInput(text, fallback)).toEqual(expected)
  })
})

function summary(owner: string, repo: string, updatedAt: string): PullSummary {
  return {
    ref: { owner, repo, number: 1 },
    title: '',
    author: { login: 'kai', avatarUrl: '' },
    url: '',
    draft: false,
    createdAt: updatedAt,
    updatedAt,
    bucket: 'review',
    state: 'open',
    comments: 0,
    labels: [],
    baseRef: 'main',
    headRef: null
  }
}

describe('fallbackRepo', () => {
  const pulls = [summary('acme', 'old', '2026-10-01T00:00:00Z'), summary('acme', 'fresh', '2026-10-06T00:00:00Z')]

  it.each<[string, Parameters<typeof fallbackRepo>, RepoRef | null]>([
    ['the open PR wins', [{ owner: 'capy-ai', repo: 'capy', number: 9 }, pulls], CAPY],
    ['else the most recently updated inbox PR', [null, pulls], { owner: 'acme', repo: 'fresh' }],
    ['else nothing', [null, []], null]
  ])('%s', (_name, args, expected) => {
    expect(fallbackRepo(...args)).toEqual(expected)
  })
})
