import { pullKey, type PullDetail, type PullRef, type ReviewComment, type ReviewInput } from '@shared/types'
import type { AttachmentLink } from './attachment-links'
import type { AuthService } from './auth'

// Patches for big PRs are large; keep only the most recently fetched pull requests in memory.
const KEEP_DETAILS = 20

export class PullService {
  private readonly details = new Map<string, PullDetail>()

  constructor(
    private readonly auth: AuthService,
    private readonly latestUpdatedAt: (ref: PullRef) => string | null,
    private readonly onFetched: (ref: PullRef, detail: PullDetail, attachments: AttachmentLink[]) => void
  ) {}

  async fetch(ref: PullRef): Promise<PullDetail> {
    const viewer = this.auth.user()
    if (!viewer) throw new Error('Not signed in to GitHub.')
    const { detail, attachments } = await this.auth.client().getPull(ref, viewer.login)
    this.onFetched(ref, detail, attachments)
    const key = pullKey(ref)
    this.details.delete(key)
    this.details.set(key, detail)
    while (this.details.size > KEEP_DETAILS) this.details.delete(this.details.keys().next().value as string)
    return detail
  }

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
    await this.auth.client().submitReview(ref, input)
    this.details.delete(pullKey(ref))
  }

  async comment(ref: PullRef, body: string): Promise<void> {
    await this.auth.client().comment(ref, body)
    this.details.delete(pullKey(ref))
  }

  async reply(ref: PullRef, commentId: number, body: string): Promise<ReviewComment> {
    const reply = await this.auth.client().reply(ref, commentId, body)
    this.details.delete(pullKey(ref))
    return reply
  }

  private isStale(detail: PullDetail): boolean {
    const latest = this.latestUpdatedAt(detail.summary.ref)
    return latest !== null && latest > detail.summary.updatedAt
  }
}
