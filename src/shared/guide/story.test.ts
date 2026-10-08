import { describe, expect, it } from 'vitest'
import { assembleIndex, type ParsedSymbol } from '../code-index'
import { parsePatch } from '../diff'
import { symbolRows } from '../symbol-rows'
import type { CodeIndex, CodeSymbol, Guide, PullDetail } from '../types'
import { added, capyStoryIndex, capyStoryPull, changed, codeSymbol, pullWith, STORY } from './fixtures'
import { buildStoryGuide } from './story'

function outline(guide: Guide): string[] {
  return guide.chapters.map((chapter) => {
    const cards = chapter.cards.map((card) => {
      const name = guide.symbols[card.symbolId]?.qualifiedName ?? card.symbolId
      const see = card.seeChapterId === null ? '' : ` see ${card.seeChapterId}`
      const excerpt = card.excerpt === null ? '' : ` lines ${card.excerpt.map((range) => `${range.start}-${range.end}`).join(',')}`
      return `${card.role} ${name}${see}${excerpt}`
    })
    return [chapter.title, ...cards].join(' | ')
  })
}

function fullCards(guide: Guide): CodeSymbol[] {
  const result: CodeSymbol[] = []
  for (const chapter of guide.chapters) {
    for (const card of chapter.cards) {
      const symbol = guide.symbols[card.symbolId]
      if (symbol && card.seeChapterId === null && symbol.change !== 'context') result.push(symbol)
    }
  }
  return result
}

// Every added and deleted line of an indexed file, and how many full cards show it.
function lineCoverage(guide: Guide, detail: PullDetail): { lines: number; once: number } {
  const symbols = Object.values(guide.symbols)
  const indexed = new Set(symbols.filter((symbol) => symbol.change !== 'context').map((symbol) => symbol.path))
  const shown = new Map<string, number>()
  for (const file of detail.files) {
    if (!indexed.has(file.path) || file.patch === null) continue
    for (const hunk of parsePatch(file.patch)) {
      for (const line of hunk.lines) {
        if (line.kind === 'add') shown.set(`${file.path}:+${line.newLine}`, 0)
        if (line.kind === 'del') shown.set(`${file.path}:-${line.oldLine}`, 0)
      }
    }
  }
  for (const symbol of fullCards(guide)) {
    const file = detail.files.find((candidate) => candidate.path === symbol.path)
    const children = symbols.filter((child) => child.parentId === symbol.id)
    for (const row of symbolRows(symbol, children, parsePatch(file?.patch ?? ''), null)) {
      if (row.kind !== 'line' || row.line.kind === 'context') continue
      const key = row.line.kind === 'add' ? `${symbol.path}:+${row.line.newLine}` : `${symbol.path}:-${row.line.oldLine}`
      shown.set(key, (shown.get(key) ?? 0) + 1)
    }
  }
  return { lines: shown.size, once: [...shown.values()].filter((count) => count === 1).length }
}

