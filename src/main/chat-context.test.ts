import { describe, expect, it } from 'vitest'
import type { ChangedFile, PullDetail, ViewContext } from '@shared/types'
import { attachViewContext, buildChatSystem, buildViewContext } from './chat-context'

const emptyContext: ViewContext = {
  pull: null,
  step: null,
  chapter: null,
  flow: null,
  file: null,
  section: null,
  selection: null
}

function file(path: string, status: ChangedFile['status'] = 'modified'): ChangedFile {
  return { path, previousPath: null, status, additions: 4, deletions: 1, patch: null }
}

function detail(overrides: Partial<PullDetail> = {}): PullDetail {
  return {
    summary: {
      ref: { owner: 'acme', repo: 'widgets', number: 7 },
      title: 'Add retry to uploader',
      author: { login: 'ada', avatarUrl: '' },
      url: '',
      draft: false,
      createdAt: '',
      updatedAt: '',
      bucket: 'review',
      comments: 0,
      labels: []
    },
    body: 'Retries failed uploads.',
    base: { ref: 'main', sha: 'aaa' },
    head: { ref: 'retry', sha: 'bbb' },
    additions: 8,
    deletions: 2,
    files: [file('src/upload.ts'), file('src/new.ts', 'added')],
    reviewComments: [],
    reviews: [],
    ...overrides
  }
}

describe('buildChatSystem', () => {
  it('lists the PR file paths with status and line counts', () => {
    const system = buildChatSystem(detail())
    expect(system).toContain('Title: Add retry to uploader')
    expect(system).toContain('Size: +8 -2 across 2 files')
    expect(system).toContain('M src/upload.ts (+4 -1)')
    expect(system).toContain('A src/new.ts (+4 -1)')
  })

  it('truncates a long description at 4000 characters', () => {
    const system = buildChatSystem(detail({ body: 'x'.repeat(5_000) }))
    expect(system).toContain(`${'x'.repeat(4_000)}\n[truncated 1000 more characters]`)
    expect(system).not.toContain('x'.repeat(4_001))
  })

  it('caps the file list and says how many were left out', () => {
    const files = Array.from({ length: 450 }, (_, i) => file(`f${i}.ts`))
    const system = buildChatSystem(detail({ files }))
    expect(system).toContain('M f399.ts')
    expect(system).not.toContain('M f400.ts')
    expect(system).toContain('... and 50 more files')
  })
})

describe('buildViewContext', () => {
  it('is empty when nothing is on screen', () => {
    expect(buildViewContext(emptyContext)).toBe('')
  })

  it('describes the chapter, the flow chain, the open file and the selection', () => {
    const block = buildViewContext({
      ...emptyContext,
      step: { kind: 'chapter', index: 1 },
      chapter: { id: 'c2', title: 'Retry loop', summary: 'Adds backoff.', files: ['src/upload.ts'], cards: [] },
      flow: {
        caption: '',
        nodes: [
          { id: 'a', label: 'upload()', file: null, change: 'modified', chapterId: null, symbolId: null },
          { id: 'b', label: 'retry()', file: null, change: 'added', chapterId: null, symbolId: null },
          { id: 'c', label: 'fetch()', file: null, change: 'context', chapterId: null, symbolId: null }
        ],
        edges: []
      },
      file: { path: 'src/upload.ts', patch: '@@ -1 +1 @@\n-a\n+b', visibleLines: [10, 42] },
      selection: 'await sleep(delay)'
    })
    expect(block).toContain('Guide step: chapter 2: Retry loop')
    expect(block).toContain('Chapter files: src/upload.ts')
    expect(block).toContain('Flow: upload() -> retry() -> fetch()')
    expect(block).toContain('Open file: src/upload.ts (visible lines 10-42)')
    expect(block).toContain('@@ -1 +1 @@\n-a\n+b')
    expect(block).toContain('Selected text:\nawait sleep(delay)')
  })

  it('lists the section cards and the code of the card on screen', () => {
    const block = buildViewContext({
      ...emptyContext,
      step: { kind: 'chapter', index: 0 },
      section: {
        cards: [
          { qualifiedName: 'MainActivity.onNewIntent', kind: 'method', path: 'app/MainActivity.kt', lines: { start: 11, end: 15 }, change: 'modified' },
          { qualifiedName: 'CapyShareModule.takeShare', kind: 'method', path: 'share/CapyShareModule.kt', lines: { start: 10, end: 14 }, change: 'added' }
        ],
        focused: { qualifiedName: 'CapyShareModule.takeShare', path: 'share/CapyShareModule.kt', code: '+fun takeShare(intent: Intent) {' }
      }
    })
    expect(block).toBe(
      [
        '<view_context>',
        'Guide step: chapter 1',
        'Section cards:',
        '- MainActivity.onNewIntent (method, modified, app/MainActivity.kt:11-15)',
        '- CapyShareModule.takeShare (method, added, share/CapyShareModule.kt:10-14)',
        'Card on screen: CapyShareModule.takeShare in share/CapyShareModule.kt',
        '+fun takeShare(intent: Intent) {',
        '</view_context>'
      ].join('\n')
    )
  })

  it('truncates the patch at 30000 characters', () => {
    const block = buildViewContext({
      ...emptyContext,
      file: { path: 'big.ts', patch: 'y'.repeat(30_500), visibleLines: null }
    })
    expect(block).toContain(`${'y'.repeat(30_000)}\n[truncated 500 more characters]`)
    expect(block).toContain('Open file: big.ts\n')
  })
})

describe('attachViewContext', () => {
  const history = [
    { role: 'user', content: 'What changed?' },
    { role: 'assistant', content: 'The uploader retries.' },
    { role: 'user', content: 'Why a loop?' }
  ] as const

  it('prefixes only the latest user message so earlier turns stay cacheable', () => {
    const result = attachViewContext([...history], { ...emptyContext, selection: 'for (;;)' })
    expect(result[0]).toEqual(history[0])
    expect(result[1]).toEqual(history[1])
    expect(result[2]?.content).toBe(
      '<view_context>\nSelected text:\nfor (;;)\n</view_context>\n\nWhy a loop?'
    )
  })

  it('returns the messages untouched when there is no view context', () => {
    expect(attachViewContext([...history], emptyContext)).toEqual(history)
  })
})
