import { describe, expect, it } from 'vitest'
import type { PullSummary } from '@shared/types'
import { newlyClosed, newReviewRequests } from './inbox-diff'

function pull(number: number, bucket: PullSummary['bucket'], state: PullSummary['state'] = 'open'): PullSummary {
  return {
    ref: { owner: 'acme', repo: 'widgets', number },
    title: `PR ${number}`,
    author: { login: 'ada', avatarUrl: '' },
    url: '',
    draft: false,
    createdAt: '',
    updatedAt: '',
    bucket,
    state,
    comments: 0,
    labels: [],
    baseRef: 'main',
    headRef: `pr-${number}`
  }
}

describe('newReviewRequests', () => {
  it('returns only review-bucket pulls absent from the previous poll', () => {
    const previous = [pull(1, 'review'), pull(2, 'mine')]
    const next = [pull(1, 'review'), pull(2, 'mine'), pull(3, 'review'), pull(4, 'mine')]
    expect(newReviewRequests(previous, next).map((p) => p.ref.number)).toEqual([3])
  })

  it('counts a pull that moves from mine into review as a new request', () => {
    const fresh = newReviewRequests([pull(2, 'mine')], [pull(2, 'review')])
    expect(fresh.map((p) => p.ref.number)).toEqual([2])
  })
})

describe('newlyClosed', () => {
  it('returns pulls that were open last poll and are now merged or closed, not ones that were never open here', () => {
    const previous = [pull(1, 'manual'), pull(2, 'manual'), pull(3, 'manual'), pull(4, 'manual', 'merged')]
    const next = [pull(1, 'manual', 'merged'), pull(2, 'manual', 'closed'), pull(3, 'manual'), pull(4, 'manual', 'merged'), pull(5, 'manual', 'closed')]
    expect(newlyClosed(previous, next).map((p) => `#${p.ref.number} ${p.state}`)).toEqual(['#1 merged', '#2 closed'])
  })
})
