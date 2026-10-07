import { parsePatch } from '../diff'
import { symbolRows } from '../symbol-rows'
import {
  RISK_LEVELS,
  type CardRole,
  type Chapter,
  type CodeSymbol,
  type Guide,
  type GuideOverview,
  type PullDetail,
  type StoryCard
} from '../types'
import { numberChapters, planChapters, ROLE_INFO, type ChapterDraft } from './chapters'
import { QUESTION_LIMIT } from './questions'
import { guideCoverage } from './drift'
import { reviewFiles, type ReviewFile } from './files'
import { storyFlow } from './story'
import { declsByPath } from './symbols'

const CODE_BUDGET = 180_000
const SYMBOL_CAP = 12_000
const PATCH_CAP = 20_000
const MIN_ENTRY = 600

const SYSTEM_PROMPT = `You write guided code reviews. A guided review walks a reviewer through a pull request as a story of code: it starts where execution enters the changed code and follows it down through the helpers, data types and tests.

You only see code: the indexed symbols, their code with diff markers (+ added, - removed), and file paths with line counts. Judge everything from the code.

Return JSON with five parts.

overview.risk: level is "low", "medium" or "high". Decide it from the code: the blast radius (how many callers and sections the change touches), data, schema or migration changes, auth or security paths, concurrency and shared state, deleted or changed public functions, and whether each section has tests for its changed symbols. reason is one sentence naming the concrete thing that drives the risk, such as what could break or which callers or data are affected.

overview.synopsis: 3 to 4 plain sentences on what the change does and what it is for, inferred from the code. overview.points: one short line per section, in reading order. The interface numbers them.

caption: one plain sentence naming what the story map shows, such as "How a shared item reaches a thread".

sections: the story, in reading order. Each section is one idea: an entry point and the code that serves it. List its cards in symbols, using only the exact symbol ids given, in reading order: entry first, then steps and helpers in call order, data types after the functions, tests last. You may merge, split or reorder the proposed sections. Every changed symbol belongs to exactly one section. Unchanged symbols may appear only as entry points. Title each section in a few plain words and write a summary of 1 to 2 plain sentences on what the code does and what a reviewer should check.

files: titles and summaries for the files outside the story (config, build, docs, schema, lockfiles), grouped by exact path.

questions: 3 to 5 questions a careful reviewer of this specific code would ask, most important first. Each names the concrete symbols, files, routes or services involved and is under 160 characters. Never ask anything generic. Look first for security risks and auth or permission checks, then downstream effects on callers and dependent services, the upstream callers and entry points that reach the change, data, schema or migration repercussions, concurrency and failure modes, and missing tests.

Write plainly, without filler, hedging or Markdown headings. Some code is truncated or left out to fit.`

const stringType = { type: 'string' }

function strictObject(properties: Record<string, unknown>): Record<string, unknown> {
  return { type: 'object', additionalProperties: false, required: Object.keys(properties), properties }
}

const section = strictObject({ title: stringType, summary: stringType })

export const GUIDE_SCHEMA: Record<string, unknown> = strictObject({
  overview: strictObject({
    risk: strictObject({ level: { type: 'string', enum: [...RISK_LEVELS] }, reason: stringType }),
    synopsis: stringType,
    points: { type: 'array', items: stringType }
  }),
  caption: stringType,
  sections: {
    type: 'array',
    items: strictObject({ ...(section.properties as object), symbols: { type: 'array', items: stringType } })
  },
  files: {
    type: 'array',
    items: strictObject({ ...(section.properties as object), files: { type: 'array', items: stringType } })
  },
  questions: { type: 'array', items: stringType }
})

function byPriority(a: ReviewFile, b: ReviewFile): number {
  return ROLE_INFO[a.role].rank - ROLE_INFO[b.role].rank || b.churn - a.churn
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text
  const cut = text.lastIndexOf('\n', limit)
  const kept = text.slice(0, cut > 0 ? cut : limit)
  const dropped = text.slice(kept.length).split('\n').length - 1
  return `${kept}\n[truncated, ${dropped} more lines not shown]`
}

