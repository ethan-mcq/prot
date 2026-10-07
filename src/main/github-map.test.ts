import { describe, expect, it } from 'vitest'
import type { PullSummary } from '@shared/types'
import {
  graphqlUrl,
  mergeBuckets,
  toChangedFile,
  toPullsResult,
  toRestSummary,
  toSearchResult,
  type RawGraphqlPull,
  type RawPull,
  type RawPullsResponse,
  type RawSearchResponse
} from './github-map'

const node: RawGraphqlPull = {
  __typename: 'PullRequest',
  number: 42,
  title: 'Add retry to uploader',
  url: 'https://github.com/acme/widgets/pull/42',
  isDraft: true,
  state: 'OPEN',
  createdAt: '2026-10-01T10:00:00Z',
  updatedAt: '2026-10-02T11:30:00Z',
  baseRefName: 'main',
  headRefName: 'ada/retry',
  isCrossRepository: false,
  repository: { nameWithOwner: 'acme/widgets', defaultBranchRef: { name: 'main' } },
  author: { login: 'ada', avatarUrl: 'https://avatars.example/ada.png' },
  comments: { totalCount: 3 },
  labels: { nodes: [{ name: 'bug', color: 'd73a4a' }] }
}

const searched = (...nodes: NonNullable<RawSearchResponse['data']>['search']['nodes']): RawSearchResponse => ({
  data: { search: { nodes } }
})

describe('graphqlUrl', () => {
  it.each([
    ['https://api.github.com', 'https://api.github.com/graphql'],
    ['https://ghe.corp.example/api/v3', 'https://ghe.corp.example/api/graphql'],
    ['https://ghe.corp.example/api/v3/', 'https://ghe.corp.example/api/graphql'],
    ['http://127.0.0.1:5123', 'http://127.0.0.1:5123/graphql']
  ])('%s posts GraphQL to %s', (rest, expected) => {
    expect(graphqlUrl(rest)).toBe(expected)
  })
})

describe('toSearchResult', () => {
  it('maps a pull request node into a summary', () => {
    expect(toSearchResult(searched(node), 'review')).toEqual({
      pulls: [
        {
          ref: { owner: 'acme', repo: 'widgets', number: 42 },
          title: 'Add retry to uploader',
          author: { login: 'ada', avatarUrl: 'https://avatars.example/ada.png' },
          url: 'https://github.com/acme/widgets/pull/42',
          draft: true,
          createdAt: '2026-10-01T10:00:00Z',
          updatedAt: '2026-10-02T11:30:00Z',
          bucket: 'review',
          state: 'open',
          comments: 3,
          labels: [{ name: 'bug', color: 'd73a4a' }],
          baseRef: 'main',
          headRef: 'ada/retry'
        }
      ]
    })
  })

  it.each<[string, Partial<RawGraphqlPull>, Partial<PullSummary>]>([
    ['a deleted author is ghost', { author: null }, { author: { login: 'ghost', avatarUrl: '' } }],
    ['missing labels are empty', { labels: null }, { labels: [] }],
    ['a fork head cannot carry a stack', { isCrossRepository: true }, { headRef: null }],
    [
      'a default-branch head cannot carry a stack',
      { baseRefName: 'release', headRefName: 'main' },
      { baseRef: 'release', headRef: null }
    ]
  ])('%s', (_name, raw, expected) => {
    const result = toSearchResult(searched({ ...node, ...raw }), 'mine')
    expect('pulls' in result && result.pulls[0]).toMatchObject(expected)
  })

  it('skips nodes that are not visible pull requests', () => {
    const result = toSearchResult(searched({ __typename: 'Issue' }, null, { ...node, number: 7 }), 'mine')
    expect('pulls' in result && result.pulls.map((pull) => pull.ref.number)).toEqual([7])
  })

  it.each<[string, RawSearchResponse, ReturnType<typeof toSearchResult> | number[]]>([
    [
      'errors without data fail with their messages',
      { data: null, errors: [{ message: 'Bad search query' }, { message: 'Try again' }] },
      { error: 'GitHub GraphQL: Bad search query; Try again' }
    ],
    ['partial errors keep the visible pulls', { ...searched(node), errors: [{ message: 'SAML enforcement' }] }, [42]]
  ])('%s', (_name, response, expected) => {
    const result = toSearchResult(response, 'review')
    expect('pulls' in result ? result.pulls.map((pull) => pull.ref.number) : result).toEqual(expected)
  })
})

