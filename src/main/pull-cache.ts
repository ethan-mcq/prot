import { pullKey, type PullDetail, type PullRef, type PullState, type ReviewEvent, type ReviewInput } from '@shared/types'
import { attachmentLinks, type AttachmentDocument } from './attachment-links'
import type { AttachmentService } from './attachments'
import type { GuideService } from './guide-ai'

export function cacheName(ref: PullRef): string {
  return `${ref.owner}__${ref.repo}__${ref.number}`
}

// Owners cannot contain underscores but repos can, so the repo is whatever sits between the first and last `__`.
export function parseCacheName(name: string): PullRef | null {
  const match = /^([^_]+)__(.+)__(\d+)$/.exec(name)
  if (!match) return null
  return { owner: match[1] as string, repo: match[2] as string, number: Number(match[3]) }
}

// Approving or requesting changes finishes a review; a comment does not.
const FINISHES_REVIEW: Record<ReviewEvent, boolean> = { APPROVE: true, REQUEST_CHANGES: true, COMMENT: false }

// Null means GitHub says the pull is gone. A pull left out of the map could not be checked and keeps its cache.
export type PullStateLookup = (refs: PullRef[]) => Promise<Map<string, PullState | null>>

// Everything prot keeps on disk for one PR, its AI guide and its attachments, is deleted here so the two can't drift.
export class PullCache {
  // The head a finished review was submitted at; refetching that same head must not import the attachments again.
  private readonly finished = new Map<string, string>()

  constructor(
    private readonly guides: GuideService,
    private readonly attachments: AttachmentService,
    private readonly web: string
  ) {}

  fetched(ref: PullRef, detail: PullDetail, documents: AttachmentDocument[]): void {
    if (this.finished.get(pullKey(ref)) === detail.head.sha) return
    this.attachments.import(ref, attachmentLinks(documents, this.web))
  }

  async reviewed(ref: PullRef, input: ReviewInput): Promise<void> {
    if (!FINISHES_REVIEW[input.event]) return
    this.finished.set(pullKey(ref), input.commitId)
    await this.forget(ref)
  }

  async forget(ref: PullRef): Promise<void> {
    await Promise.all([this.guides.forget(ref), this.attachments.remove(ref)])
  }

  // Deletes the cache of PRs that are merged, closed or gone. A lookup that throws deletes nothing.
  async sweep(lookup: PullStateLookup): Promise<void> {
    const refs = new Map<string, PullRef>()
    for (const ref of [...(await this.guides.cachedRefs()), ...(await this.attachments.cachedRefs())]) refs.set(pullKey(ref), ref)
    if (refs.size === 0) return
    const states = await lookup([...refs.values()])
    for (const [key, ref] of refs) {
      const state = states.get(key)
      if (state === undefined || state === 'open') continue
      await this.forget(ref)
    }
  }
}
