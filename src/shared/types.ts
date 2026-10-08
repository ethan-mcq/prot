export type PullRef = { owner: string; repo: string; number: number }

export function pullKey(ref: PullRef): string {
  return `${ref.owner}/${ref.repo}#${ref.number}`
}

export type GitHubUser = { login: string; avatarUrl: string }

export type PullBucket = 'review' | 'mine' | 'manual'

export type PullState = 'open' | 'closed' | 'merged'

export type PullSummary = {
  ref: PullRef
  title: string
  author: GitHubUser
  url: string
  draft: boolean
  createdAt: string
  updatedAt: string
  bucket: PullBucket
  state: PullState
  comments: number
  labels: { name: string; color: string }[]
  baseRef: string
  // Null when no PR can stack on this head: a fork's branch, or the repo's default branch,
  // which would otherwise make a release PR (dev → main) the parent of every PR into dev.
  headRef: string | null
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

export type DiffLocation = { path: string; line: number; side: DiffSide }

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

export type SymbolKind =
  | 'function'
  | 'method'
  | 'class'
  | 'interface'
  | 'type'
  | 'enum'
  | 'constant'
  | 'test'
  | 'module'

export type CodeChange = 'added' | 'modified' | 'deleted' | 'context'

export type LineRange = { start: number; end: number }

export type CodeSymbol = {
  id: string
  path: string
  name: string
  qualifiedName: string
  kind: SymbolKind
  parentId: string | null
  head: LineRange | null
  base: LineRange | null
  change: CodeChange
  calls: string[]
  callLines: Record<string, number[]>
  decorators: string[]
}

export type CodeIndex = {
  headSha: string
  symbols: CodeSymbol[]
  skipped: string[]
}

export type CardRole = 'entry' | 'step' | 'helper' | 'data' | 'test'

export type StoryCard = {
  symbolId: string
  role: CardRole
  seeChapterId: string | null
  excerpt: LineRange[] | null
}

export type FlowNodeChange = 'added' | 'modified' | 'context'

export type FlowNode = {
  id: string
  label: string
  file: string | null
  change: FlowNodeChange
  chapterId: string | null
  symbolId: string | null
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
  cards: StoryCard[]
}

export type FileFingerprint = { hash: string; additions: number; deletions: number }

export type GuideCoverage = Record<string, FileFingerprint>

export const RISK_LEVELS = ['low', 'medium', 'high'] as const
export type RiskLevel = (typeof RISK_LEVELS)[number]

export type GuideOverview = {
  risk: RiskLevel
  // One sentence on what the whole pull request sets out to do.
  goal: string
}

type GuideContent = {
  headSha: string
  overview: GuideOverview
  questions: string[]
  flow: Flow
  chapters: Chapter[]
  symbols: Record<string, CodeSymbol>
}

export type Guide =
  | (GuideContent & { source: 'heuristic' })
  | (GuideContent & { source: 'ai'; coverage: GuideCoverage; promptHash: string })

export type DriftReason =
  | { kind: 'uncovered-file'; path: string }
  | { kind: 'removed-file'; path: string }
  | { kind: 'line-share'; lines: number; covered: number }

export type GuideDrift =
  | { kind: 'fresh' }
  | { kind: 'minor'; changed: string[]; added: string[]; sinceSha: string }
  | {
      kind: 'significant'
      changed: string[]
      added: string[]
      removed: string[]
      reasons: DriftReason[]
      additions: number
      deletions: number
      sinceSha: string
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

export const AI_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'] as const
export type AiModel = (typeof AI_MODELS)[number]

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type Effort = (typeof EFFORTS)[number]

export type Theme = 'system' | 'light' | 'dark'

export const OUTPUT_STYLES = ['concise', 'default'] as const
export type OutputStyle = (typeof OUTPUT_STYLES)[number]

export type Settings = {
  theme: Theme
  pollSeconds: number
  model: AiModel
  chatEffort: Effort
  outputStyle: OutputStyle
  notify: boolean
  autoAiGuide: boolean
  autoRefreshStaleGuides: boolean
  // Folder with the skills and AGENTS.md every agent gets.
  agentFolder: string | null
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  pollSeconds: 60,
  model: 'claude-haiku-5-5',
  chatEffort: 'medium',
  outputStyle: 'concise',
  notify: true,
  autoAiGuide: true,
  autoRefreshStaleGuides: false,
  agentFolder: null
}

export type KeysState = { anthropic: boolean }

export type ViewContext = {
  pull: { ref: PullRef; author: string } | null
  story: StoryContext | null
  step: GuideStep | null
  chapter: Chapter | null
  flow: Flow | null
  file: { path: string; patch: string | null; visibleLines: [number, number] | null } | null
  section: SectionContext | null
  selection: string | null
}

export type CardContext = {
  qualifiedName: string
  kind: SymbolKind
  path: string
  lines: LineRange | null
  change: CodeChange
}

export type SectionContext = {
  cards: CardContext[]
  focused: { qualifiedName: string; path: string; code: string } | null
}

export type OutlineSection = { title: string; cards: CardContext[]; files: string[] }

export type StoryContext = {
  risk: RiskLevel
  goal: string
  sections: OutlineSection[]
}

export type ChatMessage = { role: 'user' | 'assistant'; content: string }

export type ChatRequest = {
  id: string
  messages: ChatMessage[]
  context: ViewContext
  // The chat prompt version the thread started with; absent means the live one.
  promptHash?: string
}

export type ChatEvent =
  | { id: string; type: 'delta'; text: string }
  | { id: string; type: 'done' }
  | { id: string; type: 'error'; message: string }

export type AttachmentKind = 'image' | 'video' | 'file'

export type AttachmentStatus = 'importing' | 'ready' | 'link-only' | 'failed'

export type Attachment = {
  url: string
  name: string
  size: number | null
  kind: AttachmentKind
  status: AttachmentStatus
  // A prot-attachment: URL for a ready image or video.
  src: string | null
}
