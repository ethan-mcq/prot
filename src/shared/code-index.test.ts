import { describe, expect, it } from 'vitest'
import { assembleIndex, type ParsedSymbol, type ParsedVersion, type Ref } from './code-index'
import { parsePatch } from './diff'
import { focusRows, symbolRows, type SymbolRow } from './symbol-rows'
import type { ChangedFile, CodeSymbol } from './types'

function sym(qualifiedName: string, start: number, end: number, extra: Partial<ParsedSymbol> = {}): ParsedSymbol {
  const name = qualifiedName.split('.').at(-1) ?? qualifiedName
  return { name, qualifiedName, kind: 'function', parent: null, range: { start, end }, refs: [], decorators: [], aliases: [], ...extra }
}

function version(symbols: ParsedSymbol[], moduleRefs: Ref[] = []): ParsedVersion {
  return { symbols, moduleRefs }
}

function file(path: string, status: ChangedFile['status'], patch: string): ChangedFile {
  return { path, previousPath: null, status, additions: 0, deletions: 0, patch }
}

function call(name: string, line: number, member = false): Ref {
  return { kind: 'name', name, line, member }
}

type Row = Pick<CodeSymbol, 'id' | 'change' | 'head' | 'base' | 'parentId'>

function rows(symbols: CodeSymbol[]): Row[] {
  return symbols.map(({ id, change, head, base, parentId }) => ({ id, change, head, base, parentId }))
}

const SEND = 'src/send.ts'
const sendPatch = [
  '@@ -1,9 +1,10 @@',
  " import { a } from './a'",
  "+import { b } from './b'",
  ' ',
  ' export function send() {',
  '-  return a()',
  '+  return b()',
  ' }',
  ' ',
  ' export function keep() {',
  '   return 1',
  ' }'
].join('\n')

const MODULE_KT = 'app/Share.kt'
const addedClass = [
  '@@ -0,0 +1,6 @@',
  '+class Share {',
  '+  fun take() {',
  '+    stage()',
  '+  }',
  '+  fun stage() {}',
  '+}'
].join('\n')

const OLD = 'src/old.ts'
const removedFn = [
  '@@ -1,6 +1,3 @@',
  ' export function stay() {',
  ' }',
  '-export function gone() {',
  '-  return 1',
  '-}',
  ' '
].join('\n')

describe('assembleIndex maps diff hunks onto symbols', () => {
  it.each<{ name: string; files: Parameters<typeof assembleIndex>[1]; expected: Row[] }>([
    {
      name: 'a modified file: the edited function is modified, the untouched one is context, the import is a module block',
      files: [
        {
          path: SEND,
          family: 'js',
          file: file(SEND, 'modified', sendPatch),
          head: version([sym('send', 4, 7), sym('keep', 8, 10)]),
          base: version([sym('send', 3, 6), sym('keep', 7, 9)])
        }
      ],
      expected: [
        { id: 'src/send.ts#send', change: 'modified', head: { start: 4, end: 7 }, base: { start: 3, end: 6 }, parentId: null },
        { id: 'src/send.ts#keep', change: 'context', head: { start: 8, end: 10 }, base: { start: 7, end: 9 }, parentId: null },
        { id: 'src/send.ts#(module)', change: 'modified', head: { start: 2, end: 2 }, base: null, parentId: null }
      ]
    },
    {
      name: 'an added file: the class and its members are added and members point at the class',
      files: [
        {
          path: MODULE_KT,
          family: 'jvm',
          file: file(MODULE_KT, 'added', addedClass),
          head: version([sym('Share', 1, 6, { kind: 'class' }), sym('Share.take', 2, 4, { parent: 0 }), sym('Share.stage', 5, 5, { parent: 0 })]),
          base: null
        }
      ],
      expected: [
        { id: 'app/Share.kt#Share', change: 'added', head: { start: 1, end: 6 }, base: null, parentId: null },
        { id: 'app/Share.kt#Share.take', change: 'added', head: { start: 2, end: 4 }, base: null, parentId: 'app/Share.kt#Share' },
        { id: 'app/Share.kt#Share.stage', change: 'added', head: { start: 5, end: 5 }, base: null, parentId: 'app/Share.kt#Share' }
      ]
    },
    {
      name: 'a function removed from a modified file is deleted with only a base range',
      files: [
        {
          path: OLD,
          family: 'js',
          file: file(OLD, 'modified', removedFn),
          head: version([sym('stay', 1, 2)]),
          base: version([sym('stay', 1, 2), sym('gone', 3, 5)])
        }
      ],
      expected: [
        { id: 'src/old.ts#stay', change: 'context', head: { start: 1, end: 2 }, base: { start: 1, end: 2 }, parentId: null },
        { id: 'src/old.ts#gone', change: 'deleted', head: null, base: { start: 3, end: 5 }, parentId: null }
      ]
    },
    {
      name: 'two symbols with one qualified name get distinct ids',
      files: [
        {
          path: 'a.py',
          family: 'py',
          file: file('a.py', 'added', '@@ -0,0 +1,2 @@\n+def f(): pass\n+def f(): pass'),
          head: version([sym('f', 1, 1), sym('f', 2, 2)]),
          base: null
        }
      ],
      expected: [
        { id: 'a.py#f', change: 'added', head: { start: 1, end: 1 }, base: null, parentId: null },
        { id: 'a.py#f~2', change: 'added', head: { start: 2, end: 2 }, base: null, parentId: null }
      ]
    }
  ])('$name', ({ files, expected }) => {
    expect(rows(assembleIndex('sha', files, []).symbols)).toEqual(expected)
  })
})

