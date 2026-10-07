import type {
  ChangedFile,
  Chapter,
  DriftReason,
  FileFingerprint,
  FileRole,
  Guide,
  GuideCoverage,
  GuideDrift,
  PullDetail
} from '../types'
import { planChapters } from './chapters'
import { reviewFiles } from './files'
import { classifyFile } from './roles'
import { declsByPath } from './symbols'

const SIGNIFICANT = {
  roles: new Set<FileRole>(['core', 'ui', 'schema']),
  lineShare: 0.25
}

function fnv1a(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function fingerprint(file: ChangedFile): FileFingerprint {
  return { hash: fnv1a(file.patch ?? ''), additions: file.additions, deletions: file.deletions }
}

export function guideCoverage(detail: PullDetail): GuideCoverage {
  const entries: [string, FileFingerprint][] = []
  for (const file of detail.files) entries.push([file.path, fingerprint(file)])
  return Object.fromEntries(entries)
}

function coveredAs(coverage: GuideCoverage, path: string): FileFingerprint | undefined {
  return Object.hasOwn(coverage, path) ? coverage[path] : undefined
}

function sameFingerprint(a: FileFingerprint, b: FileFingerprint): boolean {
  return a.hash === b.hash && a.additions === b.additions && a.deletions === b.deletions
}

type Counts = { additions: number; deletions: number }

const NO_LINES: Counts = { additions: 0, deletions: 0 }

// Lines the PR stopped adding read as deletions and lines it stopped deleting as additions, as in an interdiff.
function linesBetween(before: Counts, now: Counts): Counts {
  const added = now.additions - before.additions
  const deleted = now.deletions - before.deletions
  return {
    additions: Math.max(added, 0) + Math.max(-deleted, 0),
    deletions: Math.max(-added, 0) + Math.max(deleted, 0)
  }
}

function tally(total: Counts, lines: Counts): void {
  total.additions += lines.additions
  total.deletions += lines.deletions
}

function nonTrivial(path: string): boolean {
  return SIGNIFICANT.roles.has(classifyFile(path))
}

export function guideDrift(guide: Guide, detail: PullDetail): GuideDrift {
  if (guide.source === 'heuristic') return { kind: 'fresh' }
  const changed: string[] = []
  const added: string[] = []
  const removed: string[] = []
  const moved: Counts = { additions: 0, deletions: 0 }
  const inDiff = new Set<string>()

  for (const file of detail.files) {
    inDiff.add(file.path)
    const before = coveredAs(guide.coverage, file.path)
    const now = fingerprint(file)
    if (before !== undefined && sameFingerprint(before, now)) continue
    if (before === undefined) added.push(file.path)
    else changed.push(file.path)
    tally(moved, linesBetween(before ?? NO_LINES, now))
  }

  let covered = 0
  for (const [path, before] of Object.entries(guide.coverage)) {
    covered += before.additions + before.deletions
    if (inDiff.has(path)) continue
    removed.push(path)
    tally(moved, linesBetween(before, NO_LINES))
  }

  if (changed.length + added.length + removed.length === 0) return { kind: 'fresh' }

  const reasons: DriftReason[] = []
  for (const path of added) {
    if (nonTrivial(path)) reasons.push({ kind: 'uncovered-file', path })
  }
  for (const path of removed) {
    if (nonTrivial(path)) reasons.push({ kind: 'removed-file', path })
  }
  const { additions, deletions } = moved
  const lines = additions + deletions
  if (lines > 0 && lines >= covered * SIGNIFICANT.lineShare) reasons.push({ kind: 'line-share', lines, covered })

  const sinceSha = guide.headSha
  if (reasons.length === 0) return { kind: 'minor', changed, added, sinceSha }
  return { kind: 'significant', changed, added, removed, reasons, additions, deletions, sinceSha }
}

export function withNewSinceGuide(guide: Guide, detail: PullDetail, paths: string[]): Guide {
  if (paths.length === 0) return guide
  const wanted = new Set(paths)
  const files = reviewFiles(detail.files.filter((file) => wanted.has(file.path)))
  const drafts = planChapters(files, declsByPath(files))
  const ordered: string[] = []
  const summaries: string[] = []
  for (const draft of drafts) {
    ordered.push(...draft.files)
    summaries.push(draft.summary)
  }
  const intro = 'Pushed after the guide was written, so no other chapter covers these changes. Refresh the guide to fold them in.'
  const chapter: Chapter = {
    id: `ch-${guide.chapters.length + 1}`,
    title: 'New since guide',
    summary: [intro, ...summaries].join('\n\n'),
    files: ordered
  }
  return { ...guide, chapters: [...guide.chapters, chapter] }
}
