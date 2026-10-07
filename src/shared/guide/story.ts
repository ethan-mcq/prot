import type {
  CardRole,
  Chapter,
  CodeIndex,
  CodeSymbol,
  Flow,
  FlowEdge,
  FlowNode,
  Guide,
  LineRange,
  PullDetail,
  StoryCard,
  SymbolKind
} from '../types'
import { numberChapters, planChapters, ROLE_INFO } from './chapters'
import { joinWords, plural, reviewFiles } from './files'
import { buildHeuristicGuide } from './heuristic'
import { overviewFor } from './overview'
import { classifyFile } from './roles'
import { declsByPath } from './symbols'

const DATA_KINDS: SymbolKind[] = ['type', 'interface', 'enum', 'constant']
const SMALL_CONTEXT = 12
const WHOLE_ENTRY = 25
const EXCERPT_CONTEXT = 3

type Predicate = (symbol: CodeSymbol) => boolean

type EntryRule = { code: string; files: RegExp; hops: number; boundary: Predicate | null; skip: Predicate | null }

const ROUTE_DECORATOR = /(^|\.)(route|get|post|put|delete|patch|api_route)$|Mapping$/
const CLI_DECORATOR = /(^|\.)(command|group)$/

const isRoute: Predicate = (s) => s.decorators.some((decorator) => ROUTE_DECORATOR.test(decorator))
const isCli: Predicate = (s) =>
  s.name === '__main__' || s.decorators.some((decorator) => CLI_DECORATOR.test(decorator)) || (s.parentId === null && /^(main|run_\w+)$/.test(s.name))
const isPage: Predicate = (s) => /(^|\/)(pages|routes)\//.test(s.path) || /(^|\/)app\/(?:.+\/)?page\.[jt]sx?$/.test(s.path)
const isProductWorkflow: Predicate = (s) => /(^|\/)workflows\/[^/]+\.nf$/.test(s.path)
const isDispatcher: Predicate = (s) => /(^|\/)main\.nf$/.test(s.path) && !/(^|\/)(subworkflows|modules)\//.test(s.path)

// How far above a section root the entry may climb, and where it stops. First matching row wins.
export const ENTRY_RULES: EntryRule[] = [
  { code: 'terraform', files: /\.tf$/, hops: 0, boundary: null, skip: null },
  { code: 'nextflow', files: /\.nf$/, hops: 2, boundary: isProductWorkflow, skip: isDispatcher },
  { code: 'python', files: /\.py$/, hops: 2, boundary: (s) => isCli(s) || isRoute(s), skip: null },
  { code: 'frontend', files: /\.(tsx|jsx|vue|svelte)$/, hops: 2, boundary: isPage, skip: null },
  { code: 'service', files: /\.(ts|mts|cts|js|mjs|cjs|go|java|kt|rb|rs)$/, hops: 2, boundary: isRoute, skip: null },
  { code: 'other', files: /./, hops: 1, boundary: null, skip: null }
]

function entryRule(path: string): EntryRule {
  return ENTRY_RULES.find((rule) => rule.files.test(path)) ?? { code: 'other', files: /./, hops: 1, boundary: null, skip: null }
}

const isTerraform: Predicate = (s) => s.path.endsWith('.tf')

type SectionKind = 'story' | 'component' | 'loose' | 'tests'

type Section = {
  kind: SectionKind
  root: CodeSymbol | null
  key: string
  entries: StoryCard[]
  main: StoryCard[]
  data: StoryCard[]
  modules: StoryCard[]
  tests: StoryCard[]
}

function cardsOf(section: Section): StoryCard[] {
  return [...section.entries, ...section.main, ...section.data, ...section.modules, ...section.tests]
}

function card(symbolId: string, role: CardRole, excerpt: LineRange[] | null = null): StoryCard {
  return { symbolId, role, seeChapterId: null, excerpt }
}

function stepRole(depth: number): CardRole {
  return depth <= 1 ? 'step' : 'helper'
}

function lines(range: LineRange | null): number {
  return range === null ? 0 : range.end - range.start + 1
}

class Story {
  readonly byId = new Map<string, CodeSymbol>()
  readonly order = new Map<string, number>()
  readonly placed = new Map<string, Section>()
  readonly sections: Section[] = []
  private readonly callers = new Map<string, CodeSymbol[]>()
  private readonly children = new Map<string, CodeSymbol[]>()

