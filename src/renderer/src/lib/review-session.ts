import { lineAnchor } from '@shared/diff'
import { buildHeuristicGuide, guideDrift, withNewSinceGuide } from '@shared/guide'
import type {
  Chapter,
  CodeSymbol,
  DiffLine,
  DiffLocation,
  DraftComment,
  FlowNode,
  Guide,
  GuideDrift,
  GuideStep,
  PullDetail
} from '@shared/types'
import { pullKey } from '@shared/types'

export type TreeMode = 'changed' | 'all'

export type IdeState = { open: false; mode: TreeMode } | { open: true; mode: TreeMode; path: string }

export type Focus = DiffLocation & { nonce: number }

export type AiGuideRequest = { status: 'idle' } | { status: 'loading' } | { status: 'failed'; message: string }

export type ReviewSession = {
  detail: PullDetail
  written: Guide
  guide: Guide
  drift: GuideDrift
  ai: AiGuideRequest
  symbols: Record<string, CodeSymbol>
  step: number
  reviewed: string[]
  drafts: DraftComment[]
  ide: IdeState
  focus: Focus | null
}

export type ReviewAction =
  | { type: 'step/go'; index: number }
  | { type: 'step/move'; delta: 1 | -1 }
  | { type: 'ai/start' }
  | { type: 'ai/loaded'; guide: Guide }
  | { type: 'ai/failed'; message: string }
  | { type: 'story/loaded'; guide: Guide }
  | { type: 'detail/updated'; detail: PullDetail; reviewed: string[] }
  | { type: 'reviewed/set'; keys: string[]; reviewed: boolean }
  | { type: 'draft/add'; path: string; line: DiffLine; body: string }
  | { type: 'draft/edit'; id: string; body: string }
  | { type: 'draft/remove'; id: string }
  | { type: 'drafts/clear' }
  | { type: 'ide/open'; path: string }
  | { type: 'ide/mode'; mode: TreeMode }
  | { type: 'ide/close' }
  | { type: 'focus/node'; node: FlowNode; at: DiffLocation | null; ide: boolean }

export function guideSteps(guide: Guide): GuideStep[] {
  const chapters: GuideStep[] = guide.chapters.map((_, index) => ({ kind: 'chapter', index }))
  return [{ kind: 'overview' }, { kind: 'flow' }, ...chapters]
}

function clampStep(index: number, guide: Guide): number {
  const last = guideSteps(guide).length - 1
  return Math.min(Math.max(index, 0), last)
}

function chapterHolding(guide: Guide, path: string | null, chapterId: string | null, symbolId: string | null = null): number {
  const bySymbol = guide.chapters.findIndex((chapter) =>
    chapter.cards.some((card) => card.symbolId === symbolId && card.seeChapterId === null)
  )
  if (symbolId !== null && bySymbol !== -1) return bySymbol
  const byPath = guide.chapters.findIndex((chapter) => path !== null && chapter.files.includes(path))
  if (byPath !== -1) return byPath
  return guide.chapters.findIndex((chapter) => chapter.id === chapterId)
}

export function cardKey(symbolId: string): string {
  return `symbol:${symbolId}`
}

export function chapterReviewKeys(chapter: Chapter): string[] {
  const cards = chapter.cards.filter((card) => card.seeChapterId === null)
  if (cards.length > 0) return cards.map((card) => cardKey(card.symbolId))
  return chapter.files.length > 0 ? chapter.files : [`chapter:${chapter.id}`]
}

// A file counts as reviewed once every full card showing its changes is.
export function isFileReviewed(session: ReviewSession, path: string): boolean {
  if (session.reviewed.includes(path)) return true
  const keys: string[] = []
  for (const chapter of session.guide.chapters) {
    for (const card of chapter.cards) {
      const symbol = symbolFor(session, card.symbolId)
      if (card.seeChapterId === null && symbol?.path === path && symbol.change !== 'context') keys.push(cardKey(card.symbolId))
    }
  }
  return keys.length > 0 && isReviewed(session, keys)
}

// The latest index wins, so card ranges follow the current head even under an older AI guide.
export function symbolFor(session: ReviewSession, symbolId: string): CodeSymbol | undefined {
  return session.symbols[symbolId] ?? session.guide.symbols[symbolId]
}

export function isReviewed(session: ReviewSession, keys: string[]): boolean {
  return keys.every((key) => session.reviewed.includes(key))
}

export function isChangedSinceGuide(drift: GuideDrift, path: string): boolean {
  if (drift.kind === 'fresh') return false
  return drift.changed.includes(path) || drift.added.includes(path)
}

