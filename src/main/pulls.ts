import { pullKey, type PullDetail, type PullRef, type ReviewInput } from '@shared/types'
import type { AuthService } from './auth'

export class PullService {
  private readonly details = new Map<string, PullDetail>()

  constructor(
    private readonly auth: AuthService,
    // The inbox poll knows when a pull last changed, which tells us if a cached detail is stale.
    private readonly latestUpdatedAt: (ref: PullRef) => string | null
  ) {}

  async fetch(ref: PullRef): Promise<PullDetail> {
    const viewer = this.auth.user()
    if (!viewer) throw new Error('Not signed in to GitHub.')
    const detail = await this.auth.client().getPull(ref, viewer.login)
    this.details.set(pullKey(ref), detail)
    return detail
  }

  // For callers that must not refetch four endpoints per call, such as chat turns.
  async cached(ref: PullRef): Promise<PullDetail> {
    const detail = this.details.get(pullKey(ref))
    if (detail && !this.isStale(detail)) return detail
    return this.fetch(ref)
  }

  getFile(ref: PullRef, path: string, sha: string): Promise<string> {
    return this.auth.client().getFile(ref, path, sha)
  }

  getTree(ref: PullRef, sha: string): Promise<string[]> {
    return this.auth.client().getTree(ref, sha)
  }

  async submitReview(ref: PullRef, input: ReviewInput): Promise<void> {
    // Inline comments are anchored to the diff the reviewer was looking at, so use that commit.
    const headSha = (await this.cached(ref)).head.sha
    await this.auth.client().submitReview(ref, headSha, input)
    this.details.delete(pullKey(ref))
  }

  async comment(ref: PullRef, body: string): Promise<void> {
    await this.auth.client().comment(ref, body)
    this.details.delete(pullKey(ref))
  }

  private isStale(detail: PullDetail): boolean {
    const latest = this.latestUpdatedAt(detail.summary.ref)
    return latest !== null && latest > detail.summary.updatedAt
  }
}