  constructor(readonly symbols: CodeSymbol[]) {
    symbols.forEach((symbol, index) => {
      this.byId.set(symbol.id, symbol)
      this.order.set(symbol.id, index)
    })
    for (const symbol of symbols) {
      for (const id of symbol.calls) this.callers.set(id, [...(this.callers.get(id) ?? []), symbol])
      if (symbol.parentId !== null) this.children.set(symbol.parentId, [...(this.children.get(symbol.parentId) ?? []), symbol])
    }
  }

  changed(symbol: CodeSymbol): boolean {
    return symbol.change !== 'context'
  }

  testish(symbol: CodeSymbol): boolean {
    return symbol.kind === 'test' || classifyFile(symbol.path) === 'test'
  }

  // Symbols the call graph places; tests, module blocks and Terraform are placed by their own rules.
  storyCode(symbol: CodeSymbol): boolean {
    return this.changed(symbol) && !this.testish(symbol) && symbol.kind !== 'module' && !isTerraform(symbol)
  }

  parentOf(symbol: CodeSymbol): CodeSymbol | null {
    return symbol.parentId === null ? null : (this.byId.get(symbol.parentId) ?? null)
  }

  membersOf(symbol: CodeSymbol): CodeSymbol[] {
    return this.children.get(symbol.id) ?? []
  }

  callersOf(symbol: CodeSymbol): CodeSymbol[] {
    return this.callers.get(symbol.id) ?? []
  }

  descendants(symbol: CodeSymbol): CodeSymbol[] {
    const result: CodeSymbol[] = []
    for (const child of this.membersOf(symbol)) result.push(child, ...this.descendants(child))
    return result
  }

  section(kind: SectionKind, root: CodeSymbol | null, key: string): Section {
    const taken = this.sections.filter((other) => other.key === key || other.key.startsWith(`${key}~`)).length
    const unique = taken === 0 ? key : `${key}~${taken + 1}`
    const section: Section = { kind, root, key: unique, entries: [], main: [], data: [], modules: [], tests: [] }
    this.sections.push(section)
    return section
  }

  holds(section: Section, symbolId: string): boolean {
    return cardsOf(section).some((entry) => entry.symbolId === symbolId)
  }

  // The only way a changed symbol becomes a full card, so none is shown twice.
  full(section: Section, symbol: CodeSymbol, role: CardRole, list: StoryCard[]): boolean {
    if (this.placed.has(symbol.id)) return false
    this.placed.set(symbol.id, section)
    list.push(card(symbol.id, role))
    return true
  }

  see(section: Section, symbol: CodeSymbol, role: CardRole, list: StoryCard[]): void {
    const home = this.placed.get(symbol.id)
    if (home === undefined || home === section || this.holds(section, symbol.id)) return
    list.push({ symbolId: symbol.id, role, seeChapterId: home.key, excerpt: null })
  }

  place(section: Section, symbol: CodeSymbol, role: CardRole, depth: number, queue: CodeSymbol[]): void {
    if (this.placed.has(symbol.id)) {
      this.see(section, symbol, role, section.main)
      return
    }
    const parent = this.parentOf(symbol)
    if (parent !== null && this.storyCode(parent) && !this.placed.has(parent.id)) {
      this.place(section, parent, role, depth, queue)
      return
    }
    this.full(section, symbol, role, section.main)
    for (const member of this.membersOf(symbol)) {
      if (this.storyCode(member) && !this.placed.has(member.id)) this.place(section, member, role === 'entry' ? 'step' : role, depth, queue)
    }
    for (const id of symbol.calls) {
      const target = this.byId.get(id)
      if (target === undefined) continue
      if (DATA_KINDS.includes(target.kind)) {
        queue.push(target)
        continue
      }
      if (this.storyCode(target)) this.place(section, target, stepRole(depth + 1), depth + 1, queue)
    }
  }

