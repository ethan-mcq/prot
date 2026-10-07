import { describe, expect, it } from 'vitest'
import type { DiffLocation } from '../types'
import { capySharePull, capyStoryIndex, capyStoryPull, changed, KOTLIN_MODULE, MAIN_ACTIVITY, STORY, SWIFT_MODULE } from './fixtures'
import { locateFlowNode } from './index'

const MOBILE = 'packages/mobile'
const LEGACY = `${MOBILE}/src/share/legacy.ts`
const QUEUE = `${MOBILE}/src/share/queue.ts`
const files = [
  ...capySharePull.files,
  changed(QUEUE, 'modified', ['@@ -1,3 +1,4 @@', '+// drained by flushQueue', ' export function flushQueue() {', '   return []', ' }']),
  changed(LEGACY, 'modified', ['@@ -3,3 +3,1 @@', '-export function legacyShare() {', '-}', ' export {}'])
]

describe('locateFlowNode', () => {
  it.each<[string, string, string | null, DiffLocation | null]>([
    ['call label lands on its added declaration', 'takeShare()', KOTLIN_MODULE, { path: KOTLIN_MODULE, line: 9, side: 'RIGHT' }],
    ['qualified label with no file searches every file', 'CapyShareModule.takeShare()', null, { path: KOTLIN_MODULE, line: 9, side: 'RIGHT' }],
    ['signed label with no file', '+ShareSheet', null, { path: `${MOBILE}/src/share/share-sheet.tsx`, line: 5, side: 'RIGHT' }],
    ['Swift func inside a class', 'CapyShareModule::definition()', SWIFT_MODULE, { path: SWIFT_MODULE, line: 4, side: 'RIGHT' }],
    ['context declaration beats an earlier added mention', 'flushQueue()', QUEUE, { path: QUEUE, line: 2, side: 'RIGHT' }],
    ['section header names the class, so its first change', 'MainActivity', MAIN_ACTIVITY, { path: MAIN_ACTIVITY, line: 15, side: 'RIGHT' }],
    ['no declaration, so the first added use', 'CapyShare#takeShare', `${MOBILE}/src/share/share-inbox.tsx`, { path: `${MOBILE}/src/share/share-inbox.tsx`, line: 8, side: 'RIGHT' }],
    ['only a deleted line mentions it', 'legacyShare()', LEGACY, { path: LEGACY, line: 3, side: 'LEFT' }],
    ['file node lands on the first change', 'send.ts', `${MOBILE}/src/share/send.ts`, { path: `${MOBILE}/src/share/send.ts`, line: 1, side: 'RIGHT' }],
    ['miss', 'uploadAll()', SWIFT_MODULE, null]
  ])('%s', (_case, label, file, expected) => {
    const node = { id: label, label, file, change: 'added' as const, chapterId: null, symbolId: null }
    expect(locateFlowNode(node, files)).toEqual(expected)
  })

  const symbols = Object.fromEntries(capyStoryIndex.symbols.map((symbol) => [symbol.id, symbol]))
  it.each<[string, string, DiffLocation]>([
    ['a modified method lands on its added line, not its declaration', `${STORY.activity}#MainActivity.onNewIntent`, { path: STORY.activity, line: 13, side: 'RIGHT' }],
    ['a changed function lands on its removed line when that comes first', `${STORY.store}#normalizeText`, { path: STORY.store, line: 8, side: 'LEFT' }],
    ['an added class lands on its own first line, skipping its members', `${STORY.module}#CapyShareModule`, { path: STORY.module, line: 8, side: 'RIGHT' }],
    ['an unchanged entry lands on its first line', `${STORY.store}#appendMessage`, { path: STORY.store, line: 5, side: 'RIGHT' }]
  ])('symbol node: %s', (_case, symbolId, expected) => {
    const node = { id: symbolId, label: 'whatever', file: null, change: 'added' as const, chapterId: null, symbolId }
    expect(locateFlowNode(node, capyStoryPull.files, symbols)).toEqual(expected)
  })
})
