import { pullKey, type GitHubUser, type PullBucket, type PullSummary } from './types'

export type OpenedWithin = 'any' | '7d' | '30d' | '90d'

export type InboxFilters = {
  authors: string[] | 'all'
  opened: OpenedWithin
  showDrafts: boolean
  groupStacks: boolean
}

export const DEFAULT_FILTERS: InboxFilters = { authors: 'all', opened: 'any', showDrafts: true, groupStacks: true }

const OPENED_DAYS: Record<Exclude<OpenedWithin, 'any'>, number> = { '7d': 7, '30d': 30, '90d': 90 }
const DAY_MS = 86_400_000

export type InboxEntry = {
  pull: PullSummary
  depth: number
  // Set when the PR this one is stacked on is not drawn directly above it.
  stackedOn: number | null
}

// A unit with more than one member is a stack, root first.
export type InboxUnit = { key: string; members: InboxEntry[] }

export type InboxGroup = { key: string; state: 'open' | 'drafts'; units: InboxUnit[] }

export type InboxSection = { groups: InboxGroup[]; shown: number; total: number }

export type InboxView = Record<PullBucket, InboxSection>

// Top to bottom. A PR in more than one bucket shows only in the first.
const SECTION_ORDER: readonly PullBucket[] = ['review', 'mine', 'manual']

export function buildInboxView(pulls: PullSummary[], filters: InboxFilters, now: number): InboxView {
  const unique = firstPerPull(pulls)
  const parents = stackParents(unique)
  return {
    review: buildSection('review', unique, parents, filters, now),
    mine: buildSection('mine', unique, parents, filters, now),
    manual: buildSection('manual', unique, parents, filters, now)
  }
}

function firstPerPull(pulls: PullSummary[]): PullSummary[] {
  const seen = new Set<string>()
  const unique: PullSummary[] = []
  for (const bucket of SECTION_ORDER) {
    for (const pull of pulls) {
      if (pull.bucket !== bucket || seen.has(pullKey(pull.ref))) continue
      seen.add(pullKey(pull.ref))
      unique.push(pull)
    }
  }
  return unique
}

function branchKey(pull: PullSummary, branch: string): string {
  return `${pull.ref.owner}/${pull.ref.repo}:${branch}`
}

function stackParents(pulls: PullSummary[]): Map<string, PullSummary> {
  const byHead = new Map<string, PullSummary>()
  for (const pull of pulls) {
    if (pull.headRef === null) continue
    const key = branchKey(pull, pull.headRef)
    const existing = byHead.get(key)
    if (!existing || pull.ref.number < existing.ref.number) byHead.set(key, pull)
  }
  const parents = new Map<string, PullSummary>()
  for (const pull of pulls) {
    const parent = byHead.get(branchKey(pull, pull.baseRef))
    if (parent && parent !== pull) parents.set(pullKey(pull.ref), parent)
  }
  return parents
}

function passes(pull: PullSummary, filters: InboxFilters, now: number): boolean {
  if (!filters.showDrafts && pull.draft) return false
  if (filters.authors !== 'all' && !filters.authors.includes(pull.author.login)) return false
  if (filters.opened !== 'any' && now - Date.parse(pull.createdAt) > OPENED_DAYS[filters.opened] * DAY_MS) return false
  return true
}

function buildSection(
  bucket: PullBucket,
  pulls: PullSummary[],
  parents: Map<string, PullSummary>,
  filters: InboxFilters,
  now: number
): InboxSection {
  const all: PullSummary[] = []
  const visible: PullSummary[] = []
  for (const pull of pulls) {
    if (pull.bucket !== bucket) continue
    all.push(pull)
    if (passes(pull, filters, now)) visible.push(pull)
  }

  const units = filters.groupStacks ? stackUnits(visible, parents) : flatUnits(visible, parents)
  const open: InboxUnit[] = []
  const drafts: InboxUnit[] = []
  for (const unit of units) {
    const root = unit.members[0]
    if (root?.pull.draft) drafts.push(unit)
    else open.push(unit)
  }

  const groups: InboxGroup[] = []
  if (open.length > 0) groups.push({ key: `${bucket}/open`, state: 'open', units: byLatestUpdate(open) })
  if (drafts.length > 0) groups.push({ key: `${bucket}/drafts`, state: 'drafts', units: byLatestUpdate(drafts) })
  return { groups, shown: visible.length, total: all.length }
}

