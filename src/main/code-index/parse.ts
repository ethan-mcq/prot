import type Parser from 'web-tree-sitter'
import type { ParsedSymbol, ParsedVersion, Ref } from '@shared/code-index'
import type { SymbolKind } from '@shared/types'
import type { DeclRule, Grammar } from './languages'

type Node = Parser.SyntaxNode

type Context = { parent: number | null; qualifier: string | null; topLevel: boolean }

type Found = { symbol: ParsedSymbol; node: Node; nameNode: Node | null }

function follow(node: Node, path: string[]): Node | null {
  let current: Node | null = node
  for (const step of path) {
    if (current === null) return null
    let next: Node | null = null
    for (const option of step.split('|')) {
      next = current.childForFieldName(option) ?? current.namedChildren.find((child) => child.type === option) ?? null
      if (next !== null) break
    }
    current = next
  }
  return current
}

function nameLeaf(node: Node, grammar: Grammar): Node {
  if (node.namedChildCount === 0) return node
  for (const child of node.namedChildren) {
    const leaf = nameLeaf(child, grammar)
    if (grammar.nameTypes.includes(leaf.type)) return leaf
  }
  return node
}

function nameNode(node: Node, rule: DeclRule, grammar: Grammar): Node | null {
  const found = rule.name ? follow(node, rule.name) : (node.childForFieldName('name') ?? node.namedChildren.find((child) => grammar.nameTypes.includes(child.type)) ?? null)
  return found === null ? null : nameLeaf(found, grammar)
}

function kindOf(node: Node, rule: DeclRule): SymbolKind {
  for (const refine of rule.refine ?? []) {
    if (refine.keyword && node.children.some((child) => !child.isNamed && child.type === refine.keyword)) return refine.kind
    if (refine.child && node.namedChildren.some((child) => child.type === refine.child)) return refine.kind
    if (refine.value && refine.value.types.includes(follow(node, refine.value.path)?.type ?? '')) return refine.kind
  }
  return rule.kind
}

