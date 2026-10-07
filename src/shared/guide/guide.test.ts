import { describe, expect, it } from 'vitest'
import type { ChangedFile, Guide } from '../types'
import { added, capySharePull, changed, KOTLIN_MODULE, MAIN_ACTIVITY, pullWith, SWIFT_MODULE } from './fixtures'
import { buildHeuristicGuide, classifyFile } from './index'

function edgeLabels(guide: Guide): string[] {
  const labels = new Map<string, string>()
  for (const node of guide.flow.nodes) labels.set(node.id, node.label)
  const result: string[] = []
  for (const edge of guide.flow.edges) result.push(`${labels.get(edge.from)} -> ${labels.get(edge.to)}`)
  return result
}

describe('classifyFile', () => {
  it.each([
    ['packages/mobile/src/share/send.ts', 'core'],
    ['packages/mobile/src/share/share-sheet.tsx', 'ui'],
    ['packages/mobile/src/share/__tests__/send.test.ts', 'test'],
    ['web/src/Button.spec.tsx', 'test'],
    ['server/handlers_test.go', 'test'],
    ['api/tests/test_orders.py', 'test'],
    ['web/src/__snapshots__/Button.test.tsx.snap', 'generated'],
    ['proto/orders.pb.go', 'generated'],
    ['package-lock.json', 'deps'],
    ['go.sum', 'deps'],
    ['package.json', 'build'],
    ['packages/mobile/scripts/testflight.sh', 'build'],
    ['native/CMakeLists.txt', 'build'],
    ['packages/mobile/app.config.ts', 'config'],
    ['.github/workflows/ci.yml', 'config'],
    ['tsconfig.node.json', 'config'],
    ['api/alembic/versions/3f2a_add_orders.py', 'schema'],
    ['schema.graphql', 'schema'],
    ['packages/mobile/README.md', 'docs'],
    ['assets/icon.svg', 'assets']
  ])('%s is %s', (path, role) => {
    expect(classifyFile(path)).toBe(role)
  })
})