function flatUnits(visible: PullSummary[], parents: Map<string, PullSummary>): InboxUnit[] {
  const units: InboxUnit[] = []
  for (const pull of visible) {
    const parent = parents.get(pullKey(pull.ref))
    units.push({ key: pullKey(pull.ref), members: [{ pull, depth: 0, stackedOn: parent?.ref.number ?? null }] })
  }
  return units
}

function stackUnits(visible: PullSummary[], parents: Map<string, PullSummary>): InboxUnit[] {
  const shown = new Set<string>()
  for (const pull of visible) shown.add(pullKey(pull.ref))

  const roots: PullSummary[] = []
  const children = new Map<string, PullSummary[]>()
  for (const pull of visible) {
    const anchor = nearestShownAncestor(pull, parents, shown)
    if (!anchor) {
      roots.push(pull)
      continue
    }
    const siblings = children.get(pullKey(anchor.ref)) ?? []
    siblings.push(pull)
    children.set(pullKey(anchor.ref), siblings)
  }
  for (const siblings of children.values()) siblings.sort((a, b) => a.ref.number - b.ref.number)

  const placed = new Set<string>()
  const units: InboxUnit[] = []
  function collect(pull: PullSummary, depth: number, drawnParent: PullSummary | null, members: InboxEntry[]) {
    placed.add(pullKey(pull.ref))
    const parent = parents.get(pullKey(pull.ref))
    members.push({ pull, depth, stackedOn: parent && parent !== drawnParent ? parent.ref.number : null })
    for (const child of children.get(pullKey(pull.ref)) ?? []) {
      if (!placed.has(pullKey(child.ref))) collect(child, depth + 1, pull, members)
    }
  }
  // Every visible PR has an anchor only inside a cycle, so the second pass is the cycle guard.
  for (const root of [...roots, ...visible]) {
    if (placed.has(pullKey(root.ref))) continue
    const members: InboxEntry[] = []
    collect(root, 0, null, members)
    units.push({ key: pullKey(root.ref), members })
  }
  return units
}

function nearestShownAncestor(
  pull: PullSummary,
  parents: Map<string, PullSummary>,
  shown: Set<string>
): PullSummary | null {
  const seen = new Set([pullKey(pull.ref)])
  let current = parents.get(pullKey(pull.ref))
  while (current && !seen.has(pullKey(current.ref))) {
    if (shown.has(pullKey(current.ref))) return current
    seen.add(pullKey(current.ref))
    current = parents.get(pullKey(current.ref))
  }
  return null
}

function latestUpdate(unit: InboxUnit): number {
  let latest = 0
  for (const member of unit.members) latest = Math.max(latest, Date.parse(member.pull.updatedAt))
  return latest
}

function byLatestUpdate(units: InboxUnit[]): InboxUnit[] {
  return units.sort((a, b) => latestUpdate(b) - latestUpdate(a))
}

export function inboxAuthors(pulls: PullSummary[]): GitHubUser[] {
  const byLogin = new Map<string, GitHubUser>()
  for (const pull of pulls) byLogin.set(pull.author.login, pull.author)
  return [...byLogin.values()].sort((a, b) => a.login.localeCompare(b.login))
}

export function toggleAuthor(filters: InboxFilters, login: string, available: string[]): InboxFilters {
  const current = filters.authors === 'all' ? available : filters.authors
  const authors = current.includes(login) ? current.filter((author) => author !== login) : [...current, login]
  return { ...filters, authors }
}

export function changedFilterCount(filters: InboxFilters): number {
  let count = 0
  if (filters.authors !== 'all') count++
  if (filters.opened !== 'any') count++
  if (!filters.showDrafts) count++
  if (!filters.groupStacks) count++
  return count
}

export function parseFilters(raw: unknown): InboxFilters {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_FILTERS
  const value = raw as Record<string, unknown>
  const authors =
    Array.isArray(value.authors) && value.authors.every((author) => typeof author === 'string')
      ? (value.authors as string[])
      : 'all'
  const opened = value.opened === '7d' || value.opened === '30d' || value.opened === '90d' ? value.opened : 'any'
  return {
    authors,
    opened,
    showDrafts: typeof value.showDrafts === 'boolean' ? value.showDrafts : DEFAULT_FILTERS.showDrafts,
    groupStacks: typeof value.groupStacks === 'boolean' ? value.groupStacks : DEFAULT_FILTERS.groupStacks
  }
}