function decoratorName(node: Node): string {
  return node.text
    .replace(/^[@#!\s[]+/, '')
    .replace(/[\](\s].*$/s, '')
    .trim()
}

function decoratorsOf(nodes: Node[], grammar: Grammar): string[] {
  const names: string[] = []
  const visit = (node: Node, depth: number) => {
    if (grammar.decorators.includes(node.type)) {
      names.push(decoratorName(node))
      return
    }
    if (depth < 2) for (const child of node.namedChildren) visit(child, depth + 1)
  }
  for (const node of nodes) visit(node, 0)
  return names
}

function leadingSiblings(node: Node, grammar: Grammar): Node[] {
  const result: Node[] = []
  let start = node.startPosition.row
  let sibling = node.previousNamedSibling
  while (sibling !== null && grammar.leading.includes(sibling.type) && sibling.endPosition.row === start - 1) {
    result.unshift(sibling)
    start = sibling.startPosition.row
    sibling = sibling.previousNamedSibling
  }
  return result
}

function qualify(...parts: (string | null)[]): string | null {
  const kept = parts.filter((part): part is string => part !== null && part !== '')
  return kept.length === 0 ? null : kept.join('.')
}

function testKind(kind: SymbolKind, name: string, decorators: string[], grammar: Grammar): SymbolKind {
  if (kind !== 'function' && kind !== 'method') return kind
  if (grammar.tests.names?.test(name)) return 'test'
  if (grammar.tests.decorators && decorators.some((decorator) => grammar.tests.decorators?.test(decorator))) return 'test'
  return kind
}

class Walker {
  readonly found: Found[] = []

  constructor(private readonly grammar: Grammar) {}

  walk(container: Node, context: Context): void {
    for (const child of container.namedChildren) this.visit(child, context)
  }

  private visit(node: Node, context: Context): void {
    const { grammar } = this
    const special = grammar.special[node.type]?.(node)
    if (special) {
      const index = this.add(node, node, null, special.name, special.kind, special.decorators, context)
      if (special.body !== null) this.walk(special.body, { parent: index, qualifier: this.qualifiedAt(index), topLevel: false })
      return
    }
    if (grammar.wrappers.includes(node.type)) {
      for (const inner of node.namedChildren) {
        if (grammar.decls[inner.type]) this.declare(inner, node, context)
      }
      return
    }
    if (grammar.decls[node.type]) {
      this.declare(node, null, context)
      return
    }
    const scope = grammar.scopes[node.type]
    if (scope !== undefined) {
      const qualifier = scope === null ? context.qualifier : qualify(context.qualifier, follow(node, scope)?.text ?? null)
      this.walk(node, { ...context, qualifier, topLevel: false })
      return
    }
    if (!context.topLevel && grammar.bodies.includes(node.type)) this.walk(node, context)
  }

  private declare(node: Node, wrapper: Node | null, context: Context): void {
    const rule = this.grammar.decls[node.type]
    if (!rule) return
    if (rule.topLevel && !context.topLevel) return
    if (rule.requires && !rule.requires.types.includes(follow(node, rule.requires.path)?.type ?? '')) return
    const named = nameNode(node, rule, this.grammar)
    if (named === null) return
    let kind = kindOf(node, rule)
    if (kind === 'function' && context.parent !== null) kind = 'method'
    const outer = wrapper ?? node
    const decorators = decoratorsOf([outer, ...leadingSiblings(outer, this.grammar)], this.grammar)
    const receiver = rule.qualifier ? (follow(node, rule.qualifier)?.text.replace(/^[*&]+|\[.*$/g, '') ?? null) : null
    const qualifier = qualify(context.qualifier, receiver)
    const index = this.add(node, outer, named, named.text, testKind(kind, named.text, decorators, this.grammar), decorators, {
      ...context,
      qualifier
    })
    if (rule.members) this.walk(node, { parent: index, qualifier: this.qualifiedAt(index), topLevel: false })
  }

  private qualifiedAt(index: number): string | null {
    return this.found[index]?.symbol.qualifiedName ?? null
  }

  private add(
    node: Node,
    outer: Node,
    named: Node | null,
    name: string,
    kind: SymbolKind,
    decorators: string[],
    context: Context
  ): number {
    const leading = leadingSiblings(outer, this.grammar)
    const start = (leading[0] ?? outer).startPosition.row + 1
    const qualifier = kind === 'test' && context.qualifier !== null ? `${context.qualifier} ›` : context.qualifier
    this.found.push({
      node: outer,
      nameNode: named,
      symbol: {
        name,
        qualifiedName: kind === 'test' && qualifier !== null ? `${qualifier} ${name}` : (qualify(qualifier, name) ?? name),
        kind,
        parent: context.parent,
        range: { start, end: node.endPosition.row + 1 },
        refs: [],
        decorators,
        aliases: []
      }
    })
    return this.found.length - 1
  }
}

function collectRefs(root: Node, found: Found[], grammar: Grammar): Ref[] {
  const owners = new Map<number, ParsedSymbol>()
  const names = new Set<number>()
  for (const entry of found) {
    owners.set(entry.node.id, entry.symbol)
    if (entry.nameNode) names.add(entry.nameNode.id)
  }
  const moduleRefs: Ref[] = []
  const visit = (node: Node, owner: ParsedSymbol | null) => {
    const current = owners.get(node.id) ?? owner
    const role = grammar.refs[node.type]
    if (role && node.namedChildCount === 0 && !names.has(node.id)) {
      const member = role === 'member' || (node.parent !== null && grammar.memberParents.includes(node.parent.type))
      const ref: Ref = { kind: 'name', name: node.text, line: node.startPosition.row + 1, member }
      ;(current ? current.refs : moduleRefs).push(ref)
      return
    }
    for (const child of node.namedChildren) visit(child, current)
  }
  visit(root, null)
  return moduleRefs
}

export function isBlank(line: string | undefined): boolean {
  return line !== undefined && line.trim() === ''
}

// Blank lines after a symbol belong to it, so whitespace between declarations never forms a module block.
export function absorbBlankLines(symbols: ParsedSymbol[], lines: string[]): void {
  for (const symbol of symbols) {
    const parent = symbol.parent === null ? undefined : symbols[symbol.parent]
    const limit = parent ? parent.range.end - 1 : lines.length - (lines[lines.length - 1] === '' ? 1 : 0)
    let end = symbol.range.end
    while (end < limit && isBlank(lines[end])) end += 1
    symbol.range = { start: symbol.range.start, end }
  }
}

export function parseSource(parser: Parser, grammar: Grammar, source: string): ParsedVersion {
  const tree = parser.parse(source)
  try {
    const walker = new Walker(grammar)
    walker.walk(tree.rootNode, { parent: null, qualifier: null, topLevel: true })
    const moduleRefs = collectRefs(tree.rootNode, walker.found, grammar)
    const symbols = walker.found.map((entry) => entry.symbol)
    absorbBlankLines(symbols, source.split('\n'))
    return { symbols, moduleRefs }
  } finally {
    tree.delete()
  }
}