describe('buildStoryGuide on the Capy share PR', () => {
  const guide = buildStoryGuide(capyStoryPull, capyStoryIndex)

  it('reads entry first, helpers depth first in call order, data after functions, tests last, and points back instead of repeating', () => {
    expect(outline(guide)).toEqual([
      [
        'takeShare enters through MainActivity.onNewIntent',
        'entry MainActivity.onNewIntent',
        'step CapyShareModule',
        'step CapyShareModule.takeShare',
        'helper CapyShareModule.stageItems',
        'helper CapyShareModule.readUris',
        'helper SharedItem',
        'helper CapyShareModule.mimeOf',
        'helper ShareInbox',
        'helper ShareInbox.push',
        'data MAX_SHARE_ITEMS',
        'data (module)',
        'data (module)',
        'data (module)',
        'test CapyShareModuleTest',
        'test CapyShareModuleTest › stagesEveryUri',
        'test (module)'
      ].join(' | '),
      'normalizeText enters through appendMessage | entry appendMessage | step normalizeText | data MAX_MESSAGE_LENGTH',
      [
        'New ShareInbox and what it calls',
        'entry ShareInbox',
        'step useSharedItems',
        'step ShareSheet',
        'helper useShareSend',
        'data CapyShare',
        'data NativeSharedItem',
        'data MAX_MESSAGE_LENGTH see ch-2',
        'data CapyShareModule',
        'data (module)',
        'data (module)',
        'data (module)',
        'data (module)',
        'test uploads every shared item',
        'test (module)'
      ].join(' | '),
      'Other tests | test formats today | test (module)',
      'Config'
    ])
  })

  it('titles and summarizes sections in plain words from the root and its role', () => {
    expect(guide.chapters.map((chapter) => chapter.summary).slice(0, 4)).toEqual([
      'CapyShareModule.takeShare is new and calls stageItems, ShareInbox and push; 6 helpers, 1 data type, 1 test.',
      'normalizeText changes; 1 data type.',
      'ShareInbox is new and calls useSharedItems and ShareSheet; 1 helper, 3 data types, 1 test.',
      'Tests that reference nothing else in this story: formats today.'
    ])
  })

  it('shows every changed symbol as a full card exactly once and puts every changed file in a chapter', () => {
    const changedIds = capyStoryIndex.symbols.filter((symbol) => symbol.change !== 'context').map((symbol) => symbol.id)
    const shown = fullCards(guide).map((symbol) => symbol.id)
    expect({ shown: shown.length, distinct: new Set(shown).size, changed: changedIds.length }).toEqual({ shown: 33, distinct: 33, changed: 33 })
    expect(new Set(shown)).toEqual(new Set(changedIds))
    const inChapters = new Set(guide.chapters.flatMap((chapter) => chapter.files))
    expect(capyStoryPull.files.filter((file) => !inChapters.has(file.path)).map((file) => file.path)).toEqual([])
    expect(inChapters.size).toBe(capyStoryPull.files.length)
  })

  it('shows every added and deleted line in exactly one full card', () => {
    expect(lineCoverage(guide, capyStoryPull)).toEqual({ lines: 99, once: 99 })
  })

  it('draws the story map from section roots and steps, linked by their calls', () => {
    const name = (id: string) => guide.symbols[id]?.qualifiedName
    expect({
      nodes: guide.flow.nodes.map((node) => `${node.chapterId} ${node.change} ${node.label}`),
      edges: guide.flow.edges.map((edge) => `${name(edge.from)} -> ${name(edge.to)}`)
    }).toEqual({
      nodes: [
        'ch-1 modified MainActivity.onNewIntent',
        'ch-1 added CapyShareModule',
        'ch-1 added CapyShareModule.takeShare',
        'ch-2 context appendMessage',
        'ch-2 modified normalizeText',
        'ch-3 added ShareInbox',
        'ch-3 added useSharedItems',
        'ch-3 added ShareSheet'
      ],
      edges: [
        'MainActivity.onNewIntent -> CapyShareModule',
        'MainActivity.onNewIntent -> CapyShareModule.takeShare',
        'appendMessage -> normalizeText',
        'ShareInbox -> useSharedItems',
        'ShareInbox -> ShareSheet'
      ]
    })
  })

  it('falls back to the quick guide when nothing was indexed', () => {
    const fallback = buildStoryGuide(capyStoryPull, { headSha: 'head123', symbols: [], skipped: [] })
    expect({ cards: fallback.chapters.flatMap((chapter) => chapter.cards), symbols: fallback.symbols, first: fallback.chapters[0]?.title }).toEqual({
      cards: [],
      symbols: {},
      first: 'Capy share module in modules/capy-share'
    })
  })
})

const ctx = (path: string, name: string, head: [number, number], calls: string[] = [], extra: Partial<Parameters<typeof codeSymbol>[2]> = {}) =>
  codeSymbol(path, name, { kind: 'function', change: 'context', head, base: head, calls, ...extra })
const mod = (path: string, name: string, head: [number, number], calls: string[] = [], extra: Partial<Parameters<typeof codeSymbol>[2]> = {}) =>
  codeSymbol(path, name, { kind: 'function', change: 'modified', head, base: head, calls, ...extra })
const ref = (path: string, name: string) => `${path}#${name}`

