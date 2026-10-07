import type { Chapter, FileRole, Flow, FlowEdge, FlowNode } from '../types'
import { baseName, dirSegments, type ReviewFile } from './files'
import { symbolLabel, type Decl } from './symbols'

const MAX_NODES = 8
const MAX_CONTEXT = 3
const FLOW_ROLES: FileRole[] = ['core', 'ui']

type Node = { id: string; decl: Decl; order: number }

export function chapterIndex(chapters: Chapter[]): Map<string, string> {
  const index = new Map<string, string>()
  for (const chapter of chapters) {
    for (const path of chapter.files) index.set(path, chapter.id)
  }
  return index
}

function resolveTarget(source: Node, candidates: Node[]): Node | null {
  let best: Node | null = null
  let bestScore = -1
  for (const candidate of candidates) {
    if (candidate === source) continue
    let score = 0
    if (candidate.decl.path === source.decl.path) score = 2
    else if (candidate.decl.family === source.decl.family) score = 1
    if (score > bestScore) {
      best = candidate
      bestScore = score
    }
  }
  return best
}

function toFlowNode(node: Node, chapterOf: Map<string, string>): FlowNode {
  return {
    id: node.id,
    label: symbolLabel(node.decl),
    file: node.decl.path,
    change: node.decl.change,
    chapterId: chapterOf.get(node.decl.path) ?? null
  }
}

function byOrder(a: Node, b: Node): number {
  return a.order - b.order
}

function acyclic(nodes: Node[], edges: Map<Node, Node[]>): Map<Node, Node[]> {
  const state = new Map<Node, 'active' | 'done'>()
  const dag = new Map<Node, Node[]>()
  const visit = (node: Node): void => {
    state.set(node, 'active')
    const kept: Node[] = []
    for (const child of edges.get(node) ?? []) {
      const seen = state.get(child)
      if (seen === 'active') continue
      kept.push(child)
      if (seen === undefined) visit(child)
    }
    dag.set(node, kept)
    state.set(node, 'done')
  }
  for (const node of nodes) {
    if (!state.has(node)) visit(node)
  }
  return dag
}

function longestPath(nodes: Node[], dag: Map<Node, Node[]>): Node[] {
  const depth = new Map<Node, number>()
  const next = new Map<Node, Node>()
  const measure = (node: Node): number => {
    const known = depth.get(node)
    if (known !== undefined) return known
    let length = 1
    for (const child of dag.get(node) ?? []) {
      const through = 1 + measure(child)
      if (through > length) {
        length = through
        next.set(node, child)
      }
    }
    depth.set(node, length)
    return length
  }
  let start: Node | null = null
  for (const node of nodes) {
    if (start === null || measure(node) > measure(start)) start = node
  }
  const path: Node[] = []
  let cursor: Node | undefined = start ?? undefined
  while (cursor !== undefined && path.length < MAX_NODES) {
    path.push(cursor)
    cursor = next.get(cursor)
  }
  return path
}

function selectNodes(nodes: Node[], dag: Map<Node, Node[]>, mainPath: Node[]): Set<Node> {
  if (nodes.length <= MAX_NODES) return new Set(nodes)
  const neighbors = new Map<Node, Node[]>()
  for (const node of nodes) neighbors.set(node, [])
  for (const [from, children] of dag) {
    for (const to of children) {
      neighbors.get(from)?.push(to)
      neighbors.get(to)?.push(from)
    }
  }
  const selected = new Set(mainPath)
  while (selected.size < MAX_NODES) {
    let pick: Node | null = null
    let pickAdjacent = false
    let pickDegree = -1
    for (const node of nodes) {
      if (selected.has(node)) continue
      const around = neighbors.get(node) ?? []
      let adjacent = false
      for (const other of around) {
        if (selected.has(other)) adjacent = true
      }
      const better =
        pick === null ||
        (adjacent && !pickAdjacent) ||
        (adjacent === pickAdjacent && around.length > pickDegree)
      if (better) {
        pick = node
        pickAdjacent = adjacent
        pickDegree = around.length
      }
    }
    if (pick === null) break
    selected.add(pick)
  }
  return selected
}

