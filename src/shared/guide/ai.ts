import type { Flow, FlowEdge, FlowNode, FlowNodeChange, Guide, PullDetail } from '../types'
import { numberChapters, planChapters, ROLE_INFO, type ChapterDraft } from './chapters'
import { reviewFiles, type ReviewFile } from './files'
import { chapterIndex } from './flow'
import { declsByPath } from './symbols'

const PATCH_BUDGET = 180_000
const PATCH_CAP = 40_000
const MIN_PATCH = 1_000
const BODY_CAP = 8_000

const SYSTEM_PROMPT = `You write guided code reviews. A guided review walks a reviewer through a pull request in the order that makes it easiest to understand, so their attention goes to what matters.

Return JSON with three parts.

overview: summary is two or three plain sentences on what the pull request does and why. points is 3 to 6 short lines, one per key change, in reading order. The interface numbers them, so do not number them yourself.

flow: a picture of how the new code connects to the existing code, with 3 to 8 nodes. Each node label is a real symbol name taken from the diff, such as OnNewIntent or takeShare(). Set change to "added" for symbols this pull request introduces, "modified" for existing symbols it changes, and "context" for unchanged existing symbols the new code calls into. Set file to the exact path the symbol lives in, or null when it is outside the changed files. Give every node a short unique id and draw edges from caller to callee, or from producer to consumer, so the main path reads from the entry point to the final effect. caption is one plain sentence naming what the flow shows, such as "How shared content reaches a thread".

chapters: 2 to 8 chapters, each grouping the files around one idea. Order them with the core change first, then supporting code, then config and build, docs, tests, schema and migrations, and generated files and lockfiles last. Every changed file belongs to exactly one chapter, referenced by its exact path from the file list. Title each chapter in a few plain words. Each summary is 1 to 3 plain sentences explaining what changed and why it matters to a reviewer. Call out behavior changes and risk, and say when a chapter is safe to skim.

Write plainly, without filler or Markdown headings. Some patches are truncated or left out to fit; reason from the file list and what is shown.`

const stringType = { type: 'string' }

function strictObject(properties: Record<string, unknown>): Record<string, unknown> {
  return { type: 'object', additionalProperties: false, required: Object.keys(properties), properties }
}

export const GUIDE_SCHEMA: Record<string, unknown> = strictObject({
  overview: strictObject({
    summary: stringType,
    points: { type: 'array', items: stringType }
  }),
  flow: strictObject({
    caption: stringType,
    nodes: {
      type: 'array',
      items: strictObject({
        id: stringType,
        label: stringType,
        file: { anyOf: [stringType, { type: 'null' }] },
        change: { type: 'string', enum: ['added', 'modified', 'context'] }
      })
    },
    edges: { type: 'array', items: strictObject({ from: stringType, to: stringType }) }
  }),
  chapters: {
    type: 'array',
    items: strictObject({
      title: stringType,
      summary: stringType,
      files: { type: 'array', items: stringType }
    })
  }
})

function byPriority(a: ReviewFile, b: ReviewFile): number {
  return ROLE_INFO[a.role].rank - ROLE_INFO[b.role].rank || b.churn - a.churn
}

function truncatePatch(patch: string, limit: number): string {
  if (patch.length <= limit) return patch
  const cut = patch.lastIndexOf('\n', limit)
  const kept = patch.slice(0, cut > 0 ? cut : limit)
  const dropped = patch.slice(kept.length).split('\n').length - 1
  return `${kept}\n[patch truncated, ${dropped} more lines not shown]`
}

function describeFile(file: ReviewFile): string {
  const renamed = file.file.previousPath === null ? '' : ` from ${file.file.previousPath}`
  return `- ${file.path} (${file.file.status}${renamed}, +${file.file.additions} -${file.file.deletions}, ${file.role})`
}

