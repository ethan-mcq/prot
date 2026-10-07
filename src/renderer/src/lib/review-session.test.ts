import { describe, expect, it } from 'vitest'
import type { Chapter, DiffLine, Guide } from '@shared/types'
import { reviewReducer, type ReviewSession } from './review-session'

function guideWith(chapterCount: number): Guide {
  const chapters: Chapter[] = Array.from({ length: chapterCount }, (_, i) => ({
    id: `c${i}`,
    title: `Chapter ${i}`,
    summary: '',
    files: []
  }))
  return {
    source: 'heuristic',
    headSha: 'abc',
    overview: { summary: '', points: [] },
    flow: { caption: '', nodes: [], edges: [] },
    chapters
  }
}

function session(chapterCount: number, step = 0): ReviewSession {
  return {
    guide: guideWith(chapterCount),
    ai: { status: 'idle' },
    step,
    reviewed: [],
    drafts: [],
    ide: { open: false, mode: 'changed' }
  }
}

describe('step navigation', () => {
  it('stops at Overview and at the last chapter', () => {
    const atStart = reviewReducer(session(2, 0), { type: 'step/move', delta: -1 })
    expect(atStart.step).toBe(0)
    const atEnd = reviewReducer(session(2, 3), { type: 'step/move', delta: 1 })
    expect(atEnd.step).toBe(3)
    expect(reviewReducer(session(2), { type: 'step/go', index: 99 }).step).toBe(3)
  })

  it('keeps the step when the AI guide arrives, clamping only when it has fewer chapters', () => {
    const kept = reviewReducer(session(6, 4), { type: 'ai/loaded', guide: guideWith(3) })
    expect(kept.step).toBe(4)
    const clamped = reviewReducer(session(6, 7), { type: 'ai/loaded', guide: guideWith(3) })
    expect(clamped.step).toBe(4)
  })
})

describe('draft comments', () => {
  const add = (line: DiffLine) =>
    reviewReducer(session(1), { type: 'draft/add', path: 'app/Share.kt', line, body: 'why?' }).drafts

  it('anchors deleted lines on the old side and everything else on the new side', () => {
    expect(add({ kind: 'del', oldLine: 40, newLine: null, text: 'x' })).toMatchObject([
      { path: 'app/Share.kt', side: 'LEFT', line: 40, body: 'why?' }
    ])
    expect(add({ kind: 'add', oldLine: null, newLine: 52, text: 'x' })).toMatchObject([{ side: 'RIGHT', line: 52 }])
    expect(add({ kind: 'context', oldLine: 38, newLine: 50, text: 'x' })).toMatchObject([{ side: 'RIGHT', line: 50 }])
  })
})
