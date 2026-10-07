import type { DiffHunk, DiffLine, DiffSide } from './types'

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/

export function parsePatch(patch: string): DiffHunk[] {
  const hunks: DiffHunk[] = []
  let hunk: DiffHunk | null = null
  let oldLine = 0
  let newLine = 0
  let oldLeft = 0
  let newLeft = 0

  for (const raw of patch.split('\n')) {
    const header = HUNK_HEADER.exec(raw)
    if (header) {
      const oldStart = Number(header[1])
      const newStart = Number(header[3])
      // An omitted count means the hunk covers exactly one line.
      const oldLines = header[2] === undefined ? 1 : Number(header[2])
      const newLines = header[4] === undefined ? 1 : Number(header[4])
      const section = (header[5] ?? '').trim()
      hunk = {
        header: raw,
        section: section === '' ? null : section,
        oldStart,
        oldLines,
        newStart,
        newLines,
        lines: []
      }
      hunks.push(hunk)
      oldLine = oldStart
      newLine = newStart
      oldLeft = oldLines
      newLeft = newLines
      continue
    }

    if (hunk === null || (oldLeft <= 0 && newLeft <= 0)) continue
    if (raw.startsWith('\\')) continue

    const marker = raw.charAt(0)
    const text = raw.slice(1)
    let line: DiffLine
    if (marker === '+') {
      line = { kind: 'add', oldLine: null, newLine, text }
      newLine += 1
      newLeft -= 1
    } else if (marker === '-') {
      line = { kind: 'del', oldLine, newLine: null, text }
      oldLine += 1
      oldLeft -= 1
    } else {
      line = { kind: 'context', oldLine, newLine, text }
      oldLine += 1
      newLine += 1
      oldLeft -= 1
      newLeft -= 1
    }
    hunk.lines.push(line)
  }

  return hunks
}

export function lineAnchor(line: DiffLine): { side: DiffSide; line: number } | null {
  if (line.kind === 'del') return line.oldLine === null ? null : { side: 'LEFT', line: line.oldLine }
  return line.newLine === null ? null : { side: 'RIGHT', line: line.newLine }
}
