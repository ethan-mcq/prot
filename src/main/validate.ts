import { isAbsolute } from 'node:path'
import {
  AGENT_PROVIDERS,
  ATTACHMENT_MAX_BYTES,
  ATTACHMENTS_PER_TURN,
  type AgentAttachment,
  type AgentOpenTarget,
  type AgentStartInput
} from '@shared/agents'
import { PROMPT_HASH, PROMPT_KINDS, PROMPT_NAME_MAX, PROMPT_TEXT_MAX, type PromptKind } from '@shared/prompts'
import { RISK_LEVELS } from '@shared/types'
import { PERMISSIONS } from './agents/cli'
import type {
  CardContext,
  CardRole,
  ChatMessage,
  CodeChange,
  LineRange,
  SectionContext,
  StoryCard,
  StoryContext,
  SymbolKind,
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
  // `.` and `..` would resolve away when joined into a REST path.
  if (/^\.+$/.test(owner) || /^\.+$/.test(repo)) throw new Error('Invalid owner or repo name')
  if (number < 1) throw new Error('Pull request number must be positive')
  return { owner, repo, number }
}

export function parseCommentId(raw: unknown): number {
  const id = int(raw, 'comment id')
  if (id < 1) throw new Error('comment id must be positive')
  return id
}

export function parseReplyBody(raw: unknown): string {
  const body = str(raw, 'Reply')
  if (body.trim() === '') throw new Error('Reply must not be empty')
  return body
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

const CARD_ROLES: readonly CardRole[] = ['entry', 'step', 'helper', 'data', 'test']
const SYMBOL_KINDS: readonly SymbolKind[] = [
  'function',
  'method',
  'class',
  'interface',
  'type',
  'enum',
  'constant',
  'test',
  'module'
]
const CODE_CHANGES: readonly CodeChange[] = ['added', 'modified', 'deleted', 'context']

function parseRange(raw: unknown, what: string): LineRange {
  const value = obj(raw, what)
  return { start: int(value.start, `${what} start`), end: int(value.end, `${what} end`) }
}

function parseCard(raw: unknown): StoryCard {
  const value = obj(raw, 'card')
  return {
    symbolId: str(value.symbolId, 'card symbolId'),
    role: oneOf(value.role, CARD_ROLES, 'card role'),
    seeChapterId: strOrNull(value.seeChapterId, 'card seeChapterId'),
    excerpt: value.excerpt === null ? null : list(value.excerpt, 'card excerpt').map((range) => parseRange(range, 'excerpt'))
  }
}

function parseChapter(raw: unknown): NonNullable<ViewContext['chapter']> {
  const value = obj(raw, 'chapter')
  return {
    id: str(value.id, 'chapter id'),
    title: str(value.title, 'chapter title'),
    summary: str(value.summary, 'chapter summary'),
    files: list(value.files, 'chapter files').map((file) => str(file, 'chapter file')),
    cards: list(value.cards, 'chapter cards').map(parseCard)
  }
}

function parseCardContext(raw: unknown): CardContext {
  const value = obj(raw, 'section card')
  return {
    qualifiedName: str(value.qualifiedName, 'card name'),
    kind: oneOf(value.kind, SYMBOL_KINDS, 'card kind'),
    path: str(value.path, 'card path'),
    lines: value.lines === null ? null : parseRange(value.lines, 'card lines'),
    change: oneOf(value.change, CODE_CHANGES, 'card change')
  }
}

function parseSection(raw: unknown): SectionContext {
  const value = obj(raw, 'section')
  let focused: SectionContext['focused'] = null
  if (value.focused !== null) {
    const fields = obj(value.focused, 'focused card')
    focused = {
      qualifiedName: str(fields.qualifiedName, 'focused card name'),
      path: str(fields.path, 'focused card path'),
      code: str(fields.code, 'focused card code')
    }
  }
  return { cards: list(value.cards, 'section cards').map(parseCardContext), focused }
}

function parseStory(raw: unknown): StoryContext {
  const value = obj(raw, 'story')
  const sections = list(value.sections, 'story sections').map((section) => {
    const fields = obj(section, 'story section')
    return {
      title: str(fields.title, 'story section title'),
      cards: list(fields.cards, 'story section cards').map(parseCardContext),
      files: list(fields.files, 'story section files').map((file) => str(file, 'story section file'))
    }
  })
  return {
    risk: oneOf(value.risk, RISK_LEVELS, 'risk level'),
    goal: str(value.goal, 'story goal'),
    sections
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
      chapterId: strOrNull(fields.chapterId, 'flow node chapterId'),
      symbolId: strOrNull(fields.symbolId, 'flow node symbolId')
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
      author: str(fields.author, 'pull author')
    }
  }
  return {
    pull,
    story: value.story === null ? null : parseStory(value.story),
    step: value.step === null ? null : parseStep(value.step),
    chapter: value.chapter === null ? null : parseChapter(value.chapter),
    flow: value.flow === null ? null : parseFlow(value.flow),
    file: value.file === null ? null : parseFile(value.file),
    section: value.section === null ? null : parseSection(value.section),
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
    context: parseViewContext(value.context),
    promptHash: value.promptHash === undefined ? undefined : parsePromptHash(value.promptHash)
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

export function parseAttachmentUrl(raw: unknown): string {
  const text = str(raw, 'attachment url')
  if (!URL.canParse(text)) throw new Error('Invalid attachment URL')
  return text
}

export function parseToken(raw: unknown): string {
  return nonEmptyStr(str(raw, 'token').trim(), 'token')
}

export function parseAnthropicKey(raw: unknown): string | null {
  if (raw === null) return null
  const key = str(raw, 'API key').trim()
  return key === '' ? null : key
}

export function parsePromptHash(raw: unknown): string {
  const hash = str(raw, 'prompt hash')
  if (!PROMPT_HASH.test(hash)) throw new Error('A prompt hash is 12 hex characters')
  return hash
}

export function parsePromptKind(raw: unknown): PromptKind {
  return oneOf(raw, PROMPT_KINDS, 'Prompt kind')
}

export function parsePromptText(raw: unknown): string {
  const text = nonEmptyStr(raw, 'Prompt')
  if (text.length > PROMPT_TEXT_MAX) throw new Error(`A prompt is at most ${PROMPT_TEXT_MAX} characters`)
  return text
}

export function parsePromptName(raw: unknown): string {
  const name = str(raw, 'Prompt name').trim()
  if (name.length > PROMPT_NAME_MAX) throw new Error(`A prompt name is at most ${PROMPT_NAME_MAX} characters`)
  return name
}

export const AGENT_PROMPT_MAX = 100_000
const AGENT_ID = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|(?:claude|codex)-app:[A-Za-z0-9-]{1,100})$/
const AGENT_MODEL = /^[A-Za-z0-9._:/[\]-]{1,100}$/
const AGENT_EFFORT = /^[a-z]{1,20}$/

export function parseAgentId(raw: unknown): string {
  const id = str(raw, 'agent id')
  if (!AGENT_ID.test(id)) throw new Error('Invalid agent id')
  return id
}

export function parseAgentPrompt(raw: unknown): string {
  const prompt = str(raw, 'Prompt')
  if (prompt.trim() === '') throw new Error('Prompt must not be empty')
  if (prompt.length > AGENT_PROMPT_MAX) throw new Error(`A prompt is at most ${AGENT_PROMPT_MAX} characters`)
  return prompt
}

export function parseAgentFolder(raw: unknown): string {
  const folder = str(raw, 'folder')
  if (!isAbsolute(folder) || folder.includes('\0')) throw new Error('folder must be an absolute path')
  return folder
}

// Shape only; main checks each path is a file it saved under its attachments dir.
export function parseAgentAttachments(raw: unknown): AgentAttachment[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) throw new Error('attachments must be an array')
  if (raw.length > ATTACHMENTS_PER_TURN) throw new Error(`At most ${ATTACHMENTS_PER_TURN} attachments per message`)
  const out: AgentAttachment[] = []
  for (const item of raw) {
    const value = obj(item, 'Attachment')
    const path = str(value.path, 'attachment path')
    if (!isAbsolute(path) || path.includes('\0')) throw new Error('Invalid attachment path')
    const size = value.size
    if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) throw new Error('Invalid attachment size')
    out.push({ path, name: str(value.name, 'attachment name'), mime: str(value.mime, 'attachment mime'), size })
  }
  return out
}