export function buildGuidePrompt(detail: PullDetail): { system: string; user: string } {
  const files = reviewFiles(detail.files).sort(byPriority)
  const body = detail.body.trim()

  const patches: string[] = []
  const withoutPatches: string[] = []
  let budget = PATCH_BUDGET
  for (const file of files) {
    if (file.file.patch === null) {
      withoutPatches.push(`- ${file.path} (GitHub sent no patch: binary or too large)`)
      continue
    }
    if (budget < MIN_PATCH) {
      withoutPatches.push(`- ${file.path} (left out to fit)`)
      continue
    }
    const patch = truncatePatch(file.file.patch, Math.min(PATCH_CAP, budget))
    budget -= patch.length
    patches.push(`<patch path="${file.path}">\n${patch}\n</patch>`)
  }

  const sections = [
    `Title: ${detail.summary.title}`,
    `Base: ${detail.base.ref}. Head: ${detail.head.ref}.`,
    `Size: ${files.length} files, +${detail.additions} -${detail.deletions}.`,
    '',
    '<description>',
    body === '' ? '(no description)' : body.slice(0, BODY_CAP),
    '</description>',
    '',
    'Changed files, core code first. Use these exact paths in chapters and nodes.',
    ...files.map(describeFile),
    '',
    ...patches
  ]
  if (withoutPatches.length > 0) sections.push('', 'Files without a patch shown:', ...withoutPatches)
  return { system: SYSTEM_PROMPT, user: sections.join('\n') }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

const CHANGES: FlowNodeChange[] = ['added', 'modified', 'context']

function parseFlow(raw: unknown, resolvePath: (path: string) => string | null, chapterOf: Map<string, string>): Flow {
  if (!isRecord(raw)) return { caption: '', nodes: [], edges: [] }
  const nodes: FlowNode[] = []
  const ids = new Set<string>()
  for (const entry of Array.isArray(raw.nodes) ? raw.nodes : []) {
    if (!isRecord(entry)) continue
    const id = nonEmptyString(entry.id)
    const label = nonEmptyString(entry.label)
    if (id === null || label === null || ids.has(id)) continue
    ids.add(id)
    const file = typeof entry.file === 'string' ? resolvePath(entry.file) : null
    const change = CHANGES.find((candidate) => candidate === entry.change) ?? 'context'
    nodes.push({ id, label, file, change, chapterId: file === null ? null : (chapterOf.get(file) ?? null) })
  }
  const edges: FlowEdge[] = []
  const seen = new Set<string>()
  for (const entry of Array.isArray(raw.edges) ? raw.edges : []) {
    if (!isRecord(entry)) continue
    const from = nonEmptyString(entry.from)
    const to = nonEmptyString(entry.to)
    if (from === null || to === null || from === to || !ids.has(from) || !ids.has(to)) continue
    const key = `${from}\n${to}`
    if (seen.has(key)) continue
    seen.add(key)
    edges.push({ from, to })
  }
  return { caption: nonEmptyString(raw.caption) ?? '', nodes, edges }
}

export function parseAiGuide(raw: unknown, detail: PullDetail): Guide {
  let value = raw
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw)
    } catch {
      throw new Error('AI guide is not valid JSON')
    }
  }
  if (!isRecord(value)) throw new Error('AI guide is not a JSON object')
  const overview = value.overview
  if (!isRecord(overview) || typeof overview.summary !== 'string') {
    throw new Error('AI guide is missing overview.summary')
  }
  if (!Array.isArray(value.chapters)) throw new Error('AI guide is missing the chapters array')

  const files = reviewFiles(detail.files)
  const known = new Map<string, string>()
  for (const file of files) {
    if (file.file.previousPath !== null) known.set(file.file.previousPath, file.path)
  }
  for (const file of files) known.set(file.path, file.path)
  const resolvePath = (path: string): string | null => known.get(path.trim().replace(/^\.\//, '')) ?? null

  const assigned = new Set<string>()
  const drafts: ChapterDraft[] = []
  for (const entry of value.chapters) {
    if (!isRecord(entry) || !Array.isArray(entry.files)) continue
    const title = nonEmptyString(entry.title)
    if (title === null) continue
    const paths: string[] = []
    for (const candidate of entry.files) {
      if (typeof candidate !== 'string') continue
      const path = resolvePath(candidate)
      if (path === null || assigned.has(path)) continue
      assigned.add(path)
      paths.push(path)
    }
    if (paths.length === 0) continue
    drafts.push({ title, summary: nonEmptyString(entry.summary) ?? '', files: paths })
  }
  if (files.length > 0 && drafts.length === 0) {
    throw new Error('AI guide put none of the changed files in a chapter')
  }

  const leftovers: ReviewFile[] = []
  for (const file of files) {
    if (!assigned.has(file.path)) leftovers.push(file)
  }
  if (leftovers.length > 0) drafts.push(...planChapters(leftovers, declsByPath(leftovers)))

  const chapters = numberChapters(drafts)
  const points: string[] = []
  for (const point of Array.isArray(overview.points) ? overview.points : []) {
    const text = nonEmptyString(point)
    if (text !== null) points.push(text)
  }
  return {
    source: 'ai',
    headSha: detail.head.sha,
    overview: { summary: overview.summary.trim(), points },
    flow: parseFlow(value.flow, resolvePath, chapterIndex(chapters)),
    chapters
  }
}
