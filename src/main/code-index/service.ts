import { buildStoryGuide } from '@shared/guide'
import { pullKey, type Guide, type PullDetail, type PullRef } from '@shared/types'
import type { PullService } from '../pulls'
import { indexPull, TreeSitter, type IndexResult } from './indexer'
import { grammarFiles } from './wasm'

const KEEP = 20

function emptyIndex(detail: PullDetail): IndexResult {
  return { index: { headSha: detail.head.sha, symbols: [], skipped: detail.files.map((file) => file.path) }, heads: {} }
}

export class CodeIndexService {
  private readonly indexes = new Map<string, Promise<IndexResult>>()
  private readonly treeSitter = new TreeSitter(grammarFiles())

  constructor(private readonly pulls: PullService) {}

  index(ref: PullRef, detail: PullDetail): Promise<IndexResult> {
    const key = `${pullKey(ref)}@${detail.head.sha}`
    let pending = this.indexes.get(key)
    if (!pending) {
      const source = {
        file: (path: string, sha: string) => this.pulls.getFile(ref, path, sha),
        tree: (sha: string) => this.pulls.getTree(ref, sha)
      }
      pending = indexPull(detail, source, this.treeSitter).catch(() => emptyIndex(detail))
      this.indexes.set(key, pending)
      while (this.indexes.size > KEEP) this.indexes.delete(this.indexes.keys().next().value as string)
    }
    return pending
  }

  async story(ref: PullRef): Promise<Guide> {
    const detail = await this.pulls.cached(ref)
    const { index } = await this.index(ref, detail)
    return buildStoryGuide(detail, index)
  }
}