function storyOf(symbols: CodeSymbol[]): string[] {
  const paths = [...new Set(symbols.filter((symbol) => symbol.change !== 'context').map((symbol) => symbol.path))]
  const detail = pullWith(paths.map((path) => changed(path, 'modified', ['@@ -1 +1 @@', '-a', '+b'])))
  const index: CodeIndex = { headSha: 'head123', symbols, skipped: [] }
  return outline(buildStoryGuide(detail, index))
}

const API = 'server/src/messages.ts'
const NF = {
  process: 'pipelines/nextflow/modules/local/align/main.nf',
  subworkflow: 'pipelines/nextflow/subworkflows/local/alignment/main.nf',
  workflow: 'pipelines/nextflow/workflows/rnaseq.nf',
  dispatcher: 'pipelines/nextflow/main.nf'
}

describe('how far up the entry climbs', () => {
  it.each<{ name: string; symbols: CodeSymbol[]; expected: string[] }>([
    {
      name: 'a four-deep chain of unchanged callers stops at the nearest caller when the route is three hops up',
      symbols: [
        mod(API, 'clean', [1, 3]),
        ctx(API, 'format', [4, 6], [ref(API, 'clean')]),
        ctx(API, 'build', [7, 9], [ref(API, 'format')]),
        ctx(API, 'POST /messages', [10, 10], [ref(API, 'build')], { decorators: ['router.post'] })
      ],
      expected: ['clean enters through format | entry format | step clean']
    },
    {
      name: 'a route handler two hops up is the entry, shown as an excerpt around the call, with the caller between',
      symbols: [
        mod(API, 'clean', [1, 3]),
        ctx(API, 'format', [4, 6], [ref(API, 'clean')]),
        ctx(API, 'handle', [7, 46], [ref(API, 'format')], { decorators: ['app.post'], callLines: { [ref(API, 'format')]: [20, 22] } }),
        ctx(API, 'main', [47, 50], [ref(API, 'handle')])
      ],
      expected: ['clean enters through handle | entry handle lines 17-25 | entry format | step clean']
    },
    {
      name: 'a Python click command two hops up is the pipeline entry',
      symbols: [
        mod('pipeline/align.py', 'trim', [1, 3]),
        ctx('pipeline/align.py', 'align', [4, 8], [ref('pipeline/align.py', 'trim')]),
        ctx('pipeline/cli.py', 'cli', [1, 9], [ref('pipeline/align.py', 'align')], { decorators: ['click.command'] })
      ],
      expected: ['trim enters through cli | entry cli | entry align | step trim']
    },
    {
      name: 'a page two hops up is the frontend entry',
      symbols: [
        mod('web/src/components/badge.tsx', 'Badge', [1, 5]),
        ctx('web/src/components/card.tsx', 'Card', [1, 9], [ref('web/src/components/badge.tsx', 'Badge')]),
        ctx('web/src/pages/home.tsx', 'Home', [1, 12], [ref('web/src/components/card.tsx', 'Card')])
      ],
      expected: ['Badge enters through Home | entry Home | entry Card | step Badge']
    },
    {
      name: 'a Nextflow process climbs through its subworkflow to the product workflow, never to main.nf',
      symbols: [
        mod(NF.process, 'ALIGN', [1, 12]),
        ctx(NF.subworkflow, 'ALIGNMENT', [3, 9], [ref(NF.process, 'ALIGN')]),
        ctx(NF.workflow, 'RNASEQ', [4, 14], [ref(NF.subworkflow, 'ALIGNMENT')]),
        ctx(NF.dispatcher, 'workflow', [3, 8], [ref(NF.workflow, 'RNASEQ')])
      ],
      expected: ['ALIGN enters through RNASEQ | entry RNASEQ | entry ALIGNMENT | step ALIGN']
    },
    {
      name: 'a Nextflow process only main.nf runs has no entry',
      symbols: [mod(NF.process, 'ALIGN', [1, 12]), ctx(NF.dispatcher, 'workflow', [3, 8], [ref(NF.process, 'ALIGN')])],
      expected: ['Changes to ALIGN | entry ALIGN']
    },
    {
      name: 'Terraform groups a module block with the resources of its source directory, and the rest by directory',
      symbols: [
        mod('infra/main.tf', 'module.logs', [1, 5], [ref('infra/modules/logs/main.tf', 'aws_s3_bucket.logs'), ref('infra/modules/logs/main.tf', 'var.retention')], {
          kind: 'class'
        }),
        mod('infra/modules/logs/main.tf', 'aws_s3_bucket.logs', [1, 4], [], { kind: 'constant' }),
        mod('infra/modules/logs/main.tf', 'var.retention', [5, 8], [], { kind: 'type' }),
        mod('infra/network/vpc.tf', 'aws_vpc.main', [1, 6], [], { kind: 'constant' }),
        ctx('infra/network/vpc.tf', 'var.cidr', [7, 9], [], { kind: 'type' })
      ],
      expected: [
        'Terraform module logs | entry module.logs | step aws_s3_bucket.logs | data var.retention',
        'Terraform in infra/network | step aws_vpc.main'
      ]
    }
  ])('$name', ({ symbols, expected }) => {
    expect(storyOf(symbols)).toEqual(expected)
  })
})

