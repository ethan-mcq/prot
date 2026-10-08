import type { Chapter, CodeSymbol, GuideOverview, PullDetail, RiskLevel } from '../types'
import { baseName, joinWords, plural, reviewFiles, type ReviewFile } from './files'

const THRESHOLDS = { highCoreLines: 800, mediumLines: 300, callerSections: 2 }

export type RiskInput = { files: ReviewFile[]; chapters: Chapter[]; symbols: Record<string, CodeSymbol> }

type RiskRule = { level: RiskLevel; reason: (input: RiskInput) => string | null }

function lines(files: ReviewFile[]): number {
  return files.reduce((sum, file) => sum + file.churn, 0)
}

function chapterOf(input: RiskInput, symbol: CodeSymbol): Chapter | undefined {
  return (
    input.chapters.find((chapter) => chapter.cards.some((card) => card.symbolId === symbol.id && card.seeChapterId === null)) ??
    input.chapters.find((chapter) => chapter.files.includes(symbol.path))
  )
}

function sharedSymbol(input: RiskInput): string | null {
  const all = Object.values(input.symbols)
  for (const symbol of all) {
    if (symbol.change !== 'modified' && symbol.change !== 'deleted') continue
    if (symbol.kind === 'module' || symbol.kind === 'test') continue
    const sections = new Set<string>()
    for (const caller of all) {
      if (caller.id === symbol.id || caller.kind === 'test' || !caller.calls.includes(symbol.id)) continue
      const chapter = chapterOf(input, caller)
      if (chapter !== undefined) sections.add(chapter.title)
    }
    if (sections.size >= THRESHOLDS.callerSections) {
      const verb = symbol.change === 'deleted' ? 'Deletes' : 'Changes'
      return `${verb} ${symbol.qualifiedName}, which callers in ${plural(sections.size, 'section')} depend on (${joinWords([...sections])}).`
    }
  }
  return null
}

function untestedSection(input: RiskInput): string | null {
  const story = input.chapters.filter((chapter) => chapter.cards.length > 0)
  if (story.length > 0) {
    for (const chapter of story) {
      const core = chapter.cards.some((card) => {
        const symbol = input.symbols[card.symbolId]
        const file = input.files.find((candidate) => candidate.path === symbol?.path)
        return card.seeChapterId === null && symbol !== undefined && symbol.change !== 'context' && file?.role === 'core'
      })
      if (core && !chapter.cards.some((card) => card.role === 'test')) {
        return `No tests cover the section "${chapter.title}", which changes core code.`
      }
    }
    return null
  }
  const core = input.files.some((file) => file.role === 'core')
  return core && !input.files.some((file) => file.role === 'test') ? 'Core code changes with no test changes alongside it.' : null
}

// First matching row wins, so the reason always names the rule that set the level.
export const RISK_RULES: RiskRule[] = [
  {
    level: 'high',
    reason: ({ files }) => {
      const schema = files.filter((file) => file.role === 'schema').map((file) => baseName(file.path))
      return schema.length > 0 ? `Changes stored data through ${joinWords(schema)}, so check it is safe to run and to roll back.` : null
    }
  },
  { level: 'high', reason: sharedSymbol },
  {
    level: 'high',
    reason: ({ files }) => {
      const core = lines(files.filter((file) => file.role === 'core'))
      return core > THRESHOLDS.highCoreLines ? `Changes ${core} lines of core code in one pull request.` : null
    }
  },
  { level: 'medium', reason: untestedSection },
  {
    level: 'medium',
    reason: ({ files }) => {
      const total = lines(files.filter((file) => file.role !== 'deps' && file.role !== 'generated'))
      return total > THRESHOLDS.mediumLines ? `Changes ${total} lines, which is a lot to hold in one review.` : null
    }
  }
]

export function assessRisk(input: RiskInput): GuideOverview['risk'] {
  for (const rule of RISK_RULES) {
    const reason = rule.reason(input)
    if (reason !== null) return { level: rule.level, reason }
  }
  const total = lines(input.files.filter((file) => file.role !== 'deps' && file.role !== 'generated'))
  return { level: 'low', reason: `${plural(total, 'changed line')}, no schema change, and tests sit beside the core code.` }
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1)
}

function codeSynopsis(input: RiskInput): string {
  const story = input.chapters.filter((chapter) => chapter.cards.length > 0)
  const counts = { added: 0, modified: 0, deleted: 0 }
  for (const symbol of Object.values(input.symbols)) {
    if (symbol.kind === 'module' || symbol.kind === 'test' || symbol.change === 'context') continue
    counts[symbol.change] += 1
  }
  const parts: string[] = []
  if (counts.added > 0) parts.push(`adds ${plural(counts.added, 'symbol')}`)
  if (counts.modified > 0) parts.push(`changes ${counts.modified}`)
  if (counts.deleted > 0) parts.push(`removes ${counts.deleted}`)
  const what = parts.length > 0 ? joinWords(parts) : 'changes only tests and module-level code'
  const entryId = story[0]?.cards[0]?.symbolId
  const entry = entryId === undefined ? undefined : input.symbols[entryId]
  const through = entry === undefined ? '' : `, entered through ${entry.qualifiedName}`
  return `It ${what} across ${plural(story.length, 'section')}${through}.`
}

function fileSynopsis(input: RiskInput, detail: PullDetail): string {
  const first = input.chapters[0]
  const most = first === undefined ? '' : `, mostly ${lowerFirst(first.title)}`
  return `It changes ${plural(detail.files.length, 'file')} (+${detail.additions} -${detail.deletions}) in ${plural(input.chapters.length, 'chapter')}${most}.`
}

export function overviewFor(detail: PullDetail, chapters: Chapter[], symbols: Record<string, CodeSymbol>): GuideOverview {
  const input: RiskInput = { files: reviewFiles(detail.files), chapters, symbols }
  const synopsis = Object.keys(symbols).length > 0 ? codeSynopsis(input) : fileSynopsis(input, detail)
  return { risk: assessRisk(input), synopsis }
}