  placeData(section: Section, queue: CodeSymbol[]): void {
    const seen = new Set<string>()
    while (queue.length > 0) {
      const symbol = queue.shift()
      if (symbol === undefined || seen.has(symbol.id)) continue
      seen.add(symbol.id)
      if (this.storyCode(symbol)) {
        if (this.placed.has(symbol.id)) {
          this.see(section, symbol, 'data', section.data)
          continue
        }
        this.full(section, symbol, 'data', section.data)
        for (const member of this.membersOf(symbol)) {
          if (this.storyCode(member)) this.full(section, member, 'data', section.data)
        }
        for (const id of symbol.calls) {
          const target = this.byId.get(id)
          if (target !== undefined && DATA_KINDS.includes(target.kind)) queue.push(target)
        }
        continue
      }
      if (!this.changed(symbol) && lines(symbol.head) <= SMALL_CONTEXT && !this.holds(section, symbol.id)) {
        section.data.push(card(symbol.id, 'data'))
      }
    }
  }

  // Walks up through unchanged callers, at most the rule's hops, and stops at the first boundary.
  climb(root: CodeSymbol): CodeSymbol[] {
    const rule = entryRule(root.path)
    if (rule.hops === 0) return []
    const eligible = (symbol: CodeSymbol) =>
      !this.changed(symbol) && !this.testish(symbol) && symbol.kind !== 'module' && !(rule.skip?.(symbol) ?? false)
    const via = new Map<string, CodeSymbol>()
    let frontier = [root]
    const levels: CodeSymbol[][] = []
    for (let hop = 1; hop <= rule.hops; hop++) {
      const next: CodeSymbol[] = []
      for (const symbol of frontier) {
        for (const caller of this.callersOf(symbol)) {
          if (!eligible(caller) || via.has(caller.id) || caller.id === root.id) continue
          via.set(caller.id, symbol)
          next.push(caller)
        }
      }
      if (next.length === 0) break
      levels.push(next)
      const boundary = rule.boundary === null ? undefined : next.find(rule.boundary)
      if (boundary !== undefined) {
        const chain = [boundary]
        let cursor = via.get(boundary.id)
        while (cursor !== undefined && cursor.id !== root.id) {
          chain.push(cursor)
          cursor = via.get(cursor.id)
        }
        return chain
      }
      frontier = next
    }
    const nearest = levels[0]?.[0]
    return nearest === undefined ? [] : [nearest]
  }

  excerpt(entry: CodeSymbol, section: Section): LineRange[] | null {
    if (entry.head === null || lines(entry.head) <= WHOLE_ENTRY) return null
    const story = new Set(cardsOf(section).map((item) => item.symbolId))
    const hits: number[] = []
    for (const [id, at] of Object.entries(entry.callLines)) {
      if (story.has(id)) hits.push(...at)
    }
    if (hits.length === 0) return null
    const ranges: LineRange[] = []
    for (const line of [...new Set(hits)].sort((a, b) => a - b)) {
      const start = Math.max(entry.head.start, line - EXCERPT_CONTEXT)
      const end = Math.min(entry.head.end, line + EXCERPT_CONTEXT)
      const last = ranges[ranges.length - 1]
      if (last !== undefined && start <= last.end + 1) last.end = Math.max(last.end, end)
      else ranges.push({ start, end })
    }
    return ranges
  }

  storySection(root: CodeSymbol): Section {
    const section = this.section('story', root, root.id)
    const chain = this.climb(root)
    for (const entry of chain) section.entries.push(card(entry.id, 'entry'))
    const queue: CodeSymbol[] = []
    this.place(section, root, chain.length > 0 ? 'step' : 'entry', 0, queue)
    this.placeData(section, queue)
    section.entries = section.entries.map((entry) => {
      const symbol = this.byId.get(entry.symbolId)
      return symbol === undefined ? entry : { ...entry, excerpt: this.excerpt(symbol, section) }
    })
    return section
  }

  reach(root: CodeSymbol): number {
    const seen = new Set<string>()
    const visit = (symbol: CodeSymbol) => {
      if (seen.has(symbol.id)) return
      seen.add(symbol.id)
      for (const next of [...this.membersOf(symbol), ...symbol.calls.map((id) => this.byId.get(id))]) {
        if (next !== undefined && this.storyCode(next)) visit(next)
      }
    }
    visit(root)
    return seen.size
  }

  rank(symbol: CodeSymbol): number {
    return ROLE_INFO[classifyFile(symbol.path)].rank
  }

  sourceOrder(a: CodeSymbol, b: CodeSymbol): number {
    return (this.order.get(a.id) ?? 0) - (this.order.get(b.id) ?? 0)
  }

  candidates(): CodeSymbol[] {
    return this.symbols.filter((symbol) => {
      if (!this.storyCode(symbol)) return false
      const parent = this.parentOf(symbol)
      return parent === null || !this.storyCode(parent)
    })
  }

