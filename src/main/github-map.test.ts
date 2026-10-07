import { describe, expect, it } from 'vitest'
import type { PullSummary } from '@shared/types'
import { mergeBuckets, toChangedFile, toPullSummary, type RawSearchItem } from './github-map'

const item: RawSearchItem = {
  number: 42,
  title: 'Add retry to uploader',
  user: { login: 'ada', avatar_url: 'https://avatars.example/ada.png' },
  html_url: 'https://github.com/acme/widgets/pull/42',
  draft: true,
  created_at: '2026-10-01T10:00:00Z',
  updated_at: '2026-10-02T11:30:00Z',
  comments: 3,
  labels: [{ name: 'bug', color: 'd73a4a' }],
  repository_url: 'https://api.github.com/repos/acme/widgets'
}

describe('toPullSummary', () => {
  it('takes owner and repo from repository_url and maps the search item', () => {
    expect(toPullSummary(item, 'review')).toEqual({
      ref: { owner: 'acme', repo: 'widgets', number: 42 },
      title: 'Add retry to uploader',
      author: { login: 'ada', avatarUrl: 'https://avatars.example/ada.png' },
      url: 'https://github.com/acme/widgets/pull/42',
      draft: true,
      createdAt: '2026-10-01T10:00:00Z',
      updatedAt: '2026-10-02T11:30:00Z',
      bucket: 'review',
      comments: 3,
      labels: [{ name: 'bug', color: 'd73a4a' }]
    })
  })

  it('parses repository_url on an enterprise host with a path prefix', () => {
    const enterprise = { ...item, repository_url: 'https://ghe.corp.example/api/v3/repos/data/lake' }
    expect(toPullSummary(enterprise, 'mine').ref).toEqual({ owner: 'data', repo: 'lake', number: 42 })
  })

  it('defaults draft to false when GitHub omits it', () => {
    const { draft: _draft, ...withoutDraft } = item
    expect(toPullSummary(withoutDraft, 'mine').draft).toBe(false)
  })
})

describe('mergeBuckets', () => {
  const summary = (number: number, bucket: PullSummary['bucket']): PullSummary =>
    toPullSummary({ ...item, number }, bucket)

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