describe('assembleIndex resolves references by name', () => {
  it('prefers the same file, then the same language, and never resolves a name into another language', () => {
    const index = assembleIndex(
      'sha',
      [
        {
          path: 'web/a.ts',
          family: 'js',
          file: null,
          head: version([
            sym('run', 1, 5, { refs: [call('push', 2), call('helper', 3), call('Share', 4), call('take', 5, true)] }),
            sym('helper', 6, 7)
          ]),
          base: null
        },
        { path: 'web/b.ts', family: 'js', file: null, head: version([sym('push', 1, 2), sym('helper', 3, 4)]), base: null },
        {
          path: 'app/Share.kt',
          family: 'jvm',
          file: null,
          head: version([sym('Share', 1, 9, { kind: 'class' }), sym('Share.take', 2, 3, { parent: 0 })]),
          base: null
        }
      ],
      []
    )
    const run = index.symbols.find((symbol) => symbol.id === 'web/a.ts#run')
    expect({ calls: run?.calls, callLines: run?.callLines }).toEqual({
      calls: ['web/b.ts#push', 'web/a.ts#helper'],
      callLines: { 'web/b.ts#push': [2], 'web/a.ts#helper': [3] }
    })
  })

  it('links a directory reference to every symbol in that directory, as a Terraform module source does', () => {
    const index = assembleIndex(
      'sha',
      [
        {
          path: 'infra/main.tf',
          family: 'tf',
          file: null,
          head: version([sym('module.logs', 1, 3, { kind: 'class', refs: [{ kind: 'dir', dir: 'infra/modules/logs', line: 2 }] })]),
          base: null
        },
        {
          path: 'infra/modules/logs/main.tf',
          family: 'tf',
          file: null,
          head: version([sym('aws_s3_bucket.logs', 1, 3, { kind: 'constant' }), sym('var.retention', 4, 6, { kind: 'type' })]),
          base: null
        }
      ],
      []
    )
    expect(index.symbols[0]?.calls).toEqual(['infra/modules/logs/main.tf#aws_s3_bucket.logs', 'infra/modules/logs/main.tf#var.retention'])
  })
})

