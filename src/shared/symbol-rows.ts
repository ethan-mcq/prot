import type { CodeSymbol, DiffHunk, DiffLine, LineRange } from './types'

export type SymbolRow =
  | { kind: 'line'; line: DiffLine; mark: boolean }
  | { kind: 'fold'; symbolId: string; line: number }
  | { kind: 'gap'; lines: number }

function within(range: LineRange | null, line: number | null): boolean {
  return range !== null && line !== null && line >= range.start && line <= range.end
}

function childAt(children: CodeSymbol[], side: 'head' | 'base', line: number): CodeSymbol | null {
  for (const child of children) {
    if (within(child[side], line)) return child
  }
  return null
}

// A symbol owns its range minus its children's ranges; children render as one fold row each.
export function symbolRows(
  symbol: CodeSymbol,
  children: CodeSymbol[],
  hunks: DiffHunk[],
  head: string[] | null,
  marks: Set<number> = new Set()
): SymbolRow[] {
  const rows: SymbolRow[] = []
  const folded = new Set<string>()
  const emitHead = (line: DiffLine) => {
    const n = line.newLine
    if (!within(symbol.head, n) || n === null) return
    const child = childAt(children, 'head', n)
    if (child !== null) {
      if (!folded.has(child.id)) rows.push({ kind: 'fold', symbolId: child.id, line: n })
      folded.add(child.id)
      return
    }
    rows.push({ kind: 'line', line, mark: marks.has(n) })
  }
  const emitBase = (line: DiffLine) => {
    if (!within(symbol.base, line.oldLine) || line.oldLine === null) return
    if (childAt(children, 'base', line.oldLine) !== null) return
    rows.push({ kind: 'line', line, mark: false })
  }

  let cursor = symbol.head?.start ?? 0
  let delta = 0
  const fill = (until: number) => {
    if (symbol.head === null || head === null) {
      cursor = Math.max(cursor, until)
      return
    }
    const last = Math.min(until - 1, symbol.head.end)
    for (let n = Math.max(cursor, symbol.head.start); n <= last; n++) {
      emitHead({ kind: 'context', oldLine: n + delta, newLine: n, text: head[n - 1] ?? '' })
    }
    cursor = Math.max(cursor, until)
  }

  for (const hunk of hunks) {
    const newStart = hunk.newLines === 0 ? hunk.newStart + 1 : hunk.newStart
    const oldStart = hunk.oldLines === 0 ? hunk.oldStart + 1 : hunk.oldStart
    fill(newStart)
    for (const line of hunk.lines) {
      if (line.kind === 'del') {
        emitBase(line)
        continue
      }
      if (line.newLine !== null) fill(line.newLine)
      emitHead(line)
      if (line.kind === 'context' && symbol.head === null) emitBase(line)
      if (line.newLine !== null) cursor = Math.max(cursor, line.newLine + 1)
    }
    delta = oldStart + hunk.oldLines - (newStart + hunk.newLines)
  }
  fill((symbol.head?.end ?? 0) + 1)
  return rows
}

export function excerptRows(rows: SymbolRow[], ranges: LineRange[]): SymbolRow[] {
  const result: SymbolRow[] = []
  let skipped = 0
  for (const row of rows) {
    const line = row.kind === 'line' ? (row.line.newLine ?? row.line.oldLine) : row.kind === 'fold' ? row.line : null
    const keep = line !== null && ranges.some((range) => within(range, line))
    if (!keep) {
      skipped += 1
      continue
    }
    if (skipped > 0 && result.length > 0) result.push({ kind: 'gap', lines: skipped })
    skipped = 0
    result.push(row)
  }
  return result
}