  roots(): CodeSymbol[] {
    return this.candidates().filter((symbol) => !this.callersOf(symbol).some((caller) => caller.id !== symbol.id && this.storyCode(caller)))
  }

  connected(root: CodeSymbol): boolean {
    return this.reach(root) > 1 || this.climb(root).length > 0
  }

  buildConnected(): void {
    const queue = this.roots()
      .filter((root) => this.connected(root))
      .sort((a, b) => this.rank(a) - this.rank(b) || this.reach(b) - this.reach(a) || this.sourceOrder(a, b))

    while (queue.length > 0) {
      const root = queue.shift()
      if (root === undefined || this.placed.has(root.id)) continue
      const section = this.storySection(root)
      const reached = new Set<string>()
      for (const item of cardsOf(section)) for (const id of this.byId.get(item.symbolId)?.calls ?? []) reached.add(id)
      const promoted = queue.filter((next) => reached.has(next.id) || this.climb(next).some((entry) => reached.has(entry.id)))
      for (const next of promoted) queue.splice(queue.indexOf(next), 1)
      queue.unshift(...promoted)
    }
    const loose = this.roots().filter((root) => !this.connected(root))
    for (const symbol of this.candidates()) {
      if (!this.placed.has(symbol.id) && !loose.includes(symbol)) this.storySection(symbol)
    }
  }

  buildLoose(): void {
    const loose = this.candidates().filter((symbol) => !this.placed.has(symbol.id))
    const byFile = new Map<string, CodeSymbol[]>()
    for (const root of loose.sort((a, b) => this.sourceOrder(a, b))) byFile.set(root.path, [...(byFile.get(root.path) ?? []), root])
    const groups = [...byFile.values()].sort(
      (a, b) => this.rank(a[0] as CodeSymbol) - this.rank(b[0] as CodeSymbol) || this.size(b) - this.size(a)
    )
    for (const group of groups) {
      const first = group[0] as CodeSymbol
      const section = this.section('loose', group.length === 1 ? first : null, `file:${first.path}`)
      for (const root of group) {
        const queue: CodeSymbol[] = []
        this.place(section, root, 'entry', 0, queue)
        this.placeData(section, queue)
      }
    }
  }

  size(group: CodeSymbol[]): number {
    return group.reduce((sum, symbol) => sum + lines(symbol.head ?? symbol.base), 0)
  }

  // A module block and the resources of the directory its source points at form one component.
  buildTerraform(): void {
    const changed = this.symbols.filter((symbol) => isTerraform(symbol) && this.changed(symbol) && symbol.kind !== 'module')
    const roleOf = (symbol: CodeSymbol): CardRole => (symbol.kind === 'constant' ? 'step' : 'data')
    for (const block of changed) {
      if (!block.qualifiedName.startsWith('module.') || this.placed.has(block.id)) continue
      const section = this.section('component', block, block.id)
      this.full(section, block, 'entry', section.main)
      for (const id of block.calls) {
        const target = this.byId.get(id)
        if (target !== undefined && changed.includes(target)) this.full(section, target, roleOf(target), section.main)
      }
    }
    const byDir = new Map<string, CodeSymbol[]>()
    for (const block of changed) {
      if (this.placed.has(block.id)) continue
      const dir = dirOf(block.path)
      byDir.set(dir, [...(byDir.get(dir) ?? []), block])
    }
    for (const [dir, blocks] of byDir) {
      const section = this.section('component', null, `dir:${dir}`)
      for (const block of blocks) this.full(section, block, roleOf(block), section.main)
    }
  }

