import Parser from 'web-tree-sitter'
import { assembleIndex, type ParsedFile, type ParsedVersion } from '@shared/code-index'
import { classifyFile } from '@shared/guide/roles'
import type { ChangedFile, CodeIndex, FileRole, PullDetail } from '@shared/types'
import { blockLanguageFor, parseBlocks } from './blocks'
import { grammarFor, type Grammar } from './languages'
import { parseSource } from './parse'

export type GrammarFiles = { runtime: string; grammar: (name: string) => string }

export type IndexSource = {
  file(path: string, sha: string): Promise<string>
  tree(sha: string): Promise<string[]>
}

export type IndexResult = { index: CodeIndex; heads: Record<string, string> }

const LIMITS = { files: 80, bytes: 300_000, pipelineFiles: 60, concurrency: 6 }
const INDEXED_ROLES: FileRole[] = ['core', 'ui', 'test']
const PIPELINE_FILES = [/(^|\/)workflows\/[^/]+\.nf$/, /(^|\/)subworkflows\/(?:[^/]+\/)*main\.nf$/]

export class TreeSitter {
  private ready: Promise<void> | null = null
  private readonly languages = new Map<string, Promise<Parser.Language>>()

  constructor(private readonly files: GrammarFiles) {}

  async parse(grammar: Grammar, source: string): Promise<ParsedVersion> {
    this.ready ??= Parser.init({ locateFile: () => this.files.runtime })
    await this.ready
    let language = this.languages.get(grammar.wasm)
    if (!language) {
      language = Parser.Language.load(this.files.grammar(grammar.wasm))
      language.catch(() => this.languages.delete(grammar.wasm))
      this.languages.set(grammar.wasm, language)
    }
    const parser = new Parser()
    try {
      parser.setLanguage(await language)
      return parseSource(parser, grammar, source)
    } finally {
      parser.delete()
    }
  }
}

function familyOf(path: string): string | null {
  return grammarFor(path)?.family ?? blockLanguageFor(path)?.family ?? null
}

async function parseVersion(treeSitter: TreeSitter, path: string, text: string): Promise<ParsedVersion | null> {
  const grammar = grammarFor(path)
  if (grammar) return treeSitter.parse(grammar, text)
  const blocks = blockLanguageFor(path)
  return blocks ? parseBlocks(blocks, text, path) : null
}

async function pool<T, R>(items: T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await run(items[index] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

function inScope(file: ChangedFile): boolean {
  return INDEXED_ROLES.includes(classifyFile(file.path)) && familyOf(file.path) !== null
}

export async function indexPull(detail: PullDetail, source: IndexSource, treeSitter: TreeSitter): Promise<IndexResult> {
  const heads: Record<string, string> = {}
  const skipped: string[] = []
  const scoped: ChangedFile[] = []
  for (const file of detail.files) {
    if (!INDEXED_ROLES.includes(classifyFile(file.path))) continue
    if (!inScope(file) || file.patch === null || scoped.length >= LIMITS.files) skipped.push(file.path)
    else scoped.push(file)
  }

  const read = async (path: string, sha: string): Promise<string | null> => {
    const text = await source.file(path, sha)
    return text.length > LIMITS.bytes ? null : text
  }

  const parsed = await pool(scoped, LIMITS.concurrency, async (file): Promise<ParsedFile | null> => {
    const family = familyOf(file.path) ?? ''
    try {
      const headText = file.status === 'removed' ? '' : await read(file.path, detail.head.sha)
      const baseText = file.status === 'added' ? '' : await read(file.previousPath ?? file.path, detail.base.sha)
      if (headText === null || baseText === null) return null
      if (file.status !== 'removed') heads[file.path] = headText
      return {
        path: file.path,
        family,
        file,
        head: file.status === 'removed' ? null : await parseVersion(treeSitter, file.path, headText),
        base: file.status === 'added' ? null : await parseVersion(treeSitter, file.previousPath ?? file.path, baseText)
      }
    } catch {
      return null
    }
  })

  const files: ParsedFile[] = []
  parsed.forEach((entry, index) => {
    if (entry === null) skipped.push(scoped[index]?.path ?? '')
    else files.push(entry)
  })
  files.push(...(await pipelineFiles(detail, source, treeSitter, heads)))
  return { index: assembleIndex(detail.head.sha, files, skipped), heads }
}

// Nextflow entries usually live in unchanged workflow files, so read them at head to find which product workflow runs a change.
async function pipelineFiles(
  detail: PullDetail,
  source: IndexSource,
  treeSitter: TreeSitter,
  heads: Record<string, string>
): Promise<ParsedFile[]> {
  if (!detail.files.some((file) => file.path.endsWith('.nf'))) return []
  let paths: string[]
  try {
    paths = await source.tree(detail.head.sha)
  } catch {
    return []
  }
  const changed = new Set(detail.files.map((file) => file.path))
  const wanted = paths
    .filter((path) => !changed.has(path) && PIPELINE_FILES.some((pattern) => pattern.test(path)))
    .slice(0, LIMITS.pipelineFiles)
  const parsed = await pool(wanted, LIMITS.concurrency, async (path): Promise<ParsedFile | null> => {
    try {
      const text = await source.file(path, detail.head.sha)
      heads[path] = text
      return { path, family: 'nf', file: null, head: await parseVersion(treeSitter, path, text), base: null }
    } catch {
      return null
    }
  })
  return parsed.filter((entry): entry is ParsedFile => entry !== null)
}
