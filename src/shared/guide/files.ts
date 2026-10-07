import { parsePatch } from '../diff'
import type { ChangedFile, DiffHunk, FileRole } from '../types'
import { classifyFile } from './roles'

export type ReviewFile = {
  path: string
  file: ChangedFile
  role: FileRole
  hunks: DiffHunk[]
  churn: number
}

export function reviewFiles(files: ChangedFile[]): ReviewFile[] {
  const result: ReviewFile[] = []
  for (const file of files) {
    result.push({
      path: file.path,
      file,
      role: classifyFile(file.path),
      hunks: file.patch === null ? [] : parsePatch(file.patch),
      churn: file.additions + file.deletions
    })
  }
  return result
}

export function dirSegments(path: string): string[] {
  const segments = path.split('/')
  segments.pop()
  return segments
}

export function baseName(path: string): string {
  const segments = path.split('/')
  return segments[segments.length - 1] ?? path
}

export function commonPrefix(paths: string[][]): string[] {
  const first = paths[0]
  if (first === undefined) return []
  const prefix: string[] = []
  for (let i = 0; i < first.length; i++) {
    const segment = first[i]
    for (const other of paths) {
      if (other[i] !== segment) return prefix
    }
    if (segment !== undefined) prefix.push(segment)
  }
  return prefix
}

export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

export function joinWords(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}
