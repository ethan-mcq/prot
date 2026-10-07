import type {
  GitHubUser,
  PullBucket,
  PullDetail,
  PullRef,
  PullSummary,
  ReviewComment,
  ReviewInput
} from '@shared/types'
import {
  mergeBuckets,
  toPullDetail,
  toPullSummary,
  toReviewComment,
  toUser,
  type RawFile,
  type RawPull,
  type RawReview,
  type RawReviewComment,
  type RawSearchItem,
  type RawUser
} from './github-map'

const MAX_FILE_PAGES = 30
const REQUEST_TIMEOUT_MS = 30_000

const SEARCH_QUERIES: Record<PullBucket, string> = {
  review: 'is:pr is:open archived:false review-requested:@me',
  mine: 'is:pr is:open archived:false author:@me'
}

export class GitHubError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
    this.name = 'GitHubError'
  }
}

type GitHubErrorBody = {
  message?: string
  errors?: (string | { message?: string })[]
}

function describeErrorBody(status: number, body: GitHubErrorBody | null, fallback: string): string {
  const parts: string[] = []
  parts.push(body?.message ?? fallback)
  for (const detail of body?.errors ?? []) {
    const text = typeof detail === 'string' ? detail : detail.message
    if (text) parts.push(text)
  }
  return `GitHub ${status}: ${parts.join(': ')}`
}

type RequestOptions = {
  method?: 'GET' | 'POST'
  query?: Record<string, string>
  body?: unknown
  accept?: string
}

export class GitHubClient {
  constructor(
    private readonly token: string,
    private readonly baseUrl: string
  ) {}

  async getUser(): Promise<GitHubUser> {
    const raw = await this.json<NonNullable<RawUser>>('/user')
    return toUser(raw)
  }

  async listInbox(): Promise<PullSummary[]> {
    const [review, mine] = await Promise.all([this.search('review'), this.search('mine')])
    return mergeBuckets(review, mine)
  }

  async getPull(ref: PullRef, viewerLogin: string): Promise<PullDetail> {
    const base = repoPath(ref)
    const [raw, files, comments, reviews] = await Promise.all([
      this.json<RawPull>(`${base}/pulls/${ref.number}`),
      this.listFiles(ref),
      this.json<RawReviewComment[]>(`${base}/pulls/${ref.number}/comments`, {
        query: { per_page: '100' }
      }),
      this.json<RawReview[]>(`${base}/pulls/${ref.number}/reviews`, { query: { per_page: '100' } })
    ])
    return toPullDetail(ref, viewerLogin, raw, files, comments, reviews)
  }

  async getHeadSha(ref: PullRef): Promise<string> {
    const raw = await this.json<RawPull>(`${repoPath(ref)}/pulls/${ref.number}`)
    return raw.head.sha
  }

  async getFile(ref: PullRef, path: string, sha: string): Promise<string> {
    const encodedPath = path.split('/').map(encodeURIComponent).join('/')
    const res = await this.request(`${repoPath(ref)}/contents/${encodedPath}`, {
      query: { ref: sha },
      accept: 'application/vnd.github.raw'
    })
    return res.text()
  }

  async getTree(ref: PullRef, sha: string): Promise<string[]> {
    const raw = await this.json<{ tree: { path: string; type: string }[] }>(
      `${repoPath(ref)}/git/trees/${encodeURIComponent(sha)}`,
      { query: { recursive: '1' } }
    )
    const paths: string[] = []
    for (const entry of raw.tree) {
      if (entry.type === 'blob') paths.push(entry.path)
    }
    return paths
  }

  async submitReview(ref: PullRef, input: ReviewInput): Promise<void> {
    const body: Record<string, unknown> = {
      commit_id: input.commitId,
      event: input.event,
      comments: input.comments.map((comment) => ({
        path: comment.path,
        line: comment.line,
        side: comment.side,
        body: comment.body
      }))
    }
    if (input.body.trim() !== '') body.body = input.body
    await this.request(`${repoPath(ref)}/pulls/${ref.number}/reviews`, { method: 'POST', body })
  }

  async comment(ref: PullRef, body: string): Promise<void> {
    await this.request(`${repoPath(ref)}/issues/${ref.number}/comments`, {
      method: 'POST',
      body: { body }
    })
  }

  async reply(ref: PullRef, commentId: number, body: string): Promise<ReviewComment> {
    const raw = await this.json<RawReviewComment>(`${repoPath(ref)}/pulls/${ref.number}/comments/${commentId}/replies`, {
      method: 'POST',
      body: { body }
    })
    return toReviewComment(raw)
  }

  private async search(bucket: PullBucket): Promise<PullSummary[]> {
    const raw = await this.json<{ items: RawSearchItem[] }>('/search/issues', {
      query: { q: SEARCH_QUERIES[bucket], per_page: '50', sort: 'updated' }
    })
    return raw.items.map((item) => toPullSummary(item, bucket))
  }

  private async listFiles(ref: PullRef): Promise<RawFile[]> {
    const files: RawFile[] = []
    for (let page = 1; page <= MAX_FILE_PAGES; page++) {
      const batch = await this.json<RawFile[]>(`${repoPath(ref)}/pulls/${ref.number}/files`, {
        query: { per_page: '100', page: String(page) }
      })
      files.push(...batch)
      if (batch.length < 100) break
    }
    return files
  }

  private async json<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const res = await this.request(path, options)
    return (await res.json()) as T
  }

  private async request(path: string, options: RequestOptions = {}): Promise<Response> {
    const url = new URL(this.baseUrl + path)
    for (const [key, value] of Object.entries(options.query ?? {})) {
      url.searchParams.set(key, value)
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: options.accept ?? 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }
    if (options.body !== undefined) headers['Content-Type'] = 'application/json'

    let res: Response
    try {
      res = await fetch(url, {
        method: options.method ?? 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new GitHubError(0, `Could not reach GitHub (${reason})`)
    }
    if (res.ok) return res

    const text = await res.text()
    let body: GitHubErrorBody | null = null
    try {
      body = JSON.parse(text) as GitHubErrorBody
    } catch {
      body = null
    }
    throw new GitHubError(res.status, describeErrorBody(res.status, body, res.statusText))
  }
}

function repoPath(ref: PullRef): string {
  return `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`
}