export function parseAttachmentName(raw: unknown): string {
  const name = nonEmptyStr(raw, 'File name')
  if (name.length > 255 || name.includes('\0')) throw new Error('Invalid file name')
  return name
}

export function parseAttachmentData(raw: unknown): Uint8Array {
  if (!(raw instanceof Uint8Array)) throw new Error('File data must be bytes')
  if (raw.byteLength > ATTACHMENT_MAX_BYTES) throw new Error(`A file is at most ${ATTACHMENT_MAX_BYTES / (1024 * 1024)} MB`)
  return raw
}

export function parseAgentStartInput(raw: unknown): AgentStartInput {
  const value = obj(raw, 'Agent')
  const provider = oneOf(value.provider, AGENT_PROVIDERS, 'Provider')
  const folder = parseAgentFolder(value.folder)
  const model = str(value.model, 'model')
  if (!AGENT_MODEL.test(model)) throw new Error('Invalid model')
  // The effort ends up inside a TOML value for Codex, so it is a bare word.
  const effort = str(value.effort, 'effort')
  if (!AGENT_EFFORT.test(effort)) throw new Error('Invalid effort')
  const permission = oneOf(value.permission, PERMISSIONS[provider].map((option) => option.id), 'Permission')
  if (typeof value.worktree !== 'boolean') throw new Error('worktree must be a boolean')
  const attachments = parseAgentAttachments(value.attachments)
  return { provider, folder, prompt: parseAgentPrompt(value.prompt), model, effort, permission, worktree: value.worktree, attachments }
}

export function parseAgentOpenTarget(raw: unknown): AgentOpenTarget {
  return oneOf(raw, ['finder', 'editor', 'terminal'] as const, 'Open target')
}

// A repo-relative path; the diff itself only runs for paths git lists as changed.
export function parseAgentDiffPath(raw: unknown): string {
  const path = nonEmptyStr(raw, 'path')
  if (path.includes('\0') || isAbsolute(path) || path.split('/').includes('..')) throw new Error('Invalid path')
  return path
}
