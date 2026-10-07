export type PullRef = { owner: string; repo: string; number: number }

export function pullKey(ref: PullRef): string {
  return `${ref.owner}/${ref.repo}#${ref.number}`
}

export type GitHubUser = { login: string; avatarUrl: string }

export type PullBucket = 'review' | 'mine'

export type PullSummary = {
  ref: PullRef
  title: string
  author: GitHubUser
  url: string
  draft: boolean
  createdAt: string
  updatedAt: string
  bucket: PullBucket
  comments: number
  labels: { name: string; color: string }[]
}

export type FileStatus = 'added' | 'modified' | 'removed' | 'renamed'

export type ChangedFile = {
  path: string
  previousPath: string | null
  status: FileStatus
  additions: number
  deletions: number
  patch: string | null
}

export type DiffSide = 'LEFT' | 'RIGHT'

export type ReviewComment = {
  id: number
  path: string
  line: number | null
  side: DiffSide
  body: string
  author: GitHubUser
  createdAt: string
  inReplyToId: number | null
  url: string
}

export type ReviewState = 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING'

export type Review = {
  id: number
  author: GitHubUser
  state: ReviewState
  body: string
  submittedAt: string | null
}

export type PullDetail = {
  summary: PullSummary
  body: string
  base: { ref: string; sha: string }
  head: { ref: string; sha: string }
  additions: number
  deletions: number
  files: ChangedFile[]
  reviewComments: ReviewComment[]
  reviews: Review[]
}

export type ReviewEvent = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'

export type DraftComment = {
  id: string
  path: string
  line: number
  side: DiffSide
  body: string
}

export type ReviewInput = {
  commitId: string
  event: ReviewEvent
  body: string
  comments: DraftComment[]
}

export type DiffLineKind = 'context' | 'add' | 'del'

export type DiffLine = {
  kind: DiffLineKind
  oldLine: number | null
  newLine: number | null
  text: string
}

export type DiffHunk = {
  header: string
  section: string | null
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: DiffLine[]
}

export type FileRole =
  | 'core'
  | 'ui'
  | 'config'
  | 'build'
  | 'docs'
  | 'test'
  | 'schema'
  | 'generated'
  | 'deps'
  | 'assets'

export type FlowNodeChange = 'added' | 'modified' | 'context'

export type FlowNode = {
  id: string
  label: string
  file: string | null
  change: FlowNodeChange
  chapterId: string | null
}

export type FlowEdge = { from: string; to: string }

export type Flow = {
  caption: string
  nodes: FlowNode[]
  edges: FlowEdge[]
}

export type Chapter = {
  id: string
  title: string
  summary: string
  files: string[]
}

export type GuideSource = 'heuristic' | 'ai'

export type Guide = {
  source: GuideSource
  headSha: string
  overview: { summary: string; points: string[] }
  flow: Flow
  chapters: Chapter[]
}

export type GuideStep =
  | { kind: 'overview' }
  | { kind: 'flow' }
  | { kind: 'chapter'; index: number }

export type AuthSource = 'gh' | 'token'

export type AuthState =
  | { status: 'signed_out'; error: string | null }
  | { status: 'signed_in'; user: GitHubUser; source: AuthSource }

export type InboxState = {
  pulls: PullSummary[]
  fetchedAt: string | null
  error: string | null
}

export const AI_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5'] as const
export type AiModel = (typeof AI_MODELS)[number]

export type Theme = 'system' | 'light' | 'dark'

export type Settings = {
  theme: Theme
  pollSeconds: number
  model: AiModel
  notify: boolean
  autoAiGuide: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  pollSeconds: 60,
  model: 'claude-opus-5-5',
  notify: true,
  autoAiGuide: true
}

export type KeysState = { anthropic: boolean }

export type ViewContext = {
  pull: { ref: PullRef; title: string; author: string; body: string } | null
  step: GuideStep | null
  chapter: Chapter | null
  flow: Flow | null
  file: { path: string; patch: string | null; visibleLines: [number, number] | null } | null
  selection: string | null
}

export type ChatMessage = { role: 'user' | 'assistant'; content: string }

export type ChatRequest = {
  id: string
  messages: ChatMessage[]
  context: ViewContext
}

export type ChatEvent =
  | { id: string; type: 'delta'; text: string }
  | { id: string; type: 'done' }
  | { id: string; type: 'error'; message: string }