function describeFile(file: ReviewFile): string {
  const renamed = file.file.previousPath === null ? '' : ` from ${file.file.previousPath}`
  return `- ${file.path} (${file.file.status}${renamed}, +${file.file.additions} -${file.file.deletions}, ${file.role})`
}

function range(symbol: CodeSymbol): string {
  const lines = symbol.head ?? symbol.base
  return lines === null ? '' : `${lines.start}-${lines.end}`
}

export function symbolCode(symbol: CodeSymbol, guide: Guide, detail: PullDetail, heads: Record<string, string>): string {
  const children = Object.values(guide.symbols).filter((child) => child.parentId === symbol.id)
  const patch = detail.files.find((file) => file.path === symbol.path)?.patch ?? ''
  const head = heads[symbol.path]?.split('\n') ?? null
  const lines: string[] = []
  for (const row of symbolRows(symbol, children, parsePatch(patch), head)) {
    if (row.kind === 'line') lines.push(`${row.line.kind === 'add' ? '+' : row.line.kind === 'del' ? '-' : ' '}${row.line.text}`)
    if (row.kind === 'fold') lines.push(` … ${guide.symbols[row.symbolId]?.qualifiedName ?? row.symbolId}`)
    if (row.kind === 'gap') lines.push(` … ${row.lines} lines`)
  }
  return lines.join('\n')
}

function cardLine(card: StoryCard, guide: Guide): string {
  const symbol = guide.symbols[card.symbolId]
  if (symbol === undefined) return ''
  const see = card.seeChapterId === null ? '' : `, shown in ${card.seeChapterId}`
  return `- ${symbol.id} (${symbol.kind}, ${symbol.change}, ${card.role}, lines ${range(symbol)}${see})`
}

