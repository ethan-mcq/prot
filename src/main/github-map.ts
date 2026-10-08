import {
  pullKey,
  type ChangedFile,
  type DiffSide,
  type FileStatus,
  type GitHubUser,
  type PullBucket,
  type PullDetail,
  type PullRef,
  type PullState,
  type PullSummary,
  type Review,
  type ReviewComment,
  type ReviewState
} from '@shared/types'
import { attachmentLinks, type AttachmentLink } from './attachment-links'

export type RawUser = { login: string; avatar_url: string; type?: string } | null
type RawLabel = { name: string; color: string }

export type RawGraphqlPull = {
  __typename: 'PullRequest'
  number: number
  title: string
  url: string
  isDraft: boolean
  state: 'OPEN' | 'CLOSED' | 'MERGED'
  createdAt: string
  updatedAt: string
  baseRefName: string
  headRefName: string
  isCrossRepository: boolean
  repository: { nameWithOwner: string; defaultBranchRef: { name: string } | null }
  author: { login: string; avatarUrl: string } | null
  comments: { totalCount: number }
  labels: { nodes: RawLabel[] } | null
}

export type RawSearchResponse = {
  // Search hits the token cannot see come back as null.
  data?: { search: { nodes: (RawGraphqlPull | { __typename: 'Issue' } | null)[] } } | null
  errors?: { message: string }[]
}

// Aliases p0..pN, one per requested pull. A missing repo nulls the alias, a missing pull nulls pullRequest.
export type RawPullsResponse = {
  data?: Record<string, { pullRequest: RawGraphqlPull | null } | null> | null
  errors?: { message: string; type?: string; path?: (string | number)[] }[]
}

export type RawPull = {
  number: number
  state: 'open' | 'closed'
  merged_at: string | null
  title: string
  body: string | null
  body_html?: string | null
  user: RawUser
  html_url: string
  draft?: boolean
  created_at: string
  updated_at: string
  comments: number
  labels: RawLabel[]
  base: { ref: string; sha: string; repo: { full_name: string; default_branch: string } }
  head: { ref: string; sha: string; repo: { full_name: string } | null }
  additions: number
  deletions: number
}

export type RawFile = {
  filename: string
  previous_filename?: string
  status: string
  additions: number
  deletions: number
  patch?: string
}

export type RawReviewComment = {
  id: number
  path: string
  line?: number | null
  side?: string | null
  body: string
  user: RawUser
  created_at: string
  in_reply_to_id?: number | null
  html_url: string
}

export type RawReview = {
  id: number
  user: RawUser
  state: string
  body: string | null
  submitted_at?: string | null
}

// GitHub returns null for deleted accounts.
export function toUser(raw: RawUser): GitHubUser {
  if (!raw) return { login: 'ghost', avatarUrl: '' }
  return { login: raw.login, avatarUrl: raw.avatar_url }
}

export function graphqlUrl(restBaseUrl: string): string {
  const base = restBaseUrl.replace(/\/+$/, '')
  if (base.endsWith('/api/v3')) return `${base.slice(0, -'/v3'.length)}/graphql`
  return `${base}/graphql`
}

function stackableHead(head: string, crossRepository: boolean, defaultBranch: string | null): string | null {
  if (crossRepository || head === defaultBranch) return null
  return head
}

const GRAPHQL_STATES: Record<RawGraphqlPull['state'], PullState> = { OPEN: 'open', CLOSED: 'closed', MERGED: 'merged' }

function toPullSummary(node: RawGraphqlPull, bucket: PullBucket): PullSummary {
  const [owner = '', repo = ''] = node.repository.nameWithOwner.split('/')
  const author = node.author && { login: node.author.login, avatar_url: node.author.avatarUrl }
  return {
    ref: { owner, repo, number: node.number },
    title: node.title,
    author: toUser(author),
    url: node.url,
    draft: node.isDraft,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    bucket,
    state: GRAPHQL_STATES[node.state],
    comments: node.comments.totalCount,
    labels: (node.labels?.nodes ?? []).map((label) => ({ name: label.name, color: label.color })),
    baseRef: node.baseRefName,
    headRef: stackableHead(node.headRefName, node.isCrossRepository, node.repository.defaultBranchRef?.name ?? null)
  }
}

export type SearchResult = { pulls: PullSummary[] } | { error: string }

export function toSearchResult(response: RawSearchResponse, bucket: PullBucket): SearchResult {
  // Partial data with errors (e.g. one org behind SAML) keeps the PRs we can see.
  if (!response.data?.search) {
    const messages = (response.errors ?? []).map((error) => error.message)
    return { error: `GitHub GraphQL: ${messages.join('; ') || 'empty response'}` }
  }
  const pulls: PullSummary[] = []
  for (const node of response.data.search.nodes) {
    if (node?.__typename === 'PullRequest') pulls.push(toPullSummary(node, bucket))
  }
  return { pulls }
}