function topological(selected: Set<Node>, dag: Map<Node, Node[]>, mainPath: Node[]): Node[] {
  const priority = (node: Node): number => (mainPath.includes(node) ? 0 : 1)
  const indegree = new Map<Node, number>()
  for (const node of selected) indegree.set(node, 0)
  for (const node of selected) {
    for (const child of dag.get(node) ?? []) {
      if (selected.has(child)) indegree.set(child, (indegree.get(child) ?? 0) + 1)
    }
  }
  const ready: Node[] = []
  for (const node of selected) {
    if (indegree.get(node) === 0) ready.push(node)
  }
  const ordered: Node[] = []
  while (ready.length > 0) {
    ready.sort((a, b) => priority(a) - priority(b) || a.order - b.order)
    const node = ready.shift()
    if (node === undefined) break
    ordered.push(node)
    for (const child of dag.get(node) ?? []) {
      if (!selected.has(child)) continue
      const left = (indegree.get(child) ?? 0) - 1
      indegree.set(child, left)
      if (left === 0) ready.push(child)
    }
  }
  return ordered
}

function caption(entry: string | undefined): string {
  if (entry === undefined) return 'How the new code connects'
  return `How the new code connects, starting from ${entry}`
}

export function buildFlow(files: ReviewFile[], decls: Map<string, Decl[]>, chapterOf: Map<string, string>): Flow {
  const changed: Node[] = []
  const existing: Node[] = []
  let order = 0
  for (const file of files) {
    if (!FLOW_ROLES.includes(file.role)) continue
    for (const decl of decls.get(file.path) ?? []) {
      const node: Node = { id: `${decl.path}#${decl.name}`, decl, order }
      order += 1
      if (decl.change === 'context') existing.push(node)
      else changed.push(node)
    }
  }
  if (changed.length === 0) return fileFlow(files, chapterOf)

  const changedByName = new Map<string, Node[]>()
  for (const node of changed) {
    const list = changedByName.get(node.decl.name) ?? []
    list.push(node)
    changedByName.set(node.decl.name, list)
  }
  const contextByName = new Map<string, Node[]>()
  for (const node of existing) {
    if (changedByName.has(node.decl.name)) continue
    const list = contextByName.get(node.decl.name) ?? []
    list.push(node)
    contextByName.set(node.decl.name, list)
  }

  const edges = new Map<Node, Node[]>()
  const contextHits = new Map<Node, number>()
  for (const node of changed) {
    const targets: Node[] = []
    for (const ref of node.decl.refs) {
      const candidates = changedByName.get(ref) ?? contextByName.get(ref) ?? []
      const target = resolveTarget(node, candidates)
      if (target === null || targets.includes(target)) continue
      targets.push(target)
      if (target.decl.change === 'context') contextHits.set(target, (contextHits.get(target) ?? 0) + 1)
    }
    edges.set(node, targets)
  }

  const keptContext = [...contextHits.keys()]
    .sort((a, b) => (contextHits.get(b) ?? 0) - (contextHits.get(a) ?? 0) || a.order - b.order)
    .slice(0, MAX_CONTEXT)
  const all = [...changed, ...keptContext].sort(byOrder)
  const linked = new Set<Node>()
  for (const [from, targets] of edges) {
    const kept: Node[] = []
    for (const to of targets) {
      if (to.decl.change === 'context' && !keptContext.includes(to)) continue
      kept.push(to)
      linked.add(from)
      linked.add(to)
    }
    edges.set(from, kept)
  }

  if (linked.size === 0) {
    const nodes: FlowNode[] = []
    for (const node of changed.slice(0, MAX_NODES)) nodes.push(toFlowNode(node, chapterOf))
    let entry = nodes[0]
    for (const node of nodes) {
      if (node.change === 'added') {
        entry = node
        break
      }
    }
    return { caption: caption(entry?.label), nodes, edges: [] }
  }

  const connected: Node[] = []
  for (const node of all) {
    if (linked.has(node)) connected.push(node)
  }
  const dag = acyclic(connected, edges)
  const mainPath = longestPath(connected, dag)
  const ordered = topological(selectNodes(connected, dag, mainPath), dag, mainPath)
  const included = new Set(ordered)
  const nodes: FlowNode[] = []
  const flowEdges: FlowEdge[] = []
  for (const node of ordered) {
    nodes.push(toFlowNode(node, chapterOf))
    for (const child of dag.get(node) ?? []) {
      if (included.has(child)) flowEdges.push({ from: node.id, to: child.id })
    }
  }
  const entry = mainPath[0]
  return { caption: caption(entry === undefined ? undefined : symbolLabel(entry.decl)), nodes, edges: flowEdges }
}

