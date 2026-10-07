import { describe, expect, it } from 'vitest'
import type { PullSummary } from '@shared/types'
import { graphqlUrl, mergeBuckets, toChangedFile, toSearchResult, type RawGraphqlPull, type RawSearchResponse } from './github-map'

const node: RawGraphqlPull = {
  __typename: 'PullRequest',
  number: 42,
  title: 'Add retry to uploader',
  url: 'https://github.com/acme/widgets/pull/42',
  isDraft: true,
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
