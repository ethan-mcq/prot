import { describe, expect, it } from 'vitest'
import type { DiffLocation } from '../types'
import { capySharePull, changed, KOTLIN_MODULE, MAIN_ACTIVITY, SWIFT_MODULE } from './fixtures'
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
    const node = { id: label, label, file, change: 'added' as const, chapterId: null }
    expect(locateFlowNode(node, files)).toEqual(expected)
  })
})
