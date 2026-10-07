import type { FlowNodeChange } from '../types'
import type { ReviewFile } from './files'

export type SymbolKind = 'callable' | 'type'

export type Decl = {
  name: string
  kind: SymbolKind
  path: string
  family: string
  change: FlowNodeChange
  refs: Set<string>
}

type DeclPattern = { kind: SymbolKind; regex: RegExp }

// bindings are declarations a flow node can land on but that the flow never draws as nodes.
type Language = { family: string; extensions: string[]; patterns: DeclPattern[]; bindings: RegExp[] }

const LANGUAGES: Language[] = [
  {
    family: 'js',
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.vue', '.svelte'],
    patterns: [
      { kind: 'callable', regex: /\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)\s*[<(]/ },
      { kind: 'type', regex: /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/ },
      { kind: 'type', regex: /^(?:export\s+)?(?:declare\s+)?(?:const\s+)?(?:interface|enum)\s+([A-Za-z_$][\w$]*)/ },
      { kind: 'type', regex: /^export\s+(?:declare\s+)?type\s+([A-Za-z_$][\w$]*)/ },
      {
        kind: 'callable',
        regex:
          /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)[^=]*=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*(?::[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>)/
      },
      {
        kind: 'callable',
        regex:
          /^(?:(?:public|private|protected|static|async|override|readonly|get|set)\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::\s*[^{=]+)?\{\s*$/
      }
    ],
    bindings: [/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[:=]/]
  },
  {
    family: 'jvm',
    extensions: ['.kt', '.kts', '.java'],
    patterns: [
      { kind: 'callable', regex: /\bfun\s+(?:<[^>]+>\s*)?(?:[\w.]+\.)?([A-Za-z_]\w*)\s*\(/ },
      { kind: 'type', regex: /\b(?:class|interface|object|record)\s+([A-Za-z_]\w*)/ },
      {
        kind: 'callable',
        regex:
          /^(?:(?:public|private|protected|static|final|abstract|synchronized|native|default)\s+)+[\w<>[\],.? ]+\s+([A-Za-z_]\w*)\s*\(/
      }
    ],
    bindings: [/^(?:(?:private|public|protected|internal|override|const|lateinit)\s+)*(?:val|var)\s+([A-Za-z_]\w*)/]
  },
  {
    family: 'swift',
    extensions: ['.swift'],
    patterns: [
      { kind: 'callable', regex: /\bfunc\s+([A-Za-z_]\w*)/ },
      { kind: 'type', regex: /\b(?:class|struct|enum|protocol|actor)\s+([A-Za-z_]\w*)/ }
    ],
    bindings: []
  },
  {
    family: 'py',
    extensions: ['.py', '.pyi'],
    patterns: [
      { kind: 'callable', regex: /^(?:async\s+)?def\s+([A-Za-z_]\w*)/ },
      { kind: 'type', regex: /^class\s+([A-Za-z_]\w*)/ }
    ],
    bindings: []
  },
  {
    family: 'go',
    extensions: ['.go'],
    patterns: [
      { kind: 'callable', regex: /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/ },
      { kind: 'type', regex: /^type\s+([A-Za-z_]\w*)\s+(?:struct|interface)\b/ }
    ],
    bindings: []
  },
  {
    family: 'rust',
    extensions: ['.rs'],
    patterns: [
      {
        kind: 'callable',
        regex: /^(?:pub(?:\([^)]*\))?\s+)?(?:(?:async|const|unsafe|extern(?:\s+"[^"]*")?)\s+)*fn\s+([A-Za-z_]\w*)/
      },
      { kind: 'type', regex: /^(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait)\s+([A-Za-z_]\w*)/ }
    ],
    bindings: [/^impl(?:<[^>]*>)?\s+(?:[\w:<>]+\s+for\s+)?([A-Za-z_]\w*)/]
  }
]

const NOT_SYMBOLS = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'function',
  'return',
  'else',
  'do',
  'with',
  'constructor',
  'super',
  'typeof',
  'await',
  'new'
])

const CHANGE_WEIGHT: Record<FlowNodeChange, number> = { context: 0, modified: 1, added: 2 }

function languageOf(path: string): Language | null {
  const lower = path.toLowerCase()
  for (const language of LANGUAGES) {
    for (const extension of language.extensions) {
      if (lower.endsWith(extension)) return language
    }
  }
  return null
}

function matchDecl(language: Language, text: string): { name: string; kind: SymbolKind } | null {
  const line = text.trim()
  if (line.startsWith('//') || line.startsWith('/*') || line.startsWith('*') || line.startsWith('#')) return null
  for (const pattern of language.patterns) {
    const match = pattern.regex.exec(line)
    const name = match?.[1]
    if (name !== undefined && !NOT_SYMBOLS.has(name)) return { name, kind: pattern.kind }
  }
  return null
}

export function declares(path: string, text: string, name: string): boolean {
  const language = languageOf(path)
  if (language === null) return false
  if (matchDecl(language, text)?.name === name) return true
  const line = text.trim()
  for (const binding of language.bindings) {
    if (binding.exec(line)?.[1] === name) return true
  }
  return false
}

const STRING_LITERAL = /(["'`])(?:\\.|(?!\1)[^\\])*\1/g

export function identifiers(text: string): string[] {
  const code = text.replace(STRING_LITERAL, ' ').replace(/\/\/.*$/, '')
  return code.match(/[A-Za-z_$][\w$]*/g) ?? []
}

export function fileDecls(file: ReviewFile): Decl[] {
  const language = languageOf(file.path)
  if (language === null) return []
  const byName = new Map<string, Decl>()

  const record = (found: { name: string; kind: SymbolKind }, change: FlowNodeChange): Decl => {
    const existing = byName.get(found.name)
    if (existing !== undefined) {
      if (CHANGE_WEIGHT[change] > CHANGE_WEIGHT[existing.change]) existing.change = change
      return existing
    }
    const decl: Decl = {
      name: found.name,
      kind: found.kind,
      path: file.path,
      family: language.family,
      change,
      refs: new Set()
    }
    byName.set(found.name, decl)
    return decl
  }

  for (const hunk of file.hunks) {
    let section: Decl | null = null
    if (hunk.section !== null) {
      const found = matchDecl(language, hunk.section)
      if (found !== null) section = record(found, 'modified')
    }
    let current = section
    for (const line of hunk.lines) {
      if (line.kind === 'del' || line.text.trim() === '') continue
      const found = matchDecl(language, line.text)
      if (line.kind === 'context') {
        if (found !== null) current = record(found, 'context')
        continue
      }
      if (found !== null) {
        const decl = record(found, 'added')
        if (section !== null && section.kind === 'type' && section !== decl) section.refs.add(decl.name)
        current = decl
        continue
      }
      if (current === null) continue
      if (current.change === 'context') current.change = 'modified'
      for (const name of identifiers(line.text)) current.refs.add(name)
    }
  }

  return [...byName.values()]
}

export function declsByPath(files: ReviewFile[]): Map<string, Decl[]> {
  const decls = new Map<string, Decl[]>()
  for (const file of files) decls.set(file.path, fileDecls(file))
  return decls
}

export function symbolLabel(decl: { name: string; kind: SymbolKind }): string {
  if (decl.kind === 'callable' && !/^[A-Z]/.test(decl.name)) return `${decl.name}()`
  return decl.name
}