describe('toPullsResult', () => {
  const refs = [
    { owner: 'acme', repo: 'widgets', number: 42 },
    { owner: 'acme', repo: 'widgets', number: 404 },
    { owner: 'acme', repo: 'gone', number: 1 },
    { owner: 'sso-org', repo: 'private', number: 9 }
  ]

  it('maps found pulls to summaries, NOT_FOUND to null, and leaves pulls it cannot see out', () => {
    const response: RawPullsResponse = {
      data: { p0: { pullRequest: { ...node, state: 'MERGED' } }, p1: { pullRequest: null }, p2: null, p3: null },
      errors: [
        { message: 'Could not resolve to a PullRequest', type: 'NOT_FOUND', path: ['p1', 'pullRequest'] },
        { message: 'Could not resolve to a Repository', type: 'NOT_FOUND', path: ['p2'] },
        { message: 'Resource protected by SAML', type: 'FORBIDDEN', path: ['p3'] }
      ]
    }
    const result = toPullsResult(response, refs, 'manual')
    const states: Record<string, string | null> = {}
    if ('pulls' in result) {
      for (const [key, pull] of result.pulls) states[key] = pull && `${pull.bucket} ${pull.state}`
    }
    expect(states).toEqual({ 'acme/widgets#42': 'manual merged', 'acme/widgets#404': null, 'acme/gone#1': null })
  })

  it('fails when GitHub sends no data', () => {
    expect(toPullsResult({ data: null, errors: [{ message: 'rate limited' }] }, refs, 'manual')).toEqual({
      error: 'GitHub GraphQL: rate limited'
    })
  })
})

describe('toRestSummary', () => {
  const raw: RawPull = {
    number: 42,
    state: 'closed',
    merged_at: null,
    title: 'Retry uploads',
    body: null,
    user: { login: 'ada', avatar_url: '' },
    html_url: 'https://github.com/Acme/Widgets/pull/42',
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-02T11:30:00Z',
    comments: 0,
    labels: [],
    base: { ref: 'main', sha: 'a', repo: { full_name: 'Acme/Widgets', default_branch: 'main' } },
    head: { ref: 'ada/retry', sha: 'b', repo: { full_name: 'Acme/Widgets' } },
    additions: 1,
    deletions: 0
  }

  it.each<[string, Partial<RawPull>, string]>([
    ['an open pull', { state: 'open' }, 'Acme/Widgets#42 open ada/retry'],
    ['a closed pull', {}, 'Acme/Widgets#42 closed ada/retry'],
    ['a merged pull', { merged_at: '2026-10-03T00:00:00Z' }, 'Acme/Widgets#42 merged ada/retry']
  ])('takes the canonical repo name and state of %s', (_name, patch, expected) => {
    const pull = toRestSummary({ ...raw, ...patch }, 'manual')
    expect(`${pull.ref.owner}/${pull.ref.repo}#${pull.ref.number} ${pull.state} ${pull.headRef}`).toBe(expected)
  })
})

describe('mergeBuckets', () => {
  const summary = (number: number, bucket: PullSummary['bucket']): PullSummary => {
    const result = toSearchResult(searched({ ...node, number }), bucket)
    if (!('pulls' in result) || !result.pulls[0]) throw new Error('fixture did not map')
    return result.pulls[0]
  }

  it('keeps a pull that is both requested for review and authored in the review bucket', () => {
    const merged = mergeBuckets(
      [summary(1, 'review'), summary(2, 'review')],
      [summary(2, 'mine'), summary(3, 'mine')]
    )
    expect(merged.map((pull) => [pull.ref.number, pull.bucket])).toEqual([
      [1, 'review'],
      [2, 'review'],
      [3, 'mine']
    ])
  })
})

describe('toChangedFile', () => {
  const file = { filename: 'src/a.ts', additions: 1, deletions: 2 }

  it('normalizes copied and changed to modified', () => {
    expect(toChangedFile({ ...file, status: 'copied' }).status).toBe('modified')
    expect(toChangedFile({ ...file, status: 'changed' }).status).toBe('modified')
  })

  it('maps a missing patch and previous filename to null', () => {
    const mapped = toChangedFile({ ...file, status: 'added' })
    expect(mapped.patch).toBeNull()
    expect(mapped.previousPath).toBeNull()
  })

  it('keeps the rename source', () => {
    const mapped = toChangedFile({ ...file, status: 'renamed', previous_filename: 'src/old.ts' })
    expect(mapped).toMatchObject({ status: 'renamed', path: 'src/a.ts', previousPath: 'src/old.ts' })
  })
})
