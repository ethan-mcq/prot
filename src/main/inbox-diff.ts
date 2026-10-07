import { pullKey, type PullSummary } from '@shared/types'

export function newReviewRequests(previous: PullSummary[], next: PullSummary[]): PullSummary[] {
  const alreadyRequested = new Set<string>()
  for (const pull of previous) {
    if (pull.bucket === 'review') alreadyRequested.add(pullKey(pull.ref))
  }
  const fresh: PullSummary[] = []
  for (const pull of next) {
    if (pull.bucket !== 'review') continue
    if (alreadyRequested.has(pullKey(pull.ref))) continue
    fresh.push(pull)
  }
  return fresh
}
