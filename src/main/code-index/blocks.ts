import type { ParsedSymbol, ParsedVersion, Ref } from '@shared/code-index'
import type { SymbolKind } from '@shared/types'
import { absorbBlankLines } from './parse'

type Header = { regex: RegExp; symbol: (match: RegExpExecArray) => { name: string; kind: SymbolKind } }

export type BlockLanguage = {
  family: string
  extensions: string[]
  quotes: string[]
  comments: { line: string[]; block: boolean }
  heredoc: boolean
  refsInStrings: boolean
  headers: Header[]
  refs: (code: string, dir: string) => { name?: string; dir?: string }[]
  aliases: (body: string[]) => string[]
  includes: (line: string) => Map<string, string> | null
}

function joinPath(dir: string, relative: string): string {
  const out = dir === '' ? [] : dir.split('/')
  for (const segment of relative.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') out.pop()
    else out.push(segment)
  }
  return out.join('/')
}

const TF_KEYWORDS = new Set(['module', 'var', 'local', 'data', 'each', 'count', 'self', 'path', 'terraform'])

export const TERRAFORM: BlockLanguage = {
  family: 'tf',
  extensions: ['.tf'],
  quotes: ['"'],
  comments: { line: ['#', '//'], block: true },
  heredoc: true,
  refsInStrings: true,
  headers: [
    { regex: /^resource\s+"([^"]+)"\s+"([^"]+)"/, symbol: (m) => ({ name: `${m[1]}.${m[2]}`, kind: 'constant' }) },
    { regex: /^data\s+"([^"]+)"\s+"([^"]+)"/, symbol: (m) => ({ name: `data.${m[1]}.${m[2]}`, kind: 'constant' }) },
    { regex: /^module\s+"([^"]+)"/, symbol: (m) => ({ name: `module.${m[1]}`, kind: 'class' }) },
    { regex: /^variable\s+"([^"]+)"/, symbol: (m) => ({ name: `var.${m[1]}`, kind: 'type' }) },
    { regex: /^output\s+"([^"]+)"/, symbol: (m) => ({ name: `output.${m[1]}`, kind: 'type' }) },
    { regex: /^locals\b/, symbol: () => ({ name: 'locals', kind: 'type' }) },
    { regex: /^provider\s+"([^"]+)"/, symbol: (m) => ({ name: `provider.${m[1]}`, kind: 'constant' }) },
    { regex: /^terraform\b/, symbol: () => ({ name: 'terraform', kind: 'constant' }) }
  ],
  refs: (code, dir) => {
    const found: { name?: string; dir?: string }[] = []
    for (const match of code.matchAll(/\b(module|var|local)\.([A-Za-z_][\w-]*)/g)) found.push({ name: `${match[1]}.${match[2]}` })
    for (const match of code.matchAll(/\bdata\.([\w-]+)\.([\w-]+)/g)) found.push({ name: `data.${match[1]}.${match[2]}` })
    for (const match of code.matchAll(/(?<![.\w])([a-z][a-z0-9]*_[a-z0-9_]+)\.([A-Za-z_][\w-]*)/g)) {
      if (!TF_KEYWORDS.has(match[1] ?? '')) found.push({ name: `${match[1]}.${match[2]}` })
    }
    const source = /^\s*source\s*=\s*"(\.{1,2}\/[^"]+)"/.exec(code)
    if (source?.[1]) found.push({ dir: joinPath(dir, source[1]) })
    return found
  },
  aliases: (body) => {
    const names: string[] = []
    for (const line of body) {
      const key = /^\s{1,4}([A-Za-z_][\w-]*)\s*=/.exec(line)?.[1]
      if (key) names.push(`local.${key}`)
    }
    return names
  },
  includes: () => null
}

