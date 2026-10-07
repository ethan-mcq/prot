import { parsePatch } from './diff'
import type { ChangedFile, CodeChange, CodeIndex, CodeSymbol, DiffHunk, LineRange, SymbolKind } from './types'

export type Ref =
  | { kind: 'name'; name: string; line: number; member: boolean }
  | { kind: 'dir'; dir: string; line: number }

export type ParsedSymbol = {
  name: string
  qualifiedName: string
  kind: SymbolKind
  parent: number | null
  range: LineRange
  refs: Ref[]
  decorators: string[]
  aliases: string[]
}

export type ParsedVersion = { symbols: ParsedSymbol[]; moduleRefs: Ref[] }

export type ParsedFile = {
  path: string
  family: string
  file: ChangedFile | null
  head: ParsedVersion | null
  base: ParsedVersion | null
}

export const MODULE_NAME = '(module)'

type Entry = { symbol: CodeSymbol; family: string; refs: Ref[]; aliases: string[] }

function keyed(symbols: ParsedSymbol[]): string[] {
  const seen = new Map<string, number>()
  const keys: string[] = []
  for (const symbol of symbols) {
    const count = (seen.get(symbol.qualifiedName) ?? 0) + 1
    seen.set(symbol.qualifiedName, count)
    keys.push(count === 1 ? symbol.qualifiedName : `${symbol.qualifiedName}~${count}`)
  }
  return keys
}

function contains(range: LineRange, line: number): boolean {
  return line >= range.start && line <= range.end
}

function width(range: LineRange): number {
  return range.end - range.start
}

function ownerOf(symbols: ParsedSymbol[], line: number): number | null {
  let best: number | null = null
  symbols.forEach((symbol, index) => {
    if (!contains(symbol.range, line)) return
    const current = best === null ? undefined : symbols[best]
    if (current === undefined || width(symbol.range) < width(current.range)) best = index
  })
  return best
}

function changedLines(hunks: DiffHunk[]): { added: number[]; deleted: number[] } {
  const added: number[] = []
  const deleted: number[] = []
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.kind === 'add' && line.newLine !== null) added.push(line.newLine)
      if (line.kind === 'del' && line.oldLine !== null) deleted.push(line.oldLine)
    }
  }
  return { added, deleted }
}

function owned(version: ParsedVersion | null, lines: number[]): Map<number, number> {
  const counts = new Map<number, number>()
  if (version === null) return counts
  for (const line of lines) {
    const owner = ownerOf(version.symbols, line)
    if (owner !== null) counts.set(owner, (counts.get(owner) ?? 0) + 1)
  }
  return counts
}

function symbolChange(head: boolean, base: boolean, changes: number, file: ChangedFile | null): CodeChange | null {
  if (file === null || changes === 0) return head ? 'context' : null
  if (head && base) return 'modified'
  return head ? 'added' : 'deleted'
}

type Block = { head: number[]; base: number[] }

function moduleBlocks(hunks: DiffHunk[], head: ParsedVersion | null, base: ParsedVersion | null): Block[] {
  const blocks: Block[] = []
  let block: Block | null = null
  const close = () => {
    if (block !== null) blocks.push(block)
    block = null
  }
  const inHead = (line: number | null) => head !== null && line !== null && ownerOf(head.symbols, line) !== null
  const inBase = (line: number | null) => base !== null && line !== null && ownerOf(base.symbols, line) !== null
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.kind === 'context') {
        if (inHead(line.newLine)) close()
        continue
      }
      const ownedLine = line.kind === 'add' ? inHead(line.newLine) : inBase(line.oldLine)
      if (ownedLine) {
        close()
        continue
      }
      block ??= { head: [], base: [] }
      if (line.kind === 'add' && line.newLine !== null) block.head.push(line.newLine)
      if (line.kind === 'del' && line.oldLine !== null) block.base.push(line.oldLine)
    }
    close()
  }
  return blocks
}

function span(lines: number[]): LineRange | null {
  if (lines.length === 0) return null
  return { start: Math.min(...lines), end: Math.max(...lines) }
}

function refsWithin(refs: Ref[], range: LineRange | null): Ref[] {
  if (range === null) return []
  return refs.filter((ref) => contains(range, ref.line))
}

function moduleChange(block: Block, file: ChangedFile): CodeChange {
  if (block.base.length === 0 && file.status === 'added') return 'added'
  if (block.head.length === 0 && file.status === 'removed') return 'deleted'
  return 'modified'
}