describe('splitting large changes', () => {
  const ACTIONS = 'src/share/actions.ts'
  const SCREEN = 'src/share/screen.ts'
  const CAPTION = 'src/share/caption.tsx'
  const sym = (qualifiedName: string, start: number, end: number, extra: Partial<ParsedSymbol> = {}): ParsedSymbol => ({
    name: qualifiedName,
    qualifiedName,
    kind: 'function',
    parent: null,
    range: { start, end },
    refs: [],
    decorators: [],
    aliases: [],
    ...extra
  })
  const call = (name: string, line: number) => ({ kind: 'name' as const, name, line, member: false })
  const actions = [
    "import { api } from './api'",
    '',
    'export function uploadShare(id: string) {',
    '  return api.post(id)',
    '}',
    '',
    'export function formatCaption(text: string) {',
    '  return text.trim()',
    '}'
  ]
  const detail = pullWith([
    added(ACTIONS, actions),
    changed(SCREEN, 'modified', ['@@ -1,3 +1,3 @@', ' export function onShare(id: string) {', '-  return null', '+  return uploadShare(id)', ' }']),
    changed(CAPTION, 'modified', ['@@ -1,3 +1,3 @@', ' export function Caption({ text }) {', '-  return text', '+  return formatCaption(text)', ' }'])
  ])
  const index = assembleIndex(
    'head123',
    [
      {
        path: ACTIONS,
        family: 'js',
        file: detail.files[0] ?? null,
        head: { symbols: [sym('uploadShare', 3, 6), sym('formatCaption', 7, 9)], moduleRefs: [] },
        base: null
      },
      {
        path: SCREEN,
        family: 'js',
        file: detail.files[1] ?? null,
        head: { symbols: [sym('onShare', 1, 3, { refs: [call('uploadShare', 2)] })], moduleRefs: [] },
        base: { symbols: [sym('onShare', 1, 3)], moduleRefs: [] }
      },
      {
        path: CAPTION,
        family: 'js',
        file: detail.files[2] ?? null,
        head: { symbols: [sym('Caption', 1, 3, { refs: [call('formatCaption', 2)] })], moduleRefs: [] },
        base: { symbols: [sym('Caption', 1, 3)], moduleRefs: [] }
      }
    ],
    []
  )
  const guide = buildStoryGuide(detail, index)

  it('splits an added file across the sections its symbols serve and still shows each changed line once', () => {
    expect({
      outline: outline(guide),
      files: guide.chapters.map((chapter) => chapter.files),
      coverage: lineCoverage(guide, detail)
    }).toEqual({
      outline: [
        'uploadShare enters through onShare | entry onShare | step uploadShare | data (module)',
        'formatCaption enters through Caption | entry Caption | step formatCaption'
      ],
      files: [
        [SCREEN, ACTIONS],
        [CAPTION, ACTIONS]
      ],
      coverage: { lines: 13, once: 13 }
    })
  })
})