  // Tests and test helpers join the first section holding something they reference; module blocks join their file first.
  attach(): void {
    const loose = this.symbols.filter((symbol) => this.changed(symbol) && !this.placed.has(symbol.id))
    const target = new Map<string, Section>()
    const refsOf = (symbol: CodeSymbol) => [symbol, ...this.descendants(symbol)].flatMap((item) => item.calls)
    const holding = (ids: string[]) =>
      this.sections.find((section) => section.kind !== 'tests' && ids.some((id) => this.holds(section, id)))
    const homeOf = (path: string): Section | undefined => {
      const carded = this.sections.find(
        (section) => section.kind !== 'tests' && cardsOf(section).some((item) => item.seeChapterId === null && this.byId.get(item.symbolId)?.path === path)
      )
      if (carded !== undefined) return carded
      for (const [id, section] of target) if (this.byId.get(id)?.path === path) return section
      return undefined
    }
    for (const symbol of loose) {
      const parent = this.parentOf(symbol)
      const inherited = parent === null ? undefined : target.get(parent.id)
      const found = inherited ?? (symbol.kind === 'module' ? (homeOf(symbol.path) ?? holding(refsOf(symbol))) : holding(refsOf(symbol)))
      if (found !== undefined) target.set(symbol.id, found)
    }
    for (const symbol of loose) {
      if (target.has(symbol.id) || symbol.kind === 'test') continue
      const caller = this.callersOf(symbol).find((item) => target.has(item.id))
      const found = (caller === undefined ? undefined : target.get(caller.id)) ?? homeOf(symbol.path)
      if (found !== undefined) target.set(symbol.id, found)
    }
    let others: Section | null = null
    for (const symbol of loose) {
      let section = target.get(symbol.id)
      if (section === undefined && this.testish(symbol)) section = others ??= this.section('tests', null, 'tests')
      section ??= this.section('loose', symbol, `file:${symbol.path}`)
      const testCard = this.testish(symbol)
      this.full(section, symbol, testCard ? 'test' : 'data', testCard ? section.tests : section.modules)
    }
    if (others !== null) {
      this.sections.splice(this.sections.indexOf(others), 1)
      this.sections.push(others)
    }
  }
}

function dirOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? '' : path.slice(0, slash)
}

const CHANGE_WORD = { added: 'is new', modified: 'changes', deleted: 'is removed', context: 'is unchanged' } as const

function lead(story: Story, section: Section): CodeSymbol | null {
  const steps = section.main.filter((item) => item.role === 'step' && item.seeChapterId === null)
  const symbols = steps.map((item) => story.byId.get(item.symbolId)).filter((symbol): symbol is CodeSymbol => symbol !== undefined)
  return symbols.find((symbol) => symbol.kind === 'function' || symbol.kind === 'method') ?? symbols[0] ?? null
}

// A changed root inside an unchanged class is a hook into existing code, so the story enters through it.
function hooksIn(story: Story, root: CodeSymbol): boolean {
  if (root.change === 'modified' || root.change === 'context') return true
  const parent = story.parentOf(root)
  return root.change === 'added' && parent !== null && parent.change === 'context'
}

function titleFor(story: Story, section: Section): string {
  const root = section.root
  if (section.kind === 'tests') return 'Other tests'
  if (section.kind === 'component') {
    if (root !== null) return `Terraform ${root.qualifiedName.replace(/^module\./, 'module ')}`
    return `Terraform in ${section.key.replace(/^dir:/, '') || 'the repo root'}`
  }
  if (root === null) return `Separate changes in ${section.key.replace(/^file:.*\//, '').replace(/^file:/, '')}`
  const top = section.entries[0] === undefined ? undefined : story.byId.get(section.entries[0].symbolId)
  if (top !== undefined) return `${root.name} enters through ${top.qualifiedName}`
  const step = lead(story, section)
  if (step !== null && hooksIn(story, root)) return `${step.name} enters through ${root.qualifiedName}`
  if (root.change === 'deleted') return `Removes ${root.qualifiedName}`
  if (root.change === 'modified') return `Changes to ${root.qualifiedName}`
  return step === null ? `New ${root.qualifiedName}` : `New ${root.qualifiedName} and what it calls`
}

