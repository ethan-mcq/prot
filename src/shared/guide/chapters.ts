import type { Chapter, FileRole, FileStatus } from '../types'
import { baseName, commonPrefix, dirSegments, joinWords, plural, type ReviewFile } from './files'
import { symbolLabel, type Decl } from './symbols'

type Section = 'code' | 'setup' | 'docs' | 'test' | 'schema' | 'noise'

const SECTION_ORDER: Section[] = ['code', 'setup', 'docs', 'test', 'schema', 'noise']

type RoleInfo = { section: Section; rank: number; noun: string; hint: string | null }

export const ROLE_INFO: Record<FileRole, RoleInfo> = {
  core: { section: 'code', rank: 0, noun: 'code', hint: null },
  ui: { section: 'code', rank: 1, noun: 'UI', hint: null },
  config: { section: 'setup', rank: 2, noun: 'config', hint: null },
  build: { section: 'setup', rank: 3, noun: 'build scripts', hint: null },
  docs: { section: 'docs', rank: 4, noun: 'docs', hint: null },
  assets: { section: 'docs', rank: 5, noun: 'assets', hint: null },
  test: { section: 'test', rank: 6, noun: 'tests', hint: null },
  schema: {
    section: 'schema',
    rank: 7,
    noun: 'schema and migrations',
    hint: 'These change stored data, so check they are safe to run and to roll back.'
  },
  deps: { section: 'noise', rank: 8, noun: 'lockfiles', hint: 'Safe to skim unless a dependency version matters.' },
  generated: {
    section: 'noise',
    rank: 9,
    noun: 'generated code',
    hint: 'Generated output, so review the source that produces it instead.'
  }
}

const STATUS_WORD: Record<FileStatus, string> = {
  added: 'new',
  modified: 'modified',
  removed: 'deleted',
  renamed: 'renamed'
}

// Directories that only hold other areas, so the area is one level deeper:
// packages/mobile, modules/capy-share, src/share.
const CONTAINER_DIRS = new Set([
  'packages',
  'apps',
  'modules',
  'libs',
  'lib',
  'src',
  'source',
  'sources',
  'services',
  'crates',
  'internal',
  'pkg',
  'cmd',
  'components',
  'features',
  'app'
])

const MAX_FILES = 8
const MAX_CHAPTERS = 8

export type ChapterDraft = { title: string; summary: string; files: string[] }

type Group = { section: Section; area: string[]; files: ReviewFile[] }

function churnOf(files: ReviewFile[]): number {
  let total = 0
  for (const file of files) total += file.churn
  return total
}

function byChurn(a: ReviewFile, b: ReviewFile): number {
  return b.churn - a.churn
}

function areaKey(dir: string[], start: number): string[] {
  let end = start
  while (end < dir.length) {
    const segment = dir[end]
    end += 1
    if (segment === undefined || !CONTAINER_DIRS.has(segment)) break
  }
  return dir.slice(0, end)
}

function bucketByArea(files: ReviewFile[]): { area: string[]; files: ReviewFile[] }[] {
  const prefix = commonPrefix(files.map((file) => dirSegments(file.path)))
  const buckets = new Map<string, { area: string[]; files: ReviewFile[] }>()
  for (const file of files) {
    const area = areaKey(dirSegments(file.path), prefix.length)
    const key = area.join('/')
    const bucket = buckets.get(key)
    if (bucket === undefined) buckets.set(key, { area, files: [file] })
    else bucket.files.push(file)
  }
  return [...buckets.values()]
}

// Every split partitions its input, so no file is dropped or duplicated.
function splitHuge(area: string[], files: ReviewFile[]): { area: string[]; files: ReviewFile[] }[] {
  if (files.length <= MAX_FILES) return [{ area, files }]
  const buckets = bucketByArea(files)
  if (buckets.length > 1) {
    const result: { area: string[]; files: ReviewFile[] }[] = []
    for (const bucket of buckets) result.push(...splitHuge(bucket.area, bucket.files))
    return result
  }
  const sorted = [...files].sort(byChurn)
  const result: { area: string[]; files: ReviewFile[] }[] = []
  for (let i = 0; i < sorted.length; i += MAX_FILES) {
    result.push({ area, files: sorted.slice(i, i + MAX_FILES) })
  }
  return result
}

function sharedDepth(a: Group, b: Group): number {
  return commonPrefix([a.area, b.area]).length
}

// Merges inside one section at a time, least important section first, so
// tests collapse into one chapter before two areas of core code do.
function mergeToCap(groups: Group[]): void {
  while (groups.length > MAX_CHAPTERS) {
    let section: Section | null = null
    for (const candidate of [...SECTION_ORDER].reverse()) {
      let count = 0
      for (const group of groups) {
        if (group.section === candidate) count += 1
      }
      if (count > 1) {
        section = candidate
        break
      }
    }
    if (section === null) return

    let smallest: Group | null = null
    for (const group of groups) {
      if (group.section !== section) continue
      if (smallest === null || churnOf(group.files) <= churnOf(smallest.files)) smallest = group
    }
    if (smallest === null) return

    let target: Group | null = null
    for (const group of groups) {
      if (group === smallest || group.section !== section) continue
      if (target === null || sharedDepth(group, smallest) > sharedDepth(target, smallest)) target = group
    }
    if (target === null) return

    target.files.push(...smallest.files)
    groups.splice(groups.indexOf(smallest), 1)
  }
}