function present(written: Guide, detail: PullDetail): Pick<ReviewSession, 'detail' | 'written' | 'guide' | 'drift'> {
  const drift = guideDrift(written, detail)
  const guide = drift.kind === 'fresh' ? written : withNewSinceGuide(written, detail, drift.added)
  return { detail, written, guide, drift }
}

export function reviewReducer(state: ReviewSession, action: ReviewAction): ReviewSession {
  switch (action.type) {
    case 'step/go':
      return { ...state, step: clampStep(action.index, state.guide), focus: null }
    case 'step/move':
      return { ...state, step: clampStep(state.step + action.delta, state.guide), focus: null }
    case 'ai/start':
      return { ...state, ai: { status: 'loading' } }
    case 'ai/loaded': {
      const next = present(action.guide, state.detail)
      return { ...state, ...next, ai: { status: 'idle' }, step: clampStep(state.step, next.guide) }
    }
    case 'ai/failed':
      return { ...state, ai: { status: 'failed', message: action.message } }
    case 'story/loaded': {
      if (action.guide.headSha !== state.detail.head.sha) return state
      const symbols = action.guide.symbols
      if (state.written.source === 'ai') return { ...state, symbols }
      const next = present(action.guide, state.detail)
      return { ...state, ...next, symbols, step: clampStep(state.step, next.guide) }
    }
    case 'detail/updated': {
      const written = state.written.source === 'heuristic' ? buildHeuristicGuide(action.detail) : state.written
      const next = present(written, action.detail)
      const pushed = action.detail.head.sha !== state.detail.head.sha
      return {
        ...state,
        ...next,
        symbols: pushed ? {} : state.symbols,
        step: clampStep(state.step, next.guide),
        reviewed: pushed ? action.reviewed : state.reviewed
      }
    }
    case 'reviewed/set': {
      const others = state.reviewed.filter((key) => !action.keys.includes(key))
      return { ...state, reviewed: action.reviewed ? [...others, ...action.keys] : others }
    }
    case 'draft/add': {
      const anchor = lineAnchor(action.line)
      if (!anchor) return state
      const draft: DraftComment = { id: crypto.randomUUID(), path: action.path, ...anchor, body: action.body }
      return { ...state, drafts: [...state.drafts, draft] }
    }
    case 'draft/edit':
      return {
        ...state,
        drafts: state.drafts.map((d) => (d.id === action.id ? { ...d, body: action.body } : d))
      }
    case 'draft/remove':
      return { ...state, drafts: state.drafts.filter((d) => d.id !== action.id) }
    case 'drafts/clear':
      return { ...state, drafts: [] }
    case 'ide/open':
      return { ...state, ide: { open: true, mode: state.ide.mode, path: action.path } }
    case 'ide/mode':
      return { ...state, ide: { ...state.ide, mode: action.mode } }
    case 'ide/close':
      return { ...state, ide: { open: false, mode: state.ide.mode } }
    case 'focus/node': {
      const focus = action.at === null ? null : { ...action.at, nonce: (state.focus?.nonce ?? 0) + 1 }
      const path = action.at?.path ?? action.node.file
      const chapter = chapterHolding(state.guide, path, action.node.chapterId, action.node.symbolId)
      if (action.ide || chapter === -1) {
        if (path === null) return state
        return { ...state, focus, ide: { open: true, mode: state.ide.mode, path } }
      }
      return { ...state, focus, step: clampStep(chapter + 2, state.guide) }
    }
  }
}

type Stored = { reviewed: string[]; drafts: DraftComment[] }

export function storageKey(detail: PullDetail): string {
  return `prot:review:${pullKey(detail.summary.ref)}@${detail.head.sha}`
}

export function readStored(key: string): Stored {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return { reviewed: [], drafts: [] }
    const parsed = JSON.parse(raw) as Partial<Stored>
    return { reviewed: parsed.reviewed ?? [], drafts: parsed.drafts ?? [] }
  } catch {
    return { reviewed: [], drafts: [] }
  }
}

export function saveSession(key: string, session: ReviewSession): void {
  const stored: Stored = { reviewed: session.reviewed, drafts: session.drafts }
  try {
    localStorage.setItem(key, JSON.stringify(stored))
  } catch {
  }
}

export function initSession(detail: PullDetail): ReviewSession {
  const stored = readStored(storageKey(detail))
  return {
    ...present(buildHeuristicGuide(detail), detail),
    ai: { status: 'idle' },
    symbols: {},
    step: 0,
    reviewed: stored.reviewed,
    drafts: stored.drafts,
    ide: { open: false, mode: 'changed' },
    focus: null
  }
}