function fileEntries(parsed: ParsedFile): Entry[] {
  const { file, head, base, path, family } = parsed
  const hunks = file?.patch ? parsePatch(file.patch) : []
  const { added, deleted } = changedLines(hunks)
  const headOwned = owned(head, added)
  const baseOwned = owned(base, deleted)
  const headKeys = head === null ? [] : keyed(head.symbols)
  const baseKeys = base === null ? [] : keyed(base.symbols)
  const baseIndex = new Map(baseKeys.map((key, index) => [key, index]))

  const order: { key: string; h: number | null; b: number | null }[] = []
  headKeys.forEach((key, index) => order.push({ key, h: index, b: baseIndex.get(key) ?? null }))
  const inHead = new Set(headKeys)
  baseKeys.forEach((key, index) => {
    if (!inHead.has(key)) order.push({ key, h: null, b: index })
  })

  const kept = new Map<string, Entry>()
  const parentKeys = new Map<string, string | null>()
  for (const { key, h, b } of order) {
    const headSymbol = h === null ? undefined : head?.symbols[h]
    const baseSymbol = b === null ? undefined : base?.symbols[b]
    const source = headSymbol ?? baseSymbol
    if (source === undefined) continue
    const changes = (h === null ? 0 : (headOwned.get(h) ?? 0)) + (b === null ? 0 : (baseOwned.get(b) ?? 0))
    const change = symbolChange(headSymbol !== undefined, baseSymbol !== undefined, changes, file)
    if (change === null) continue
    const parentIndex = source.parent
    const parentKey = parentIndex === null ? null : ((headSymbol ? headKeys : baseKeys)[parentIndex] ?? null)
    parentKeys.set(key, parentKey)
    kept.set(key, {
      family,
      refs: source.refs,
      aliases: source.aliases,
      symbol: {
        id: `${path}#${key}`,
        path,
        name: source.name,
        qualifiedName: source.qualifiedName,
        kind: source.kind,
        parentId: null,
        head: headSymbol?.range ?? null,
        base: baseSymbol?.range ?? null,
        change,
        calls: [],
        callLines: {},
        decorators: source.decorators
      }
    })
  }
  for (const [key, entry] of kept) {
    const parentKey = parentKeys.get(key)
    if (parentKey !== undefined && parentKey !== null && kept.has(parentKey)) entry.symbol.parentId = `${path}#${parentKey}`
  }

  const entries = [...kept.values()]
  if (file === null) return entries
  moduleBlocks(hunks, head, base).forEach((block, index) => {
    const headRange = span(block.head)
    const baseRange = span(block.base)
    const key = index === 0 ? MODULE_NAME : `${MODULE_NAME}~${index + 1}`
    entries.push({
      family,
      aliases: [],
      refs: [...refsWithin(head?.moduleRefs ?? [], headRange), ...refsWithin(base?.moduleRefs ?? [], baseRange)],
      symbol: {
        id: `${path}#${key}`,
        path,
        name: MODULE_NAME,
        qualifiedName: MODULE_NAME,
        kind: 'module',
        parentId: null,
        head: headRange,
        base: baseRange,
        change: moduleChange(block, file),
        calls: [],
        callLines: {},
        decorators: []
      }
    })
  })
  return entries
}

function dirOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? '' : path.slice(0, slash)
}

const TIER = { path: 2, family: 1 }

// A name in one language never resolves to a symbol in another: Kotlin `ShareInbox.push` is not the TSX `ShareInbox`.
function resolveName(entry: Entry, ref: Extract<Ref, { kind: 'name' }>, byName: Map<string, Entry[]>): Entry | null {
  let best: Entry | null = null
  let bestTier = 0
  for (const candidate of byName.get(ref.name) ?? []) {
    if (candidate === entry) continue
    if (candidate.family !== entry.family) continue
    const tier = candidate.symbol.path === entry.symbol.path ? TIER.path : TIER.family
    if (tier > bestTier) {
      best = candidate
      bestTier = tier
    }
  }
  return best
}

function resolveCalls(entries: Entry[]): void {
  const byName = new Map<string, Entry[]>()
  const byDir = new Map<string, Entry[]>()
  for (const entry of entries) {
    if (entry.symbol.kind === 'module' || entry.symbol.kind === 'test') continue
    for (const name of [entry.symbol.name, ...entry.aliases]) byName.set(name, [...(byName.get(name) ?? []), entry])
    const dir = dirOf(entry.symbol.path)
    byDir.set(dir, [...(byDir.get(dir) ?? []), entry])
  }
  for (const entry of entries) {
    const { symbol } = entry
    const record = (target: Entry, line: number) => {
      if (target === entry) return
      const id = target.symbol.id
      if (!symbol.calls.includes(id)) symbol.calls.push(id)
      const lines = symbol.callLines[id] ?? []
      if (!lines.includes(line)) lines.push(line)
      symbol.callLines[id] = lines
    }
    for (const ref of entry.refs) {
      if (ref.kind === 'dir') {
        for (const target of byDir.get(ref.dir) ?? []) record(target, ref.line)
        continue
      }
      const target = resolveName(entry, ref, byName)
      if (target !== null) record(target, ref.line)
    }
  }
}

export function assembleIndex(headSha: string, files: ParsedFile[], skipped: string[]): CodeIndex {
  const entries: Entry[] = []
  for (const file of files) entries.push(...fileEntries(file))
  resolveCalls(entries)
  return { headSha, symbols: entries.map((entry) => entry.symbol), skipped }
}