function dominantRole(files: ReviewFile[]): FileRole {
  const churnByRole = new Map<FileRole, number>()
  for (const file of files) churnByRole.set(file.role, (churnByRole.get(file.role) ?? 0) + file.churn + 1)
  let best: FileRole = 'core'
  let bestChurn = -1
  for (const [role, churn] of churnByRole) {
    if (churn > bestChurn || (churn === bestChurn && ROLE_INFO[role].rank < ROLE_INFO[best].rank)) {
      best = role
      bestChurn = churn
    }
  }
  return best
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function humanize(name: string): string {
  const words = name.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+/g)
  if (words === null) return name
  const lowered: string[] = []
  for (const word of words) {
    lowered.push(word.length > 1 && word === word.toUpperCase() ? word : word.toLowerCase())
  }
  return capitalize(lowered.join(' '))
}

function stem(path: string): string {
  const base = baseName(path)
  const dot = base.indexOf('.', 1)
  return dot === -1 ? base : base.slice(0, dot)
}

function describeArea(area: string[], sectionPrefix: string[]): string {
  let relative = area.slice(sectionPrefix.length)
  if (relative.length === 0) relative = area.slice(-1)
  if (relative.length === 0) return 'the repo root'
  return relative.slice(-2).join('/')
}

function codeSubject(files: ReviewFile[], decls: Map<string, Decl[]>): string {
  for (const file of files) {
    for (const decl of decls.get(file.path) ?? []) {
      if (decl.change !== 'context' && /^[A-Z]/.test(decl.name)) return humanize(decl.name)
    }
  }
  const top = files[0]
  return top === undefined ? 'Code' : humanize(stem(top.path))
}

function titleFor(group: Group, splitSection: boolean, sectionPrefix: string[], decls: Map<string, Decl[]>): string {
  const where = describeArea(group.area, sectionPrefix)
  if (group.section === 'code') {
    const ui = dominantRole(group.files) === 'ui' ? ' UI' : ''
    return `${codeSubject(group.files, decls)}${ui} in ${where}`
  }
  const roles: FileRole[] = []
  for (const file of group.files) {
    if (!roles.includes(file.role)) roles.push(file.role)
  }
  roles.sort((a, b) => ROLE_INFO[a].rank - ROLE_INFO[b].rank)
  const nouns: string[] = []
  for (const role of roles) nouns.push(ROLE_INFO[role].noun)
  const title = capitalize(joinWords(nouns))
  return splitSection ? `${title} in ${where}` : title
}

function listSymbols(labels: string[]): string {
  if (labels.length <= 3) return joinWords(labels)
  return `${labels.slice(0, 3).join(', ')} and ${labels.length - 3} more`
}

function summaryFor(group: Group, decls: Map<string, Decl[]>): string {
  const statusCounts = new Map<FileStatus, number>()
  let additions = 0
  let deletions = 0
  for (const file of group.files) {
    statusCounts.set(file.file.status, (statusCounts.get(file.file.status) ?? 0) + 1)
    additions += file.file.additions
    deletions += file.file.deletions
  }
  const parts: string[] = []
  for (const [status, count] of statusCounts) parts.push(plural(count, `${STATUS_WORD[status]} file`))
  const sentences = [`${capitalize(joinWords(parts))}, +${additions} -${deletions} lines.`]

  const added: string[] = []
  const modified: string[] = []
  for (const file of group.files) {
    for (const decl of decls.get(file.path) ?? []) {
      const label = symbolLabel(decl)
      if (decl.change === 'added' && !added.includes(label)) added.push(label)
      if (decl.change === 'modified' && !modified.includes(label)) modified.push(label)
    }
  }
  if (added.length > 0) sentences.push(`Adds ${listSymbols(added)}.`)
  if (modified.length > 0) sentences.push(`Changes ${listSymbols(modified)}.`)

  const hints: string[] = []
  for (const file of group.files) {
    const hint = ROLE_INFO[file.role].hint
    if (hint !== null && !hints.includes(hint)) hints.push(hint)
  }
  sentences.push(...hints)
  return sentences.join(' ')
}

function groupOrder(a: Group, b: Group): number {
  const section = SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section)
  if (section !== 0) return section
  if (a.section === 'code') {
    const rank = ROLE_INFO[dominantRole(a.files)].rank - ROLE_INFO[dominantRole(b.files)].rank
    if (rank !== 0) return rank
  }
  return churnOf(b.files) - churnOf(a.files)
}

export function planChapters(files: ReviewFile[], decls: Map<string, Decl[]>): ChapterDraft[] {
  const groups: Group[] = []
  const prefixes = new Map<Section, string[]>()
  for (const section of SECTION_ORDER) {
    const members: ReviewFile[] = []
    for (const file of files) {
      if (ROLE_INFO[file.role].section === section) members.push(file)
    }
    if (members.length === 0) continue
    const prefix = commonPrefix(members.map((file) => dirSegments(file.path)))
    prefixes.set(section, prefix)
    const buckets = section === 'code' ? bucketByArea(members) : [{ area: prefix, files: members }]
    for (const bucket of buckets) {
      for (const piece of splitHuge(bucket.area, bucket.files)) {
        groups.push({ section, area: piece.area, files: piece.files })
      }
    }
  }

  mergeToCap(groups)
  groups.sort(groupOrder)

  const drafts: ChapterDraft[] = []
  for (const group of groups) {
    group.files.sort(byChurn)
    let siblings = 0
    for (const other of groups) {
      if (other.section === group.section) siblings += 1
    }
    const paths: string[] = []
    for (const file of group.files) paths.push(file.path)
    drafts.push({
      title: titleFor(group, siblings > 1, prefixes.get(group.section) ?? [], decls),
      summary: summaryFor(group, decls),
      files: paths
    })
  }
  return drafts
}

export function numberChapters(drafts: ChapterDraft[]): Chapter[] {
  const chapters: Chapter[] = []
  for (const draft of drafts) {
    chapters.push({ id: `ch-${chapters.length + 1}`, title: draft.title, summary: draft.summary, files: draft.files })
  }
  return chapters
}
