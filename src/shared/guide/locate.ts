import { lineAnchor, parsePatch } from '../diff'
import type { ChangedFile, DiffLine, DiffLocation, FlowNode } from '../types'
import { baseName } from './files'
import { declares } from './symbols'

type Candidate = { path: string; section: string | null; line: DiffLine; firstChange: boolean }

type Tier = (candidate: Candidate, name: string, word: RegExp) => boolean

const TIERS: Tier[] = [
  (c, name) => c.line.kind === 'add' && declares(c.path, c.line.text, name),
  (c, name) => c.line.kind === 'context' && declares(c.path, c.line.text, name),
  (c, _name, word) => c.firstChange && c.section !== null && word.test(c.section),
  (c, _name, word) => c.line.kind === 'add' && word.test(c.line.text),
  (c, _name, word) => word.test(c.line.text)
]

function symbolName(label: string): string {
  const bare = label.trim().replace(/^[+~]\s*/, '').replace(/\(.*\)$/, '')
  const segments = bare.split(/\.|::|#/)
  return (segments[segments.length - 1] ?? '').trim()
}

function candidates(files: ChangedFile[]): Candidate[] {
  const result: Candidate[] = []
  for (const file of files) {
    if (file.patch === null) continue
    for (const hunk of parsePatch(file.patch)) {
      let seenChange = false
      for (const line of hunk.lines) {
        const firstChange = line.kind !== 'context' && !seenChange
        if (line.kind !== 'context') seenChange = true
        result.push({ path: file.path, section: hunk.section, line, firstChange })
      }
    }
  }
  return result
}

function locationOf(candidate: Candidate): DiffLocation | null {
  const anchor = lineAnchor(candidate.line)
  return anchor === null ? null : { path: candidate.path, ...anchor }
}

export function locateFlowNode(node: FlowNode, files: ChangedFile[]): DiffLocation | null {
  const scope: ChangedFile[] = []
  for (const file of files) {
    if (node.file === null || file.path === node.file) scope.push(file)
  }
  const lines = candidates(scope)

  if (node.file !== null && node.label === baseName(node.file)) {
    for (const candidate of lines) {
      if (candidate.line.kind !== 'context') return locationOf(candidate)
    }
    return null
  }

  const name = symbolName(node.label)
  if (name === '') return null
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const word = new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`)
  for (const tier of TIERS) {
    for (const candidate of lines) {
      if (tier(candidate, name, word)) return locationOf(candidate)
    }
  }
  return null
}
