import type { AgentPr, AgentPrState } from '@shared/agents'
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
  graphqlUrl,
  descriptionAttachments,
  mergeBuckets,
  toPullDetail,
  toPullsResult,
  toRestSummary,
  toReviewComment,
  toSearchResult,
  toUser,
  type RawFile,
  type RawPull,
  type RawPullsResponse,
  type RawReview,
  type RawReviewComment,
  type RawSearchResponse,
  type RawUser
} from './github-map'
import { webOrigin, type AttachmentLink } from './attachment-links'

const MAX_FILE_PAGES = 30
// Adds body_html, whose image links are signed and fetchable, next to the raw markdown body.
const FULL_JSON = 'application/vnd.github.full+json'
const REQUEST_TIMEOUT_MS = 30_000
// Keeps each aliased query well under GitHub's per-query node and complexity limits.
const PULLS_PER_QUERY = 30

const SEARCH_QUERIES: Record<'review' | 'mine', string> = {
  review: 'is:pr is:open archived:false review-requested:@me sort:updated-desc',
  mine: 'is:pr is:open archived:false author:@me sort:updated-desc'
}

const PULL_FIELDS = `fragment PullFields on PullRequest {
  number
  title
  url
  isDraft
  state
  createdAt
  updatedAt
  baseRefName
  headRefName
  isCrossRepository
  repository { nameWithOwner defaultBranchRef { name } }
  author { login avatarUrl }
  comments { totalCount }
  labels(first: 10) { nodes { name color } }
}`

const INBOX_QUERY = `query Inbox($q: String!) {
  search(query: $q, type: ISSUE, first: 50) {
    nodes { __typename ...PullFields }
  }
}
${PULL_FIELDS}`

function pullsQuery(count: number): string {
  const params: string[] = []
  const fields: string[] = []
  for (let i = 0; i < count; i++) {
    params.push(`$o${i}: String!, $r${i}: String!, $n${i}: Int!`)
    fields.push(`p${i}: repository(owner: $o${i}, name: $r${i}) { pullRequest(number: $n${i}) { ...PullFields } }`)
  }
  return `query Pulls(${params.join(', ')}) {\n  ${fields.join('\n  ')}\n}\n${PULL_FIELDS}`
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

  async getPull(ref: PullRef, viewerLogin: string): Promise<{ detail: PullDetail; attachments: AttachmentLink[] }> {
    const base = repoPath(ref)
    const list = { query: { per_page: '100' } }
    const [raw, files, comments, reviews] = await Promise.all([
      this.json<RawPull>(`${base}/pulls/${ref.number}`, { accept: FULL_JSON }),
      this.listFiles(ref),
      this.json<RawReviewComment[]>(`${base}/pulls/${ref.number}/comments`, list),
      this.json<RawReview[]>(`${base}/pulls/${ref.number}/reviews`, list)
    ])
    return {
      detail: toPullDetail(ref, viewerLogin, raw, files, comments, reviews),
      attachments: descriptionAttachments(raw, webOrigin(this.baseUrl))
    }
  }

  // Only GitHub's own hosts get the token. Signed githubusercontent URLs need none, and other hosts must never see it.
  attachmentHeaders(url: URL): Record<string, string> {
    if (url.origin !== new URL(this.baseUrl).origin && url.origin !== webOrigin(this.baseUrl)) return {}
    return { Authorization: `Bearer ${this.token}` }
  }

  async getPullSummary(ref: PullRef, bucket: PullBucket): Promise<PullSummary> {
    return toRestSummary(await this.json<RawPull>(`${repoPath(ref)}/pulls/${ref.number}`), bucket)
  }

  // Keyed by pullKey of the requested ref; see toPullsResult for what null and absent mean.
  async getPulls(refs: PullRef[], bucket: PullBucket): Promise<Map<string, PullSummary | null>> {
    const pulls = new Map<string, PullSummary | null>()
    for (let start = 0; start < refs.length; start += PULLS_PER_QUERY) {
      const chunk = refs.slice(start, start + PULLS_PER_QUERY)
      const variables: Record<string, string | number> = {}
      for (const [i, ref] of chunk.entries()) {
        variables[`o${i}`] = ref.owner
        variables[`r${i}`] = ref.repo
        variables[`n${i}`] = ref.number
      }
      const raw = await this.json<RawPullsResponse>(new URL(graphqlUrl(this.baseUrl)), {
        method: 'POST',
        body: { query: pullsQuery(chunk.length), variables }
      })
      const result = toPullsResult(raw, chunk, bucket)
      if ('error' in result) throw new GitHubError(200, result.error)
      for (const [key, pull] of result.pulls) pulls.set(key, pull)
    }
    return pulls
  }

  // The newest PR from owner:branch in any state, or null.
  async findPullByBranch(owner: string, repo: string, branch: string): Promise<AgentPr | null> {
    const raw = await this.json<RawPull[]>(`${repoPath({ owner, repo, number: 0 })}/pulls`, {
      query: { head: `${owner}:${branch}`, state: 'all', per_page: '1' }
    })
    const pull = raw[0]
    if (!pull) return null
    let state: AgentPrState = 'open'
    if (pull.merged_at) state = 'merged'
    else if (pull.state === 'closed') state = 'closed'
    else if (pull.draft) state = 'draft'
    return { owner, repo, number: pull.number, title: pull.title, state, url: pull.html_url }
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

  private async search(bucket: 'review' | 'mine'): Promise<PullSummary[]> {
    const raw = await this.json<RawSearchResponse>(new URL(graphqlUrl(this.baseUrl)), {
      method: 'POST',
      body: { query: INBOX_QUERY, variables: { q: SEARCH_QUERIES[bucket] } }
    })
    const result = toSearchResult(raw, bucket)
    if ('error' in result) throw new GitHubError(200, result.error)
    return result.pulls
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

  private async json<T>(path: string | URL, options: RequestOptions = {}): Promise<T> {
    const res = await this.request(path, options)
    return (await res.json()) as T
  }

  private async request(path: string | URL, options: RequestOptions = {}): Promise<Response> {
    const url = typeof path === 'string' ? new URL(this.baseUrl + path) : path
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
