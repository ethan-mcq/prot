import type {
  ChatMessage,
  ChatRequest,
  DiffSide,
  DraftComment,
  PullRef,
  ReviewEvent,
  ReviewInput,
  ViewContext
} from '@shared/types'

type Obj = Record<string, unknown>

function obj(value: unknown, what: string): Obj {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${what} must be an object`)
  }
  return value as Obj
}

function str(value: unknown, what: string): string {
  if (typeof value !== 'string') throw new Error(`${what} must be a string`)
  return value
}

function nonEmptyStr(value: unknown, what: string): string {
  const text = str(value, what)
  if (text === '') throw new Error(`${what} must not be empty`)
  return text
}

function strOrNull(value: unknown, what: string): string | null {
  return value === null ? null : str(value, what)
}

function int(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`${what} must be an integer`)
  }
  return value
}

function list(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${what} must be an array`)
  return value
}

function oneOf<T extends string>(value: unknown, options: readonly T[], what: string): T {
  const match = options.find((option) => option === value)
  if (match === undefined) throw new Error(`${what} must be one of ${options.join(', ')}`)
  return match
}

const PATH_SAFE = /^[A-Za-z0-9._-]+$/

export function parsePullRef(raw: unknown): PullRef {
  const value = obj(raw, 'Pull request reference')
  const owner = str(value.owner, 'owner')
  const repo = str(value.repo, 'repo')
  const number = int(value.number, 'number')
  if (!PATH_SAFE.test(owner) || !PATH_SAFE.test(repo)) throw new Error('Invalid owner or repo name')
  if (number < 1) throw new Error('Pull request number must be positive')
  return { owner, repo, number }
}

export function parseSha(raw: unknown): string {
  const sha = str(raw, 'sha')
  if (!PATH_SAFE.test(sha)) throw new Error('Invalid commit sha')
  return sha
}

const REVIEW_EVENTS: readonly ReviewEvent[] = ['APPROVE', 'REQUEST_CHANGES', 'COMMENT']
const SIDES: readonly DiffSide[] = ['LEFT', 'RIGHT']

function parseDraftComment(raw: unknown): DraftComment {
  const value = obj(raw, 'Draft comment')
  return {
    id: str(value.id, 'comment id'),
    path: nonEmptyStr(value.path, 'comment path'),
    line: int(value.line, 'comment line'),
    side: oneOf(value.side, SIDES, 'comment side'),
    body: str(value.body, 'comment body')
  }
}

export function parseReviewInput(raw: unknown): ReviewInput {
  const value = obj(raw, 'Review')
  return {
    commitId: parseSha(value.commitId),
    event: oneOf(value.event, REVIEW_EVENTS, 'Review event'),
    body: str(value.body, 'Review body'),
    comments: list(value.comments, 'Review comments').map(parseDraftComment)
  }
}

function parseChatMessage(raw: unknown): ChatMessage {
  const value = obj(raw, 'Chat message')
  return {
    role: oneOf(value.role, ['user', 'assistant'] as const, 'Chat role'),
    content: str(value.content, 'Chat content')
  }
}

function parseChapter(raw: unknown): NonNullable<ViewContext['chapter']> {
  const value = obj(raw, 'chapter')
  return {
    id: str(value.id, 'chapter id'),
    title: str(value.title, 'chapter title'),
    summary: str(value.summary, 'chapter summary'),
    files: list(value.files, 'chapter files').map((file) => str(file, 'chapter file'))
  }
}

function parseFlow(raw: unknown): NonNullable<ViewContext['flow']> {
  const value = obj(raw, 'flow')
  const nodes = list(value.nodes, 'flow nodes').map((node) => {
    const fields = obj(node, 'flow node')
    return {
      id: str(fields.id, 'flow node id'),
      label: str(fields.label, 'flow node label'),
      file: strOrNull(fields.file, 'flow node file'),
      change: oneOf(fields.change, ['added', 'modified', 'context'] as const, 'flow node change'),
      chapterId: strOrNull(fields.chapterId, 'flow node chapterId')
    }
  })
  const edges = list(value.edges, 'flow edges').map((edge) => {
    const fields = obj(edge, 'flow edge')
    return { from: str(fields.from, 'flow edge from'), to: str(fields.to, 'flow edge to') }
  })
  return { caption: str(value.caption, 'flow caption'), nodes, edges }
}

function parseStep(raw: unknown): NonNullable<ViewContext['step']> {
  const value = obj(raw, 'step')
  const kind = oneOf(value.kind, ['overview', 'flow', 'chapter'] as const, 'step kind')
  if (kind === 'chapter') return { kind, index: int(value.index, 'step index') }
  return { kind }
}

function parseFile(raw: unknown): NonNullable<ViewContext['file']> {
  const value = obj(raw, 'file')
  let visibleLines: [number, number] | null = null
  if (value.visibleLines !== null) {
    const range = list(value.visibleLines, 'visibleLines')
    if (range.length !== 2) throw new Error('visibleLines must have two entries')
    visibleLines = [int(range[0], 'visibleLines start'), int(range[1], 'visibleLines end')]
  }
  return {
    path: str(value.path, 'file path'),
    patch: strOrNull(value.patch, 'file patch'),
    visibleLines
  }
}

function parseViewContext(raw: unknown): ViewContext {
  const value = obj(raw, 'Chat context')
  let pull: ViewContext['pull'] = null
  if (value.pull !== null) {
    const fields = obj(value.pull, 'context pull')
    pull = {
      ref: parsePullRef(fields.ref),
      title: str(fields.title, 'pull title'),
      author: str(fields.author, 'pull author'),
      body: str(fields.body, 'pull body')
    }
  }
  return {
    pull,
    step: value.step === null ? null : parseStep(value.step),
    chapter: value.chapter === null ? null : parseChapter(value.chapter),
    flow: value.flow === null ? null : parseFlow(value.flow),
    file: value.file === null ? null : parseFile(value.file),
    selection: strOrNull(value.selection, 'selection')
  }
}

export function parseChatRequest(raw: unknown): ChatRequest {
  const value = obj(raw, 'Chat request')
  const messages = list(value.messages, 'Chat messages').map(parseChatMessage)
  const last = messages[messages.length - 1]
  if (!last || last.role !== 'user') throw new Error('Chat messages must end with a user message')
  return {
    id: nonEmptyStr(value.id, 'Chat id'),
    messages,
    context: parseViewContext(value.context)
  }
}

export function parseHttpsUrl(raw: unknown): string {
  const text = str(raw, 'url')
  let url: URL
  try {
    url = new URL(text)
  } catch {
    throw new Error('Invalid URL')
  }
  if (url.protocol !== 'https:') throw new Error('Only https links can be opened')
  return url.href
}

export function parseToken(raw: unknown): string {
  return nonEmptyStr(str(raw, 'token').trim(), 'token')
}

export function parseAnthropicKey(raw: unknown): string | null {
  if (raw === null) return null
  const key = str(raw, 'API key').trim()
  return key === '' ? null : key
}
