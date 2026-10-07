import type { Chapter, PullDetail } from '../types'
import { commonPrefix, dirSegments, plural } from './files'

const SUMMARY_LIMIT = 320

const SKIPPED_LINES = [
  /^\s*#{1,6}\s/,
  /^\s*[-*+]\s+\[[ xX]\]/,
  /^\s*([-*_]\s*){3,}$/
]

function plainText(paragraph: string): string {
  return paragraph
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|__/g, '')
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text
  const cut = text.slice(0, limit)
  const sentenceEnd = cut.lastIndexOf('. ')
  if (sentenceEnd > limit / 2) return cut.slice(0, sentenceEnd + 1)
  const space = cut.lastIndexOf(' ')
  return `${cut.slice(0, space > 0 ? space : limit).trimEnd()}…`
}

export function bodySummary(body: string): string {
  const kept: string[] = []
  for (const line of body.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/)) {
    let skip = false
    for (const pattern of SKIPPED_LINES) {
      if (pattern.test(line)) skip = true
    }
    kept.push(skip ? '' : line)
  }
  for (const paragraph of kept.join('\n').split(/\n\s*\n/)) {
    const text = plainText(paragraph)
    if (text !== '') return truncate(text, SUMMARY_LIMIT)
  }
  return ''
}

export function overviewFor(detail: PullDetail, chapters: Chapter[]): { summary: string; points: string[] } {
  let summary = bodySummary(detail.body)
  if (summary === '') {
    summary = `Changes ${plural(detail.files.length, 'file')} (+${detail.additions} -${detail.deletions})`
    const lead = chapters[0]
    const area = lead === undefined ? [] : commonPrefix(lead.files.map(dirSegments))
    summary += area.length > 0 ? `, mostly in ${area.join('/')}.` : '.'
  }
  const points: string[] = []
  for (const chapter of chapters) points.push(`${chapter.title} (${plural(chapter.files.length, 'file')})`)
  return { summary, points }
}