describe('buildHeuristicGuide', () => {
  it('orders chapters core first and lockfiles last on a multi-package PR', () => {
    const guide = buildHeuristicGuide(capySharePull)

    expect(guide.source).toBe('heuristic')
    expect(guide.headSha).toBe('head123')
    expect(guide.chapters.map(({ id, title, files }) => ({ id, title, files }))).toEqual([
      { id: 'ch-1', title: 'Capy share module in modules/capy-share', files: [KOTLIN_MODULE, SWIFT_MODULE] },
      {
        id: 'ch-2',
        title: 'With share extension in plugins',
        files: ['packages/mobile/plugins/with-share-extension.js']
      },
      { id: 'ch-3', title: 'Main activity in android', files: [MAIN_ACTIVITY] },
      {
        id: 'ch-4',
        title: 'Share sheet UI in src/share',
        files: [
          'packages/mobile/src/share/share-sheet.tsx',
          'packages/mobile/src/share/share-inbox.tsx',
          'packages/mobile/src/share/send.ts',
          'packages/mobile/src/chat/thread-store.ts'
        ]
      },
      {
        id: 'ch-5',
        title: 'Config and build scripts',
        files: ['packages/mobile/app.config.ts', 'packages/mobile/scripts/testflight.sh']
      },
      { id: 'ch-6', title: 'Docs', files: ['packages/mobile/README.md'] },
      { id: 'ch-7', title: 'Tests', files: ['packages/mobile/src/share/__tests__/send.test.ts'] },
      { id: 'ch-8', title: 'Lockfiles', files: ['package-lock.json'] }
    ])
    expect(guide.chapters[0]?.summary).toBe(
      '2 new files, +37 -0 lines. Adds takeShare(), CapyShareModule and definition().'
    )
    expect(guide.chapters[7]?.summary).toBe(
      '1 modified file, +48 -2 lines. Safe to skim unless a dependency version matters.'
    )
  })

  it('puts every file in exactly one of at most eight chapters on a large PR', () => {
    const files: ChangedFile[] = []
    for (let area = 0; area < 12; area++) {
      for (let n = 0; n < 5; n++) {
        files.push(added(`apps/web/src/area${area}/part${n}.ts`, [`export const v${n} = ${area}`]))
      }
    }
    for (let n = 0; n < 20; n++) files.push(added(`apps/web/tests/case${n}.test.ts`, ['it.todo("x")']))
    files.push(added('apps/web/docs/guide.md', ['# Guide']))
    files.push(added('yarn.lock', ['lock']))
    const paths = files.map((file) => file.path)

    const guide = buildHeuristicGuide(pullWith(files))
    const placed = guide.chapters.flatMap((chapter) => chapter.files)

    expect(placed.length).toBe(82)
    expect([...placed].sort()).toEqual([...paths].sort())
    expect(guide.chapters.length).toBe(8)
    expect(guide.chapters.map((chapter) => chapter.id)).toEqual([
      'ch-1',
      'ch-2',
      'ch-3',
      'ch-4',
      'ch-5',
      'ch-6',
      'ch-7',
      'ch-8'
    ])
  })

  it('summarizes the PR body without template noise, or describes the diff when the body is empty', () => {
    const { overview } = buildHeuristicGuide(capySharePull)
    expect(overview.summary).toBe(
      'Adds a share extension so people can share text from any app straight into a Capy thread. Android delivers the share through MainActivity, iOS through an app group.'
    )
    expect(overview.points).toHaveLength(8)
    expect(overview.points[0]).toBe('Capy share module in modules/capy-share (2 files)')
    expect(overview.points[7]).toBe('Lockfiles (1 file)')

    const bare = pullWith([added('src/share/send.ts', ['export const a = 1', 'export const b = 2'])])
    expect(buildHeuristicGuide(bare).overview.summary).toBe('Changes 1 file (+2 -0), mostly in src/share.')
  })

  it('traces how the new symbols call each other, main path first', () => {
    const guide = buildHeuristicGuide(capySharePull)
    const { flow } = guide

    expect(flow.caption).toBe('How the new code connects, starting from ShareInbox')
    expect(flow.nodes.map(({ label, change, chapterId }) => ({ label, change, chapterId }))).toEqual([
      { label: 'ShareInbox', change: 'added', chapterId: 'ch-4' },
      { label: 'ShareSheet', change: 'added', chapterId: 'ch-4' },
      { label: 'useShareSend()', change: 'added', chapterId: 'ch-4' },
      { label: 'appendMessage()', change: 'context', chapterId: 'ch-4' },
      { label: 'definition()', change: 'added', chapterId: 'ch-1' },
      { label: 'MainActivity', change: 'modified', chapterId: 'ch-3' },
      { label: 'onNewIntent()', change: 'added', chapterId: 'ch-3' },
      { label: 'takeShare()', change: 'added', chapterId: 'ch-1' }
    ])
    expect(edgeLabels(guide)).toEqual([
      'ShareInbox -> takeShare()',
      'ShareInbox -> ShareSheet',
      'ShareSheet -> useShareSend()',
      'useShareSend() -> appendMessage()',
      'definition() -> takeShare()',
      'MainActivity -> onNewIntent()',
      'onNewIntent() -> takeShare()'
    ])
  })

  it('keeps a long call chain to its first eight symbols', () => {
    const source: string[] = []
    for (let n = 0; n < 12; n++) {
      source.push(`export function step${n}() {`, `  return step${n + 1}()`, '}')
    }
    const guide = buildHeuristicGuide(pullWith([added('src/pipeline.ts', source)]))

    expect(guide.flow.nodes.map((node) => node.label)).toEqual([
      'step0()',
      'step1()',
      'step2()',
      'step3()',
      'step4()',
      'step5()',
      'step6()',
      'step7()'
    ])
    expect(edgeLabels(guide)).toEqual([
      'step0() -> step1()',
      'step1() -> step2()',
      'step2() -> step3()',
      'step3() -> step4()',
      'step4() -> step5()',
      'step5() -> step6()',
      'step6() -> step7()'
    ])
  })

  it('falls back to relative imports between changed files when no symbols are declared', () => {
    const files = [
      added('web/src/app.ts', ["import { start } from './boot'", "import './styles'", 'start()']),
      added('web/src/boot.ts', ['export { start } from "./internal"']),
      changed('api/pkg/main.py', 'modified', ['@@ -1,1 +1,2 @@', ' import os', '+from .util import helper']),
      added('api/pkg/util.py', ['helper = print'])
    ]
    const { flow } = buildHeuristicGuide(pullWith(files))

    expect(flow.caption).toBe('How the changed files connect')
    expect(flow.nodes.map(({ id, label, change }) => ({ id, label, change }))).toEqual([
      { id: 'web/src/app.ts', label: 'app.ts', change: 'added' },
      { id: 'web/src/boot.ts', label: 'boot.ts', change: 'added' },
      { id: 'api/pkg/main.py', label: 'main.py', change: 'modified' },
      { id: 'api/pkg/util.py', label: 'util.py', change: 'added' }
    ])
    expect(flow.edges).toEqual([
      { from: 'web/src/app.ts', to: 'web/src/boot.ts' },
      { from: 'api/pkg/main.py', to: 'api/pkg/util.py' }
    ])
  })
})