export const NEXTFLOW: BlockLanguage = {
  family: 'nf',
  extensions: ['.nf'],
  quotes: ['"""', "'''", '"', "'"],
  comments: { line: ['//'], block: true },
  heredoc: false,
  refsInStrings: false,
  headers: [
    { regex: /^process\s+([A-Za-z_]\w*)\s*\{/, symbol: (m) => ({ name: m[1] ?? '', kind: 'function' }) },
    { regex: /^workflow\s+([A-Za-z_]\w*)\s*\{/, symbol: (m) => ({ name: m[1] ?? '', kind: 'function' }) },
    { regex: /^workflow\s*\{/, symbol: () => ({ name: 'workflow', kind: 'function' }) },
    { regex: /^def\s+([A-Za-z_]\w*)\s*\(/, symbol: (m) => ({ name: m[1] ?? '', kind: 'function' }) }
  ],
  refs: (code) => [...code.matchAll(/\b[A-Za-z_]\w*\b/g)].map((match) => ({ name: match[0] })),
  aliases: () => [],
  includes: (line) => {
    const match = /^\s*include\s*\{([^}]*)\}/.exec(line)
    if (!match) return null
    const aliases = new Map<string, string>()
    for (const part of (match[1] ?? '').split(';')) {
      const named = /^\s*([A-Za-z_]\w*)(?:\s+as\s+([A-Za-z_]\w*))?\s*$/.exec(part)
      if (named?.[1]) aliases.set(named[2] ?? named[1], named[1])
    }
    return aliases
  }
}

export const BLOCK_LANGUAGES = [TERRAFORM, NEXTFLOW]

export function blockLanguageFor(path: string): BlockLanguage | null {
  const lower = path.toLowerCase()
  return BLOCK_LANGUAGES.find((language) => language.extensions.some((extension) => lower.endsWith(extension))) ?? null
}

function isComment(line: string, language: BlockLanguage): boolean {
  const text = line.trim()
  return language.comments.line.some((marker) => text.startsWith(marker)) || text.startsWith('/*') || text.startsWith('*')
}

type Scanned = { code: string[]; withStrings: string[]; depthAtStart: number[] }

// Blanks out strings and comments line by line, so brace counting and reference matching see only code.
function scan(lines: string[], language: BlockLanguage): Scanned {
  const code: string[] = []
  const withStrings: string[] = []
  const depthAtStart: number[] = []
  let depth = 0
  let quote: string | null = null
  let blockComment = false
  let heredoc: string | null = null
  for (const line of lines) {
    depthAtStart.push(depth)
    if (heredoc !== null) {
      if (line.trim() === heredoc) heredoc = null
      code.push('')
      withStrings.push(line)
      continue
    }
    let out = ''
    let kept = ''
    let i = 0
    while (i < line.length) {
      const rest = line.slice(i)
      if (blockComment) {
        const close = rest.indexOf('*/')
        if (close === -1) break
        blockComment = false
        i += close + 2
        continue
      }
      if (quote !== null) {
        if (rest.startsWith('\\')) {
          kept += rest.slice(0, 2)
          i += 2
          continue
        }
        if (rest.startsWith(quote)) {
          kept += quote
          i += quote.length
          out += ' '
          quote = null
          continue
        }
        kept += line.charAt(i)
        i += 1
        continue
      }
      if (language.comments.line.some((marker) => rest.startsWith(marker))) break
      if (language.comments.block && rest.startsWith('/*')) {
        blockComment = true
        i += 2
        continue
      }
      const heredocStart = language.heredoc ? /^<<-?([A-Z_]+)\s*$/.exec(rest) : null
      if (heredocStart?.[1]) {
        heredoc = heredocStart[1]
        break
      }
      const opening = language.quotes.find((candidate) => rest.startsWith(candidate))
      if (opening !== undefined) {
        quote = opening
        kept += opening
        i += opening.length
        continue
      }
      const char = line.charAt(i)
      if (char === '{') depth += 1
      if (char === '}') depth = Math.max(0, depth - 1)
      out += char
      kept += char
      i += 1
    }
    if (quote !== null && quote.length === 1) quote = null
    code.push(out)
    withStrings.push(kept)
  }
  depthAtStart.push(depth)
  return { code, withStrings, depthAtStart }
}

export function parseBlocks(language: BlockLanguage, source: string, path: string): ParsedVersion {
  const lines = source.split('\n')
  const { code, withStrings, depthAtStart } = scan(lines, language)
  const refText = language.refsInStrings ? withStrings : code
  const slash = path.lastIndexOf('/')
  const dir = slash === -1 ? '' : path.slice(0, slash)
  const aliases = new Map<string, string>()
  for (const line of lines) {
    for (const [alias, name] of language.includes(line) ?? []) aliases.set(alias, name)
  }
  const refsOf = (from: number, to: number): Ref[] => {
    const refs: Ref[] = []
    for (let row = from; row <= to; row++) {
      for (const found of language.refs(refText[row] ?? '', dir)) {
        if (found.dir !== undefined) refs.push({ kind: 'dir', dir: found.dir, line: row + 1 })
        if (found.name !== undefined) {
          refs.push({ kind: 'name', name: aliases.get(found.name) ?? found.name, line: row + 1, member: false })
        }
      }
    }
    return refs
  }

  const symbols: ParsedSymbol[] = []
  const covered = new Set<number>()
  for (let row = 0; row < lines.length; row++) {
    if (depthAtStart[row] !== 0) continue
    const text = (withStrings[row] ?? '').trim()
    for (const header of language.headers) {
      const match = header.regex.exec(text)
      if (!match) continue
      let end = row
      while (end + 1 < lines.length && (depthAtStart[end + 1] ?? 0) > 0) end += 1
      const { name, kind } = header.symbol(match)
      const body = lines.slice(row + 1, end)
      let start = row
      while (start > 0 && !covered.has(start - 1) && isComment(lines[start - 1] ?? '', language)) start -= 1
      for (let line = start; line <= end; line++) covered.add(line)
      symbols.push({
        name,
        qualifiedName: name,
        kind,
        parent: null,
        range: { start: start + 1, end: end + 1 },
        refs: refsOf(row, end).filter((ref) => ref.kind === 'dir' || ref.name !== name),
        decorators: [],
        aliases: language.aliases(body)
      })
      row = end
      break
    }
  }
  const moduleRefs: Ref[] = []
  lines.forEach((line, row) => {
    if (covered.has(row)) return
    for (const name of language.includes(line)?.values() ?? []) moduleRefs.push({ kind: 'name', name, line: row + 1, member: false })
  })
  absorbBlankLines(symbols, lines)
  return { symbols, moduleRefs }
}