export function buildGuidePrompt(
  detail: PullDetail,
  story: Guide,
  heads: Record<string, string>
): { system: string; user: string } {
  const files = reviewFiles(detail.files).sort(byPriority)
  const storyChapters = story.chapters.filter((chapter) => chapter.cards.length > 0)
  const storyPaths = new Set(storyChapters.flatMap((chapter) => chapter.files))
  const leftovers = files.filter((file) => !storyPaths.has(file.path))

  const outline: string[] = []
  const code: string[] = []
  let budget = CODE_BUDGET
  for (const chapter of storyChapters) {
    outline.push(`<section id="${chapter.id}" proposed="${chapter.title}">`, ...chapter.cards.map((card) => cardLine(card, story)), '</section>')
    for (const card of chapter.cards) {
      const symbol = story.symbols[card.symbolId]
      if (symbol === undefined || card.seeChapterId !== null) continue
      if (symbol.change === 'context' && card.role !== 'entry') continue
      if (budget < MIN_ENTRY) {
        code.push(`<symbol id="${symbol.id}">[left out to fit]</symbol>`)
        continue
      }
      const body = truncate(symbolCode(symbol, story, detail, heads), Math.min(SYMBOL_CAP, budget))
      budget -= body.length
      code.push(`<symbol id="${symbol.id}" path="${symbol.path}" lines="${range(symbol)}" change="${symbol.change}">\n${body}\n</symbol>`)
    }
  }

  const patches: string[] = []
  for (const file of leftovers) {
    if (file.file.patch === null || budget < MIN_ENTRY) continue
    const patch = truncate(file.file.patch, Math.min(PATCH_CAP, budget))
    budget -= patch.length
    patches.push(`<patch path="${file.path}">\n${patch}\n</patch>`)
  }

  const sections = [
    `Size: ${files.length} files, +${detail.additions} -${detail.deletions}.`,
    '',
    'Changed files, core code first:',
    ...files.map(describeFile),
    '',
    'Proposed story sections, with every card as: symbol id (kind, change, role, lines).',
    ...outline,
    '',
    'Code of each changed symbol and entry point:',
    ...code,
    '',
    'Files outside the story. Use these exact paths in files.',
    ...leftovers.map(describeFile),
    ...patches
  ]
  return { system: SYSTEM_PROMPT, user: sections.join('\n') }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function parseOverview(raw: Record<string, unknown>, fallback: GuideOverview): GuideOverview {
  const synopsis = text(raw.synopsis)
  if (synopsis === null) throw new Error('AI guide is missing overview.synopsis')
  const risk = isRecord(raw.risk) ? raw.risk : {}
  const level = RISK_LEVELS.find((candidate) => candidate === risk.level)
  const reason = text(risk.reason)
  const points: string[] = []
  for (const point of list(raw.points)) {
    const line = text(point)
    if (line !== null) points.push(line)
  }
  return {
    risk: level !== undefined && reason !== null ? { level, reason } : fallback.risk,
    synopsis,
    points
  }
}

const MIN_QUESTIONS = 3
const QUESTION_CHARS = 160

function parseQuestions(raw: unknown, fallback: string[]): string[] {
  const questions: string[] = []
  for (const candidate of list(raw)) {
    const question = text(candidate)
    if (question === null || question.length > QUESTION_CHARS || questions.includes(question)) continue
    questions.push(question)
  }
  return questions.length < MIN_QUESTIONS ? fallback : questions.slice(0, QUESTION_LIMIT)
}

type Placement = { chapter: Chapter; card: StoryCard }

function placements(story: Guide): Map<string, Placement> {
  const placed = new Map<string, Placement>()
  for (const chapter of story.chapters) {
    for (const card of chapter.cards) {
      if (card.seeChapterId === null && !placed.has(card.symbolId)) placed.set(card.symbolId, { chapter, card })
    }
  }
  return placed
}

function defaultRole(symbol: CodeSymbol): CardRole {
  if (symbol.kind === 'test') return 'test'
  return symbol.kind === 'module' ? 'data' : 'step'
}

function insertCard(cards: StoryCard[], card: StoryCard): void {
  if (card.role === 'test') {
    cards.push(card)
    return
  }
  const firstTest = cards.findIndex((existing) => existing.role === 'test')
  cards.splice(firstTest === -1 ? cards.length : firstTest, 0, card)
}

type Draft = { title: string; summary: string; cards: StoryCard[] }

// Keeps every changed symbol exactly once: the first AI section to name it wins, and anything missed goes where the story put it.
function storySections(raw: unknown[], story: Guide): Draft[] {
  const placed = placements(story)
  const assigned = new Set<string>()
  const drafts: Draft[] = []
  for (const entry of raw) {
    if (!isRecord(entry)) continue
    const title = text(entry.title)
    if (title === null) continue
    const cards: StoryCard[] = []
    for (const candidate of list(entry.symbols)) {
      if (typeof candidate !== 'string') continue
      const symbol = story.symbols[candidate.trim()]
      if (symbol === undefined || cards.some((card) => card.symbolId === symbol.id)) continue
      const home = placed.get(symbol.id)
      if (symbol.change !== 'context') {
        if (assigned.has(symbol.id)) continue
        assigned.add(symbol.id)
      } else if (home?.card.role !== 'entry') continue
      cards.push({ ...(home?.card ?? { symbolId: symbol.id, role: defaultRole(symbol), excerpt: null }), seeChapterId: null })
    }
    if (cards.some((card) => story.symbols[card.symbolId]?.change !== 'context')) {
      drafts.push({ title, summary: text(entry.summary) ?? '', cards })
    }
  }

  if (assigned.size === 0 && placed.size > 0) throw new Error('AI guide placed none of the changed symbols')
  for (const [symbolId, home] of placed) {
    const symbol = story.symbols[symbolId]
    if (symbol === undefined || symbol.change === 'context' || assigned.has(symbolId)) continue
    assigned.add(symbolId)
    const siblings = home.chapter.cards.filter((card) => card.seeChapterId === null).map((card) => card.symbolId)
    let target = drafts.find((draft) =>
      draft.cards.some((card) => siblings.includes(card.symbolId) && story.symbols[card.symbolId]?.change !== 'context')
    )
    if (target === undefined) {
      target = { title: home.chapter.title, summary: home.chapter.summary, cards: [] }
      drafts.push(target)
    }
    insertCard(target.cards, { ...home.card, seeChapterId: null })
  }

  for (const draft of drafts) {
    for (const card of [...draft.cards]) {
      const home = placed.get(card.symbolId)
      if (home === undefined || card.role === 'entry') continue
      const entries = home.chapter.cards.filter((other) => other.role === 'entry' && story.symbols[other.symbolId]?.change === 'context')
      for (const entry of entries.reverse()) {
        if (!draft.cards.some((existing) => existing.symbolId === entry.symbolId)) draft.cards.unshift({ ...entry })
      }
    }
  }
  return drafts
}

function fileChapters(raw: unknown[], leftovers: ReviewFile[]): ChapterDraft[] {
  const known = new Map<string, string>()
  for (const file of leftovers) {
    known.set(file.path, file.path)
    if (file.file.previousPath !== null) known.set(file.file.previousPath, file.path)
  }
  const assigned = new Set<string>()
  const drafts: ChapterDraft[] = []
  for (const entry of raw) {
    if (!isRecord(entry)) continue
    const title = text(entry.title)
    if (title === null) continue
    const paths: string[] = []
    for (const candidate of list(entry.files)) {
      if (typeof candidate !== 'string') continue
      const path = known.get(candidate.trim().replace(/^\.\//, ''))
      if (path === undefined || assigned.has(path)) continue
      assigned.add(path)
      paths.push(path)
    }
    if (paths.length > 0) drafts.push({ title, summary: text(entry.summary) ?? '', files: paths })
  }
  const rest = leftovers.filter((file) => !assigned.has(file.path))
  if (rest.length > 0) drafts.push(...planChapters(rest, declsByPath(rest)))
  return drafts
}

function fileFlow(story: Guide, chapters: Chapter[]): Guide['flow'] {
  const nodes = story.flow.nodes.map((node) => ({
    ...node,
    chapterId: chapters.find((chapter) => node.file !== null && chapter.files.includes(node.file))?.id ?? null
  }))
  return { ...story.flow, nodes }
}

export function parseAiGuide(raw: unknown, detail: PullDetail, story: Guide): Guide {
  let value = raw
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw)
    } catch {
      throw new Error('AI guide is not valid JSON')
    }
  }
  if (!isRecord(value)) throw new Error('AI guide is not a JSON object')
  if (!isRecord(value.overview)) throw new Error('AI guide is missing the overview')
  if (!Array.isArray(value.sections)) throw new Error('AI guide is missing the sections array')
  const overview = parseOverview(value.overview, story.overview)

  const drafts = storySections(value.sections, story)

  const chapters: Chapter[] = drafts.map((draft, index) => {
    const files: string[] = []
    for (const card of draft.cards) {
      const path = story.symbols[card.symbolId]?.path
      if (path !== undefined && !files.includes(path)) files.push(path)
    }
    return { id: `ch-${index + 1}`, title: draft.title, summary: draft.summary, files, cards: draft.cards }
  })
  const storyPaths = new Set(Object.values(story.symbols).filter((symbol) => symbol.change !== 'context').map((symbol) => symbol.path))
  const leftovers = reviewFiles(detail.files).filter((file) => !storyPaths.has(file.path))
  const rest = numberChapters(fileChapters(list(value.files), leftovers)).map((chapter, index) => ({
    ...chapter,
    id: `ch-${chapters.length + index + 1}`
  }))
  const all = [...chapters, ...rest]
  if (all.length === 0) throw new Error('AI guide put nothing in a chapter')
  const flow = chapters.length > 0 ? storyFlow(chapters, story.symbols) : fileFlow(story, all)
  return {
    source: 'ai',
    headSha: detail.head.sha,
    overview,
    questions: parseQuestions(value.questions, story.questions),
    flow: { ...flow, caption: text(value.caption) ?? flow.caption },
    chapters: all,
    symbols: story.symbols,
    coverage: guideCoverage(detail)
  }
}
