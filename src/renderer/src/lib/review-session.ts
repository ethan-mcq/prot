import type { Chapter, DiffLine, DiffSide, DraftComment, Guide, GuideStep, PullDetail } from '@shared/types'
import { pullKey } from '@shared/types'

export type TreeMode = 'changed' | 'all'

export type IdeState = { open: false; mode: TreeMode } | { open: true; mode: TreeMode; path: string }

export type AiGuideRequest = { status: 'idle' } | { status: 'loading' } | { status: 'failed'; message: string }

export type ReviewSession = {
  guide: Guide
  ai: AiGuideRequest
  step: number
  reviewed: string[]
  drafts: DraftComment[]
  ide: IdeState
}

export type ReviewAction =
  | { type: 'step/go'; index: number }
  | { type: 'step/move'; delta: 1 | -1 }
  | { type: 'ai/start' }
  | { type: 'ai/loaded'; guide: Guide }
  | { type: 'ai/failed'; message: string }
  | { type: 'reviewed/set'; keys: string[]; reviewed: boolean }
  | { type: 'draft/add'; path: string; line: DiffLine; body: string }
  | { type: 'draft/edit'; id: string; body: string }
  | { type: 'draft/remove'; id: string }
  | { type: 'drafts/clear' }
  | { type: 'ide/open'; path: string }
  | { type: 'ide/mode'; mode: TreeMode }
  | { type: 'ide/close' }

export function guideSteps(guide: Guide): GuideStep[] {
  const chapters: GuideStep[] = guide.chapters.map((_, index) => ({ kind: 'chapter', index }))
  return [{ kind: 'overview' }, { kind: 'flow' }, ...chapters]
}

function clampStep(index: number, guide: Guide): number {
  const last = guideSteps(guide).length - 1
  return Math.min(Math.max(index, 0), last)
}

export function draftAnchor(line: DiffLine): { side: DiffSide; line: number } | null {
  if (line.kind === 'del') return line.oldLine === null ? null : { side: 'LEFT', line: line.oldLine }
  return line.newLine === null ? null : { side: 'RIGHT', line: line.newLine }
}

export function chapterReviewKeys(chapter: Chapter): string[] {
  return chapter.files.length > 0 ? chapter.files : [`chapter:${chapter.id}`]
}

export function isReviewed(session: ReviewSession, keys: string[]): boolean {
  return keys.every((key) => session.reviewed.includes(key))
}

export function reviewReducer(state: ReviewSession, action: ReviewAction): ReviewSession {
  switch (action.type) {
    case 'step/go':
      return { ...state, step: clampStep(action.index, state.guide) }
    case 'step/move':
      return { ...state, step: clampStep(state.step + action.delta, state.guide) }
    case 'ai/start':
      return { ...state, ai: { status: 'loading' } }
    case 'ai/loaded':
      return { ...state, guide: action.guide, ai: { status: 'idle' }, step: clampStep(state.step, action.guide) }
    case 'ai/failed':
      return { ...state, ai: { status: 'failed', message: action.message } }
    case 'reviewed/set': {
      const others = state.reviewed.filter((key) => !action.keys.includes(key))
      return { ...state, reviewed: action.reviewed ? [...others, ...action.keys] : others }
    }
    case 'draft/add': {
      const anchor = draftAnchor(action.line)
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
  }
}

type Stored = { reviewed: string[]; drafts: DraftComment[] }

export function storageKey(detail: PullDetail): string {
  return `prot:review:${pullKey(detail.summary.ref)}@${detail.head.sha}`
}

function readStored(key: string): Stored {
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

export function initSession({ detail, guide }: { detail: PullDetail; guide: Guide }): ReviewSession {
  const stored = readStored(storageKey(detail))
  return {
    guide,
    ai: { status: 'idle' },
    step: 0,
    reviewed: stored.reviewed,
    drafts: stored.drafts,
    ide: { open: false, mode: 'changed' }
  }
}
