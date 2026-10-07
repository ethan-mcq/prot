import { describe, expect, it } from 'vitest'
import type { ChangedFile, Guide, GuideDrift, PullDetail } from '../types'
import { added, capySharePull, KOTLIN_MODULE, pullWith, SWIFT_MODULE } from './fixtures'
import { buildHeuristicGuide, guideDrift, parseAiGuide } from './index'

const QUEUE = 'packages/mobile/src/share/share-queue.ts'

const aiGuide = parseAiGuide(
  {
    overview: { risk: { level: 'low', reason: 'Small.' }, synopsis: 'Shares text from other apps into a thread.', points: [] },
    caption: '',
    sections: [],
    files: [{ title: 'Native share module', summary: '', files: [KOTLIN_MODULE, SWIFT_MODULE] }]
  },
  capySharePull,
  buildHeuristicGuide(capySharePull),
  'd1a090fa9228'
)

function pushed(edit: (files: ChangedFile[]) => ChangedFile[]): PullDetail {
  return pullWith(edit([...capySharePull.files]))
}

function replacing(path: string, next: (file: ChangedFile) => ChangedFile) {
  return (files: ChangedFile[]) => files.map((file) => (file.path === path ? next(file) : file))
}

const kotlinSource = (capySharePull.files.find((file) => file.path === KOTLIN_MODULE)?.patch ?? '')
  .split('\n')
  .slice(1)
  .map((line) => line.slice(1))

const cases: [string, Guide, PullDetail, GuideDrift][] = [
  ['nothing changed', aiGuide, capySharePull, { kind: 'fresh' }],
  [
    'a quick guide is rebuilt from the live diff',
    buildHeuristicGuide(capySharePull),
    pushed((files) => [...files, added(QUEUE, ['export const queue: string[] = []'])]),
    { kind: 'fresh' }
  ],
  [
    'a 2-line tweak in a covered core file',
    aiGuide,
    pushed(replacing(KOTLIN_MODULE, () => added(KOTLIN_MODULE, [...kotlinSource, '', '// drained by ShareInbox']))),
    { kind: 'minor', changed: [KOTLIN_MODULE], added: [], sinceSha: 'head123' }
  ],
  [
    'a new lockfile alone',
    aiGuide,
    pushed((files) => [...files, added('packages/mobile/yarn.lock', ['zod@3.23.8:', '  version "3.23.8"'])]),
    { kind: 'minor', changed: [], added: ['packages/mobile/yarn.lock'], sinceSha: 'head123' }
  ],
  [
    'a new test file alone',
    aiGuide,
    pushed((files) => [...files, added('packages/mobile/src/share/__tests__/queue.test.ts', ["test('queues', () => {})"])]),
    { kind: 'minor', changed: [], added: ['packages/mobile/src/share/__tests__/queue.test.ts'], sinceSha: 'head123' }
  ],
  [
    'a new core file no chapter covers',
    aiGuide,
    pushed((files) => [...files, added(QUEUE, ['export const queue: string[] = []'])]),
    {
      kind: 'significant',
      changed: [],
      added: [QUEUE],
      removed: [],
      reasons: [{ kind: 'uncovered-file', path: QUEUE }],
      additions: 1,
      deletions: 0,
      sinceSha: 'head123'
    }
  ],
  [
    'a covered core file dropped from the diff',
    aiGuide,
    pushed((files) => files.filter((file) => file.path !== SWIFT_MODULE)),
    {
      kind: 'significant',
      changed: [],
      added: [],
      removed: [SWIFT_MODULE],
      reasons: [{ kind: 'removed-file', path: SWIFT_MODULE }],
      additions: 0,
      deletions: 13,
      sinceSha: 'head123'
    }
  ],
  [
    'changed lines reaching a quarter of the covered lines',
    aiGuide,
    pushed(replacing('package-lock.json', (file) => ({ ...file, additions: 90 }))),
    {
      kind: 'significant',
      changed: ['package-lock.json'],
      added: [],
      removed: [],
      reasons: [{ kind: 'line-share', lines: 42, covered: 167 }],
      additions: 42,
      deletions: 0,
      sinceSha: 'head123'
    }
  ],
  [
    'changed lines just under a quarter of the covered lines',
    aiGuide,
    pushed(replacing('package-lock.json', (file) => ({ ...file, additions: 89 }))),
    { kind: 'minor', changed: ['package-lock.json'], added: [], sinceSha: 'head123' }
  ]
]

describe('guideDrift', () => {
  it.each(cases)('%s', (_name, guide, detail, expected) => {
    expect(guideDrift(guide, detail)).toEqual(expected)
  })
})