function summaryFor(story: Story, section: Section): string {
  const full = cardsOf(section).filter((item) => item.seeChapterId === null)
  const symbolsOf = (role: CardRole) =>
    full.filter((item) => item.role === role).map((item) => story.byId.get(item.symbolId)).filter((s): s is CodeSymbol => s !== undefined)
  if (section.kind === 'tests') {
    const names = symbolsOf('test').filter((s) => s.kind === 'test').map((s) => s.qualifiedName)
    return `Tests that reference nothing else in this story: ${joinWords(names)}.`
  }
  const root = section.root
  const step = lead(story, section)
  const leads = root !== null && section.entries.length === 0 && step !== null && hooksIn(story, root)
  const subject = (leads ? step : root) ?? story.byId.get(full[0]?.symbolId ?? '')
  const sentences: string[] = []
  if (subject !== undefined && subject !== null) {
    const callees = subject.calls
      .filter((id) => id !== subject.id && full.some((item) => item.symbolId === id && item.role !== 'data'))
      .map((id) => story.byId.get(id)?.name ?? id)
    const calls = callees.length > 0 ? ` and calls ${joinWords(callees)}` : ''
    sentences.push(`${subject.qualifiedName} ${CHANGE_WORD[subject.change]}${calls}`)
  }
  const counts: string[] = []
  const helpers = symbolsOf('helper').length
  const data = symbolsOf('data').filter((s) => DATA_KINDS.includes(s.kind)).length
  const tests = symbolsOf('test').filter((s) => s.kind === 'test').length
  if (helpers > 0) counts.push(plural(helpers, 'helper'))
  if (data > 0) counts.push(plural(data, 'data type'))
  if (tests > 0) counts.push(plural(tests, 'test'))
  const head = sentences.join('')
  if (counts.length === 0) return `${head}.`
  return head === '' ? `${counts.join(', ')}.` : `${head}; ${counts.join(', ')}.`
}

function chapterFiles(story: Story, cards: StoryCard[]): string[] {
  const files: string[] = []
  for (const item of cards) {
    const path = item.seeChapterId === null ? story.byId.get(item.symbolId)?.path : undefined
    if (path !== undefined && !files.includes(path)) files.push(path)
  }
  return files
}

export function storyFlow(chapters: Chapter[], symbols: Record<string, CodeSymbol>): Flow {
  const nodes: FlowNode[] = []
  for (const chapter of chapters) {
    for (const item of chapter.cards) {
      const symbol = symbols[item.symbolId]
      if (symbol === undefined || item.seeChapterId !== null || (item.role !== 'entry' && item.role !== 'step')) continue
      const change = symbol.change
      if (change === 'deleted' || nodes.some((node) => node.id === symbol.id)) continue
      nodes.push({
        id: symbol.id,
        label: symbol.qualifiedName,
        file: symbol.path,
        change,
        chapterId: chapter.id,
        symbolId: symbol.id
      })
    }
  }
  const edges: FlowEdge[] = []
  for (const node of nodes) {
    for (const id of symbols[node.id]?.calls ?? []) {
      if (id !== node.id && nodes.some((other) => other.id === id)) edges.push({ from: node.id, to: id })
    }
  }
  const first = nodes[0]
  return { caption: first ? `How the change flows, starting from ${first.label}` : 'No code changes to trace', nodes, edges }
}

export function fileLevelDrafts(detail: PullDetail, storyPaths: Set<string>): { title: string; summary: string; files: string[] }[] {
  const leftovers = reviewFiles(detail.files.filter((file) => !storyPaths.has(file.path)))
  return leftovers.length === 0 ? [] : planChapters(leftovers, declsByPath(leftovers))
}

export function buildStoryGuide(detail: PullDetail, index: CodeIndex): Guide {
  if (!index.symbols.some((symbol) => symbol.change !== 'context')) return buildHeuristicGuide(detail)
  const story = new Story(index.symbols)
  story.buildConnected()
  story.buildTerraform()
  story.buildLoose()
  story.attach()

  const ids = new Map<string, string>()
  story.sections.forEach((section, i) => ids.set(section.key, `ch-${i + 1}`))
  const chapters: Chapter[] = story.sections.map((section, i) => {
    const cards = cardsOf(section).map((item) =>
      item.seeChapterId === null ? item : { ...item, seeChapterId: ids.get(item.seeChapterId) ?? null }
    )
    return { id: `ch-${i + 1}`, title: titleFor(story, section), summary: summaryFor(story, section), files: chapterFiles(story, cards), cards }
  })

  const storyPaths = new Set<string>()
  for (const symbol of index.symbols) if (symbol.change !== 'context') storyPaths.add(symbol.path)
  const leftovers = numberChapters(fileLevelDrafts(detail, storyPaths)).map((chapter, i) => ({ ...chapter, id: `ch-${chapters.length + i + 1}` }))
  const all = [...chapters, ...leftovers]
  const symbols = Object.fromEntries(index.symbols.map((symbol) => [symbol.id, symbol]))
  return {
    source: 'heuristic',
    headSha: detail.head.sha,
    overview: overviewFor(detail, all, symbols),
    flow: storyFlow(chapters, symbols),
    chapters: all,
    symbols
  }
}
