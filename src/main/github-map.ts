import {
  pullKey,
  type ChangedFile,
  type DiffSide,
  type FileStatus,
  type GitHubUser,
  type PullBucket,
  type PullDetail,
  type PullRef,
  type PullSummary,
  type Review,
  type ReviewComment,
  type ReviewState
} from '@shared/types'

export type RawUser = { login: string; avatar_url: string } | null
type RawLabel = { name: string; color: string }

export type RawSearchItem = {
  number: number
  title: string
  user: RawUser
  html_url: string
  draft?: boolean
  created_at: string
  updated_at: string
  comments: number
  labels: RawLabel[]
  repository_url: string
}

export type RawPull = {
  title: string
  body: string | null
  user: RawUser
  html_url: string
  draft?: boolean
  created_at: string
  updated_at: string
  comments: number
  labels: RawLabel[]
  base: { ref: string; sha: string }
  head: { ref: string; sha: string }
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

export function parseRepositoryUrl(url: string): { owner: string; repo: string } {
  const match = /\/repos\/([^/]+)\/([^/]+)\/?$/.exec(url)
  if (!match) throw new Error(`Unexpected repository_url from GitHub: ${url}`)
  return { owner: match[1] as string, repo: match[2] as string }
}

export function toPullSummary(item: RawSearchItem, bucket: PullBucket): PullSummary {
  const { owner, repo } = parseRepositoryUrl(item.repository_url)
  return {
    ref: { owner, repo, number: item.number },
    title: item.title,
    author: toUser(item.user),
    url: item.html_url,
    draft: item.draft ?? false,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    bucket,
    comments: item.comments,
    labels: item.labels.map((label) => ({ name: label.name, color: label.color }))
  }
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

export function toPullDetail(
  ref: PullRef,
  viewerLogin: string,
  raw: RawPull,
  files: RawFile[],
  comments: RawReviewComment[],
  reviews: RawReview[]
): PullDetail {
  return {
    summary: {
      ref,
      title: raw.title,
      author: toUser(raw.user),
      url: raw.html_url,
      draft: raw.draft ?? false,
      createdAt: raw.created_at,
      updatedAt: raw.updated_at,
      bucket: raw.user?.login === viewerLogin ? 'mine' : 'review',
      comments: raw.comments,
      labels: raw.labels.map((label) => ({ name: label.name, color: label.color }))
    },
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