describe('symbolRows', () => {
  const hunks = parsePatch(sendPatch)
  const head = [
    "import { a } from './a'",
    "import { b } from './b'",
    '',
    'export function send() {',
    '  return b()',
    '}',
    '',
    'export function keep() {',
    '  return 1',
    '}'
  ]
  const index = assembleIndex(
    'sha',
    [
      {
        path: SEND,
        family: 'js',
        file: file(SEND, 'modified', sendPatch),
        head: version([sym('send', 4, 7), sym('keep', 8, 10)]),
        base: version([sym('send', 3, 6), sym('keep', 7, 9)])
      }
    ],
    []
  )
  const byId = new Map(index.symbols.map((symbol) => [symbol.id, symbol]))
  const text = (symbolId: string, lines: string[] | null) => {
    const symbol = byId.get(symbolId)
    if (!symbol) throw new Error(symbolId)
    return symbolRows(symbol, [], hunks, lines).map((row) =>
      row.kind === 'line' ? `${row.line.kind[0]} ${row.line.oldLine ?? '-'} ${row.line.newLine ?? '-'} ${row.line.text}` : row.kind
    )
  }

  it('shows only the symbol lines, with the removed line interleaved where it was', () => {
    expect(text('src/send.ts#send', head)).toEqual([
      'c 3 4 export function send() {',
      'd 4 -   return a()',
      'a - 5   return b()',
      'c 5 6 }',
      'c 6 7 '
    ])
  })

  it('fills unchanged lines past the hunk from the head file and numbers the old side', () => {
    expect(text('src/send.ts#keep', head)).toEqual(['c 7 8 export function keep() {', 'c 8 9   return 1', 'c 9 10 }'])
  })

  it('folds a member into one row inside its class', () => {
    const cls: CodeSymbol = { ...(byId.get('src/send.ts#send') as CodeSymbol), id: 'C', head: { start: 1, end: 10 }, base: null }
    const member = byId.get('src/send.ts#keep') as CodeSymbol
    const result = symbolRows(cls, [member], hunks, head).map((row) => (row.kind === 'fold' ? `fold ${row.line}` : row.kind === 'line' ? row.line.newLine : row.kind))
    expect(result).toEqual([1, 2, 3, 4, 5, 6, 7, 'fold 8'])
  })
})

describe('focusRows', () => {
  const contextRow = (n: number, mark = false): SymbolRow => ({ kind: 'line', line: { kind: 'context', oldLine: n, newLine: n, text: `l${n}` }, mark })
  const addRow = (n: number): SymbolRow => ({ kind: 'line', line: { kind: 'add', oldLine: null, newLine: n, text: `l${n}` }, mark: false })
  const body = (count: number, special: Record<number, SymbolRow>) =>
    Array.from({ length: count }, (_, i) => special[i + 1] ?? contextRow(i + 1))
  const shape = (rows: SymbolRow[]) =>
    rows.map((row) => (row.kind === 'gap' ? `gap ${row.lines}` : row.kind === 'line' ? `${row.line.kind[0]}${row.line.newLine}` : 'fold'))

  it.each([
    {
      name: 'a short symbol stays whole',
      rows: body(6, { 4: addRow(4) }),
      expected: ['c1', 'c2', 'c3', 'a4', 'c5', 'c6']
    },
    {
      name: 'a long symbol keeps its signature and three lines around a late change',
      rows: body(40, { 35: addRow(35) }),
      expected: ['c1', 'c2', 'gap 29', 'c32', 'c33', 'c34', 'a35', 'c36', 'c37', 'c38', 'gap 2']
    },
    {
      name: 'a marked call site anchors like a change',
      rows: body(40, { 20: contextRow(20, true) }),
      expected: ['c1', 'c2', 'gap 14', 'c17', 'c18', 'c19', 'c20', 'c21', 'c22', 'c23', 'gap 17']
    }
  ])('$name', ({ rows, expected }) => {
    expect(shape(focusRows(rows))).toEqual(expected)
  })

  it('keeps the folded rows inside the gap so the card can expand them', () => {
    const rows = body(40, { 35: addRow(35) })
    const gap = focusRows(rows)[2]
    expect(gap?.kind === 'gap' ? shape(gap.rows) : null).toEqual(shape(rows.slice(2, 31)))
  })
})
