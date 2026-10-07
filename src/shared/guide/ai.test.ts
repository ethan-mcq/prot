import { describe, expect, it } from 'vitest'
import type { ChangedFile } from '../types'
import { capySharePull, changed, KOTLIN_MODULE, MAIN_ACTIVITY, pullWith, SWIFT_MODULE } from './fixtures'
import { buildGuidePrompt, GUIDE_SCHEMA, parseAiGuide } from './index'

describe('parseAiGuide', () => {
  it('repairs unknown paths, duplicate files, uncovered files and dangling edges', () => {
    const raw = {
      overview: { summary: '  Share text from other apps into a thread. ', points: ['Native share module', 42, ''] },
      flow: {
        caption: 'How shared content reaches a thread',
        nodes: [
          { id: 'intent', label: 'onNewIntent()', file: MAIN_ACTIVITY, change: 'added' },
          { id: 'take', label: 'takeShare()', file: KOTLIN_MODULE, change: 'added' },
          { id: 'ghost', label: 'Ghost', file: 'not/in/this/pr.ts', change: 'renamed' },
          { id: 'intent', label: 'duplicate id', file: null, change: 'added' }
        ],
        edges: [
          { from: 'intent', to: 'take' },
          { from: 'take', to: 'missing' },
          { from: 'intent', to: 'take' }
        ]
      },
      chapters: [
        {
          title: 'Native share module',
          summary: 'Kotlin and Swift sides.',
          files: [KOTLIN_MODULE, SWIFT_MODULE, 'packages/mobile/ghost.kt']
        },
        { title: 'Android entry point', summary: 'Hands the intent over.', files: [MAIN_ACTIVITY, KOTLIN_MODULE] },
        { title: 'Invented', summary: 'Nothing real here.', files: ['nope.ts'] }
      ]
    }

    const guide = parseAiGuide(raw, capySharePull)

    expect(guide.source).toBe('ai')
    expect(guide.headSha).toBe('head123')
    expect(guide.overview).toEqual({
      summary: 'Share text from other apps into a thread.',
      points: ['Native share module']
    })
    expect(guide.chapters.map(({ id, title, files }) => ({ id, title, files }))).toEqual([
      { id: 'ch-1', title: 'Native share module', files: [KOTLIN_MODULE, SWIFT_MODULE] },
      { id: 'ch-2', title: 'Android entry point', files: [MAIN_ACTIVITY] },
      {
        id: 'ch-3',
        title: 'With share extension in plugins',
        files: ['packages/mobile/plugins/with-share-extension.js']
      },
      { id: 'ch-4', title: 'Thread store in src/chat', files: ['packages/mobile/src/chat/thread-store.ts'] },
      {
        id: 'ch-5',
        title: 'Share sheet UI in src/share',
        files: [
          'packages/mobile/src/share/share-sheet.tsx',
          'packages/mobile/src/share/share-inbox.tsx',
          'packages/mobile/src/share/send.ts'
        ]
      },
      {
        id: 'ch-6',
        title: 'Config and build scripts',
        files: ['packages/mobile/app.config.ts', 'packages/mobile/scripts/testflight.sh']
      },
      { id: 'ch-7', title: 'Docs', files: ['packages/mobile/README.md'] },
      { id: 'ch-8', title: 'Tests', files: ['packages/mobile/src/share/__tests__/send.test.ts'] },
      { id: 'ch-9', title: 'Lockfiles', files: ['package-lock.json'] }
    ])
    expect(guide.chapters[0]?.summary).toBe('Kotlin and Swift sides.')
    expect(guide.flow).toEqual({
      caption: 'How shared content reaches a thread',
      nodes: [
        { id: 'intent', label: 'onNewIntent()', file: MAIN_ACTIVITY, change: 'added', chapterId: 'ch-2' },
        { id: 'take', label: 'takeShare()', file: KOTLIN_MODULE, change: 'added', chapterId: 'ch-1' },
        { id: 'ghost', label: 'Ghost', file: null, change: 'context', chapterId: null }
      ],
      edges: [{ from: 'intent', to: 'take' }]
    })
  })

  it.each([
    [null, /not a JSON object/],
    ['{"overview": ', /not valid JSON/],
    [{ chapters: [] }, /overview\.summary/],
    [{ overview: { summary: 'x' }, chapters: 'all of them' }, /chapters array/],
    [{ overview: { summary: 'x' }, chapters: [{ title: 'Made up', files: ['nope.ts'] }] }, /none of the changed files/]
  ])('rejects unusable output %#', (raw, message) => {
    expect(() => parseAiGuide(raw, capySharePull)).toThrow(message)
  })
})

describe('GUIDE_SCHEMA', () => {
  it('closes every object and requires all of its properties, as structured outputs demand', () => {
    const problems: string[] = []
    const objects: string[] = []
    const visit = (schema: unknown, at: string): void => {
      if (typeof schema !== 'object' || schema === null) return
      const node = schema as Record<string, unknown>
      if (node.type === 'object') {
        objects.push(at)
        const keys = Object.keys((node.properties ?? {}) as Record<string, unknown>).sort()
        const required = [...((node.required ?? []) as string[])].sort()
        if (node.additionalProperties !== false) problems.push(`${at} allows extra properties`)
        if (JSON.stringify(keys) !== JSON.stringify(required)) problems.push(`${at} does not require every property`)
      }
      for (const [key, value] of Object.entries(node)) {
        if (Array.isArray(value)) value.forEach((item, index) => visit(item, `${at}.${key}[${index}]`))
        else visit(value, `${at}.${key}`)
      }
    }
    visit(GUIDE_SCHEMA, 'schema')

    expect(problems).toEqual([])
    expect(objects).toEqual([
      'schema',
      'schema.properties.overview',
      'schema.properties.flow',
      'schema.properties.flow.properties.nodes.items',
      'schema.properties.flow.properties.edges.items',
      'schema.properties.chapters.items'
    ])
  })
})

describe('buildGuidePrompt', () => {
  it('fits patches into the budget core-first and still lists every file', () => {
    const files: ChangedFile[] = []
    for (let n = 0; n < 5; n++) {
      const lines = ['@@ -0,0 +1,2000 @@']
      for (let line = 0; line < 2000; line++) lines.push(`+export const value${n}_${line} = ${line}`)
      files.push(changed(`src/core${n}.ts`, 'added', lines))
    }
    files.push(changed('package-lock.json', 'modified', ['@@ -1,1 +1,1 @@', '-"a": 1', '+"a": 2']))
    files.push({ ...changed('assets/logo.png', 'added', []), patch: null })

    const { user } = buildGuidePrompt(pullWith(files, 'Splits the core into parts.'))

    expect(user.length).toBeLessThan(185_000)
    expect(user).toContain('Splits the core into parts.')
    for (const file of files) expect(user).toContain(file.path)
    for (let n = 0; n < 5; n++) expect(user).toContain(`<patch path="src/core${n}.ts">`)
    expect(user).toContain('[patch truncated, ')
    expect(user).not.toContain('<patch path="package-lock.json">')
    expect(user).not.toContain('<patch path="assets/logo.png">')
  })
})