const JS_IMPORTS = [
  /\bfrom\s+['"](\.{1,2}\/[^'"]+)['"]/g,
  /\bimport\s+['"](\.{1,2}\/[^'"]+)['"]/g,
  /\brequire\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g,
  /\bimport\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g
]
const PY_IMPORT = /^\s*from\s+(\.+)([\w.]*)\s+import\s+(\w+)/
const JS_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.vue', '.svelte']

function normalize(segments: string[]): string {
  const out: string[] = []
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') out.pop()
    else out.push(segment)
  }
  return out.join('/')
}

function jsCandidates(from: string, spec: string): string[] {
  const base = normalize([...dirSegments(from), ...spec.split('/')])
  const stems = [base]
  const compiled = /\.(js|jsx|mjs|cjs)$/.exec(base)
  if (compiled !== null) stems.push(base.slice(0, compiled.index))
  const candidates: string[] = [base]
  for (const stemPath of stems) {
    for (const extension of JS_EXTENSIONS) {
      candidates.push(stemPath + extension)
      candidates.push(`${stemPath}/index${extension}`)
    }
  }
  return candidates
}

function pyCandidates(from: string, dots: string, module: string, name: string): string[] {
  const dir = dirSegments(from)
  const up = dots.length - 1
  const base = dir.slice(0, Math.max(0, dir.length - up))
  const parts = module === '' ? [name] : module.split('.')
  const path = normalize([...base, ...parts])
  return [`${path}.py`, `${path}/__init__.py`]
}

function importedPaths(file: ReviewFile, paths: Set<string>): string[] {
  const found: string[] = []
  const add = (candidates: string[]): void => {
    for (const candidate of candidates) {
      if (paths.has(candidate) && candidate !== file.path && !found.includes(candidate)) {
        found.push(candidate)
        return
      }
    }
  }
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.kind === 'del') continue
      for (const pattern of JS_IMPORTS) {
        for (const match of line.text.matchAll(pattern)) {
          const spec = match[1]
          if (spec !== undefined) add(jsCandidates(file.path, spec))
        }
      }
      const py = PY_IMPORT.exec(line.text)
      if (py !== null) add(pyCandidates(file.path, py[1] ?? '.', py[2] ?? '', py[3] ?? ''))
    }
  }
  return found
}

function fileFlow(files: ReviewFile[], chapterOf: Map<string, string>): Flow {
  const code: ReviewFile[] = []
  for (const file of files) {
    if (FLOW_ROLES.includes(file.role) && file.file.status !== 'removed') code.push(file)
  }
  code.sort((a, b) => b.churn - a.churn)
  const shown = code.slice(0, MAX_NODES)
  if (shown.length === 0) return { caption: 'No code changes to trace', nodes: [], edges: [] }

  const paths = new Set<string>()
  for (const file of shown) paths.add(file.path)
  const nodes: FlowNode[] = []
  const edges: FlowEdge[] = []
  for (const file of shown) {
    nodes.push({
      id: file.path,
      label: baseName(file.path),
      file: file.path,
      change: file.file.status === 'added' ? 'added' : 'modified',
      chapterId: chapterOf.get(file.path) ?? null
    })
    for (const target of importedPaths(file, paths)) edges.push({ from: file.path, to: target })
  }
  return { caption: 'How the changed files connect', nodes, edges }
}
