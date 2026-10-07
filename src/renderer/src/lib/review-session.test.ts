import { describe, expect, it } from 'vitest'
import { buildHeuristicGuide, buildStoryGuide, parseAiGuide } from '@shared/guide'
import { added, capySharePull, capyStoryIndex, capyStoryPull, KOTLIN_MODULE, pullWith, STORY, SWIFT_MODULE } from '@shared/guide/fixtures'
import type { Chapter, DiffLine, FlowNode, Guide, PullDetail } from '@shared/types'
import { cardKey, initSession, isFileReviewed, reviewReducer, type ReviewSession } from './review-session'

function guideWith(chapterCount: number): Guide {
  const chapters: Chapter[] = Array.from({ length: chapterCount }, (_, i) => ({
    id: `c${i}`,
    title: `Chapter ${i}`,
    summary: '',
    files: [],
    cards: []
  }))
  return {
    source: 'heuristic',
    headSha: 'abc',
    overview: { risk: { level: 'low', reason: '' }, synopsis: '', points: [] },
    flow: { caption: '', nodes: [], edges: [] },
    chapters,
    symbols: {}
  }
}

function session(chapterCount: number, step = 0): ReviewSession {
  const guide = guideWith(chapterCount)
  return {
    detail: pullWith([]),
    written: guide,
    guide,
    drift: { kind: 'fresh' },
    ai: { status: 'idle' },
    symbols: {},
    step,
    reviewed: [],
    drafts: [],
    ide: { open: false, mode: 'changed' },
    focus: null
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

describe('jumping to a flow node', () => {
  const node: FlowNode = { id: 'n', label: 'takeShare()', file: 'app/Share.kt', change: 'added', chapterId: null, symbolId: null }
  const at = { path: 'app/Share.kt', line: 5, side: 'RIGHT' as const }
  const guide = guideWith(2)
  guide.chapters[1] = { id: 'c1', title: 'Share', summary: '', files: ['app/Share.kt'], cards: [] }

  it('lands on the chapter holding the line, re-clicks re-focus, and leaving the step clears it', () => {
    const start = { ...session(2, 1), guide }
    const first = reviewReducer(start, { type: 'focus/node', node, at, ide: false })
    expect({ step: first.step, focus: first.focus, ide: first.ide.open }).toEqual({
      step: 3,
      focus: { path: 'app/Share.kt', line: 5, side: 'RIGHT', nonce: 1 },
      ide: false
    })
    expect(reviewReducer(first, { type: 'focus/node', node, at, ide: false }).focus?.nonce).toBe(2)
    expect(reviewReducer(first, { type: 'step/move', delta: -1 }).focus).toBe(null)

    const outside = reviewReducer(start, { type: 'focus/node', node: { ...node, file: 'lib/Other.kt' }, at: null, ide: false })
    expect({ step: outside.step, ide: outside.ide, focus: outside.focus }).toEqual({
      step: 1,
      ide: { open: true, mode: 'changed', path: 'lib/Other.kt' },
      focus: null
    })
  })
})

describe('a pull request update while reading', () => {
  const QUEUE = 'packages/mobile/src/share/share-queue.ts'
  const pushed: PullDetail = {
    ...capySharePull,
    head: { ...capySharePull.head, sha: 'head456' },
    files: [...capySharePull.files, added(QUEUE, ['export const queue: string[] = []'])]
  }
  const chapterFiles = (state: ReviewSession) => state.guide.chapters.map((chapter) => [chapter.title, chapter.files])

  it('keeps the AI guide, step and open IDE, and puts the uncovered file in a trailing chapter', () => {
    const raw = {
      overview: { risk: { level: 'low', reason: 'Small.' }, synopsis: 'Shares text into a thread.', points: [] },
      caption: '',
      sections: [],
      files: [{ title: 'Native share module', summary: '', files: [KOTLIN_MODULE, SWIFT_MODULE] }]
    }
    const story = buildHeuristicGuide(capySharePull)
    let state = reviewReducer(initSession(capySharePull), { type: 'ai/loaded', guide: parseAiGuide(raw, capySharePull, story) })
    state = reviewReducer(state, { type: 'step/go', index: 2 })
    state = reviewReducer(state, { type: 'ide/open', path: KOTLIN_MODULE })
    state = reviewReducer(state, { type: 'reviewed/set', keys: [KOTLIN_MODULE], reviewed: true })

    const comment = reviewReducer(state, { type: 'detail/updated', detail: capySharePull, reviewed: [] })
    expect({ drift: comment.drift, reviewed: comment.reviewed }).toEqual({ drift: { kind: 'fresh' }, reviewed: [KOTLIN_MODULE] })

    const push = reviewReducer(state, { type: 'detail/updated', detail: pushed, reviewed: [] })
    expect({
      step: push.step,
      ide: push.ide,
      reviewed: push.reviewed,
      drift: push.drift.kind,
      first: push.guide.chapters[0]?.title,
      last: chapterFiles(push).at(-1)
    }).toEqual({
      step: 2,
      ide: { open: true, mode: 'changed', path: KOTLIN_MODULE },
      reviewed: [],
      drift: 'significant',
      first: 'Native share module',
      last: ['New since guide', [QUEUE]]
    })
  })

  it('rebuilds a quick guide from the new diff, which is never stale', () => {
    const push = reviewReducer(initSession(capySharePull), { type: 'detail/updated', detail: pushed, reviewed: [] })
    const placed = chapterFiles(push).flatMap(([, files]) => files)
    expect({ source: push.guide.source, drift: push.drift, hasQueue: placed.includes(QUEUE) }).toEqual({
      source: 'heuristic',
      drift: { kind: 'fresh' },
      hasQueue: true
    })
  })
})

describe('the story guide arriving', () => {
  const story = buildStoryGuide(capyStoryPull, capyStoryIndex)
  const onNewIntent = `${STORY.activity}#MainActivity.onNewIntent`
  const activityModule = `${STORY.activity}#(module)`

  it('replaces the quick guide on the same head, ignores a story for another head, and under an AI guide only refreshes symbols', () => {
    const quick = initSession(capyStoryPull)
    const swapped = reviewReducer(quick, { type: 'story/loaded', guide: story })
    const stale = reviewReducer(quick, { type: 'story/loaded', guide: { ...story, headSha: 'old' } })
    const ai = reviewReducer(quick, {
      type: 'ai/loaded',
      guide: parseAiGuide(
        { overview: { synopsis: 'x' }, sections: [{ title: 'All of it', symbols: [onNewIntent] }], files: [] },
        capyStoryPull,
        story
      )
    })
    const underAi = reviewReducer(ai, { type: 'story/loaded', guide: story })
    expect({
      swapped: swapped.guide.chapters[0]?.title,
      stale: stale.guide === quick.guide,
      aiTitle: underAi.guide.chapters[0]?.title,
      aiSymbols: Object.keys(underAi.symbols).length
    }).toEqual({ swapped: 'takeShare enters through MainActivity.onNewIntent', stale: true, aiTitle: 'All of it', aiSymbols: 37 })
  })

  it('counts a file reviewed once every card showing its changes is', () => {
    let state = reviewReducer(initSession(capyStoryPull), { type: 'story/loaded', guide: story })
    state = reviewReducer(state, { type: 'reviewed/set', keys: [cardKey(onNewIntent)], reviewed: true })
    const half = isFileReviewed(state, STORY.activity)
    state = reviewReducer(state, { type: 'reviewed/set', keys: [cardKey(activityModule)], reviewed: true })
    expect({ half, whole: isFileReviewed(state, STORY.activity) }).toEqual({ half: false, whole: true })
  })
})