export type PullsResult = { pulls: Map<string, PullSummary | null> } | { error: string }

// Null marks a pull GitHub says does not exist. A pull left out of the map is unknown (e.g. FORBIDDEN behind SAML),
// so callers must not treat it as gone.
export function toPullsResult(response: RawPullsResponse, refs: PullRef[], bucket: PullBucket): PullsResult {
  if (!response.data) {
    const messages = (response.errors ?? []).map((error) => error.message)
    return { error: `GitHub GraphQL: ${messages.join('; ') || 'empty response'}` }
  }
  const notFound = new Set<unknown>()
  for (const error of response.errors ?? []) {
    if (error.type === 'NOT_FOUND') notFound.add(error.path?.[0])
  }
  const pulls = new Map<string, PullSummary | null>()
  for (const [i, ref] of refs.entries()) {
    const alias = `p${i}`
    const node = response.data[alias]?.pullRequest
    if (node) pulls.set(pullKey(ref), toPullSummary(node, bucket))
    else if (notFound.has(alias)) pulls.set(pullKey(ref), null)
  }
  return { pulls }
}

export function mergeBuckets(review: PullSummary[], mine: PullSummary[]): PullSummary[] {
  const seen = new Set<string>()
  const merged: PullSummary[] = []
  for (const pull of review) {
    seen.add(pullKey(pull.ref))
    merged.push(pull)
  }
  for (const pull of mine) {
    if (seen.has(pullKey(pull.ref))) continue
    merged.push(pull)
  }
  return merged
}

function toFileStatus(status: string): FileStatus {
  if (status === 'added' || status === 'removed' || status === 'renamed') return status
  return 'modified'
}

export function toChangedFile(raw: RawFile): ChangedFile {
  return {
    path: raw.filename,
    previousPath: raw.previous_filename ?? null,
    status: toFileStatus(raw.status),
    additions: raw.additions,
    deletions: raw.deletions,
    patch: raw.patch ?? null
  }
}

export function toReviewComment(raw: RawReviewComment): ReviewComment {
  const side: DiffSide = raw.side === 'LEFT' ? 'LEFT' : 'RIGHT'
  return {
    id: raw.id,
    path: raw.path,
    line: raw.line ?? null,
    side,
    body: raw.body,
    author: toUser(raw.user),
    createdAt: raw.created_at,
    inReplyToId: raw.in_reply_to_id ?? null,
    url: raw.html_url
  }
}

const REVIEW_STATES: readonly ReviewState[] = [
  'APPROVED',
  'CHANGES_REQUESTED',
  'COMMENTED',
  'DISMISSED',
  'PENDING'
]

export function toReview(raw: RawReview): Review {
  const state = REVIEW_STATES.find((candidate) => candidate === raw.state) ?? 'COMMENTED'
  return {
    id: raw.id,
    author: toUser(raw.user),
    state,
    body: raw.body ?? '',
    submittedAt: raw.submitted_at ?? null
  }
}

function restState(raw: RawPull): PullState {
  if (raw.merged_at !== null) return 'merged'
  return raw.state
}

export function toRestSummary(raw: RawPull, bucket: PullBucket): PullSummary {
  const [owner = '', repo = ''] = raw.base.repo.full_name.split('/')
  return {
    ref: { owner, repo, number: raw.number },
    title: raw.title,
    author: toUser(raw.user),
    url: raw.html_url,
    draft: raw.draft ?? false,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    bucket,
    state: restState(raw),
    comments: raw.comments,
    labels: raw.labels.map((label) => ({ name: label.name, color: label.color })),
    baseRef: raw.base.ref,
    headRef: stackableHead(raw.head.ref, raw.head.repo?.full_name !== raw.base.repo.full_name, raw.base.repo.default_branch)
  }
}

export function toPullDetail(
  ref: PullRef,
  viewerLogin: string,
  raw: RawPull,
  files: RawFile[],
  comments: RawReviewComment[],
  reviews: RawReview[]
): PullDetail {
  return {
    summary: { ...toRestSummary(raw, raw.user?.login === viewerLogin ? 'mine' : 'review'), ref },
    body: raw.body ?? '',
    base: { ref: raw.base.ref, sha: raw.base.sha },
    head: { ref: raw.head.ref, sha: raw.head.sha },
    additions: raw.additions,
    deletions: raw.deletions,
    files: files.map(toChangedFile),
    reviewComments: comments.map(toReviewComment),
    reviews: reviews.map(toReview)
  }
}

function isBot(user: RawUser): boolean {
  return user !== null && (user.type === 'Bot' || user.login.endsWith('[bot]'))
}

// Only a person's PR description is read for attachments; comments and bot-written descriptions never are.
export function descriptionAttachments(raw: RawPull, web: string): AttachmentLink[] {
  if (isBot(raw.user)) return []
  return attachmentLinks(raw.body_html ?? null, raw.body ?? '', web)
}
