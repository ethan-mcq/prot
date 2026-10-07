import { useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { Check, Maximize2, Workflow } from 'lucide-react'
import { locateFlowNode } from '@shared/guide'
import type { FlowEdge, FlowNode } from '@shared/types'
import { DiffStat } from '@/components/diff-stat'
import { chapterFiles } from '@/components/chapter-step'
import { DashedFrame, PaneHeader } from '@/components/pane'
import { pad2, splitPath } from '@/lib/paths'
import { useReview } from '@/lib/review-context'
import { chapterReviewKeys, isReviewed } from '@/lib/review-session'
import { cn } from '@/lib/utils'

const PILL_MIN = 176
const GAP_X = 40

export function FlowStep() {
  const { detail, session } = useReview()
  const { flow } = session.guide
  const { ref } = detail.summary
  return (
    <div className="pane flex h-full flex-col">
      <PaneHeader icon={<Workflow />} title="Flow" detail={`${ref.repo}#${ref.number}`} />
      <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-5 pt-2 pb-6 font-mono text-[12.5px] leading-[1.7]">
        <div className="max-w-[1100px] space-y-6">
          <div className="space-y-2">
            <h2 className="text-[16px] font-semibold text-foreground">Flow</h2>
            {flow.caption && <p className="max-w-[720px] font-copy text-[13px] leading-[1.75] text-foreground/85">{flow.caption}</p>}
          </div>
          {flow.nodes.length > 0 ? (
            <div className="space-y-3">
              <DashedFrame label={`F L O W   nodes: ${flow.nodes.length}`}>
                <div className="px-7 py-9">
                  <Serpentine nodes={flow.nodes} />
                </div>
              </DashedFrame>
              <p className="text-[11.5px] whitespace-pre-wrap text-muted-foreground">
                <span className="text-added">+ added</span>
                {'  '}
                <span className="text-modified">~ modified</span>
                {'  · existing   → calls   hover a node to see its links   click to jump to its line'}
              </p>
            </div>
          ) : (
            <p className="max-w-[720px] font-copy text-[13px] leading-[1.75] text-muted-foreground">
              This guide has no call flow to draw, usually because the change is configuration, docs or a set of
              independent edits. Read it chapter by chapter instead.
            </p>
          )}
          <ChapterList />
        </div>
      </div>
    </div>
  )
}

const TONE = {
  added: { pill: 'text-added', sign: '+' },
  modified: { pill: 'text-modified', sign: '~' },
  context: { pill: 'text-muted-foreground', sign: '·' }
} as const

type Links = { calls: Map<string, string[]>; calledBy: Map<string, string[]> }

function linksOf(edges: FlowEdge[]): Links {
  const calls = new Map<string, string[]>()
  const calledBy = new Map<string, string[]>()
  for (const edge of edges) {
    calls.set(edge.from, [...(calls.get(edge.from) ?? []), edge.to])
    calledBy.set(edge.to, [...(calledBy.get(edge.to) ?? []), edge.from])
  }
  return { calls, calledBy }
}

type Relation = 'callee' | 'caller' | 'dim' | null

function relationTo(hovered: string | null, node: FlowNode, links: Links): Relation {
  if (hovered === null || hovered === node.id) return null
  if (links.calls.get(hovered)?.includes(node.id)) return 'callee'
  if (links.calledBy.get(hovered)?.includes(node.id)) return 'caller'
  return 'dim'
}

function useColumns(count: number) {
  const ref = useRef<HTMLDivElement>(null)
  const [columns, setColumns] = useState(1)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? 0
      const fit = Math.floor((width + GAP_X) / (PILL_MIN + GAP_X))
      setColumns(Math.max(1, Math.min(count, fit)))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [count])
  return { ref, columns }
}

function Serpentine({ nodes }: { nodes: FlowNode[] }) {
  const { session } = useReview()
  const { ref, columns } = useColumns(nodes.length)
  const [hovered, setHovered] = useState<string | null>(null)
  const links = useMemo(() => linksOf(session.guide.flow.edges), [session.guide.flow.edges])
  const labels = new Map(nodes.map((node) => [node.id, node.label]))
  const calls = (from: FlowNode, to: FlowNode) => links.calls.get(from.id)?.includes(to.id) ?? false

  const rows: FlowNode[][] = []
  for (let i = 0; i < nodes.length; i += columns) rows.push(nodes.slice(i, i + columns))
  const grid = { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, columnGap: GAP_X }

  return (
    <div ref={ref} role="list" aria-label="Flow">
      {rows.map((row, r) => {
        const reversed = r % 2 === 1
        const next = rows[r + 1]?.[0]
        const last = row[row.length - 1]
        return (
          <div key={r}>
            <div className="grid" style={grid}>
              {row.map((node, i) => {
                const following = row[i + 1]
                const forward = following !== undefined && calls(node, following)
                const backward = following !== undefined && !forward && calls(following, node)
                const side = reversed ? 'left' : 'right'
                return (
                  <div
                    key={node.id}
                    role="listitem"
                    className="relative"
                    style={{ gridColumn: reversed ? columns - i : i + 1, gridRow: 1 }}
                    onMouseEnter={() => setHovered(node.id)}
                    onMouseLeave={() => setHovered(null)}
                    onFocus={() => setHovered(node.id)}
                    onBlur={() => setHovered(null)}
                  >
                    <FlowPill
                      node={node}
                      relation={relationTo(hovered, node, links)}
                      calls={(links.calls.get(node.id) ?? []).map((id) => labels.get(id) ?? id)}
                      calledBy={(links.calledBy.get(node.id) ?? []).map((id) => labels.get(id) ?? id)}
                    />
                    {(forward || backward) && (
                      <Arrow at={side} direction={forward ? side : side === 'left' ? 'right' : 'left'} />
                    )}
                  </div>
                )
              })}
            </div>
            {next && last && (
              <div className="grid h-8" style={grid}>
                <div className="flex justify-center" style={{ gridColumn: reversed ? 1 : columns }}>
                  {calls(last, next) && <Arrow direction="down" />}
                  {!calls(last, next) && calls(next, last) && <Arrow direction="up" />}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

type Direction = 'left' | 'right' | 'up' | 'down'

function Arrow({ direction, at }: { direction: Direction; at?: 'left' | 'right' }) {
  if (direction === 'down' || direction === 'up') {
    const head = direction === 'down' ? 'M1.5 24 L5 29 L8.5 24' : 'M1.5 8 L5 3 L8.5 8'
    return (
      <svg aria-hidden width="10" height="32" className="text-frame">
        <line x1="5" y1={direction === 'down' ? 2 : 5} x2="5" y2={direction === 'down' ? 27 : 30} stroke="currentColor" />
        <path d={head} fill="none" stroke="currentColor" />
      </svg>
    )
  }
  const left = direction === 'left'
  return (
    <svg
      aria-hidden
      width={GAP_X}
      height="10"
      className={cn('absolute top-1/2 -translate-y-1/2 text-frame', at === 'left' ? 'right-full' : 'left-full')}
    >
      <line x1={left ? 7 : 4} y1="5" x2={left ? GAP_X - 4 : GAP_X - 7} y2="5" stroke="currentColor" />
      <path
        d={left ? 'M8 1.5 L3 5 L8 8.5' : `M${GAP_X - 8} 1.5 L${GAP_X - 3} 5 L${GAP_X - 8} 8.5`}
        fill="none"
        stroke="currentColor"
      />
    </svg>
  )
}

function FlowPill({
  node,
  relation,
  calls,
  calledBy
}: {
  node: FlowNode
  relation: Relation
  calls: string[]
  calledBy: string[]
}) {
  const { detail, session, dispatch } = useReview()
  const tone = TONE[node.change]
  const linked = relation === 'callee' || relation === 'caller'
  const at = useMemo(() => locateFlowNode(node, detail.files), [node, detail.files])
  const path = at?.path ?? node.file
  const chapterIndex = session.guide.chapters.findIndex((chapter) => chapter.id === node.chapterId)
  const hasChapter = chapterIndex !== -1
  const clickable = hasChapter || path !== null

  function jump(ide: boolean) {
    dispatch({ type: 'focus/node', node, at, ide })
  }

  const where = path === null ? null : `${splitPath(path).name}${at ? `:${at.line}` : ''}`
  const summary = [
    node.label,
    where,
    hasChapter ? `Chapter ${pad2(chapterIndex + 1)}` : null,
    hasChapter && path !== null ? '⌘-click opens in IDE' : null
  ]
  const hint = [summary.filter(Boolean).join(' · ')]
  if (calls.length > 0) hint.push(`calls ${calls.join(', ')}`)
  if (calledBy.length > 0) hint.push(`called by ${calledBy.join(', ')}`)

  return (
    <div className={cn('group/pill relative transition-opacity', relation === 'dim' && 'opacity-55')}>
      <button
        type="button"
        onClick={(event: MouseEvent) => jump(event.metaKey || event.ctrlKey || event.altKey)}
        disabled={!clickable}
        title={hint.join('\n')}
        aria-label={node.label}
        className={cn(
          'flex h-8 w-full items-center gap-2 rounded-[7px] border border-pane-border bg-card px-2.5 text-left font-mono text-[12px] transition-[color,background-color,border-color,box-shadow] disabled:cursor-default',
          tone.pill,
          clickable && 'hover:border-frame hover:bg-accent',
          linked && 'ring-1 ring-command/50'
        )}
      >
        <span aria-hidden className="font-semibold">{tone.sign}</span>
        <span className="truncate">{node.label}</span>
      </button>
      {linked && (
        <span
          aria-hidden
          className="absolute -top-2 left-2 rounded-[4px] bg-card px-1 font-mono text-[9.5px] leading-[14px] text-command"
        >
          {relation}
        </span>
      )}
      {hasChapter && (
        <button
          type="button"
          aria-label={`Go to chapter ${chapterIndex + 1}`}
          onClick={() => dispatch({ type: 'step/go', index: chapterIndex + 2 })}
          className="absolute -top-2 -right-2 rounded-[4px] border border-pane-border bg-card px-1 font-mono text-[10px] leading-[14px] text-muted-foreground transition-colors hover:border-frame hover:text-foreground"
        >
          {pad2(chapterIndex + 1)}
        </button>
      )}
      {path !== null && (
        <button
          type="button"
          aria-label={`Open ${path} in IDE`}
          title="Open in IDE"
          onClick={() => jump(true)}
          className="absolute -right-2 -bottom-2 flex size-5 items-center justify-center rounded-[4px] border border-pane-border bg-card text-muted-foreground opacity-0 transition-opacity group-hover/pill:opacity-100 hover:text-foreground focus-visible:opacity-100"
        >
          <Maximize2 className="size-2.5" />
        </button>
      )}
    </div>
  )
}

export function ChapterList() {
  const { detail, session, dispatch } = useReview()
  return (
    <section className="space-y-2">
      <h3 className="font-semibold">
        Chapters <span className="font-normal text-muted-foreground">{session.guide.chapters.length}</span>
      </h3>
      <ol>
        {session.guide.chapters.map((chapter, index) => {
          const files = chapterFiles(chapter, detail.files)
          const additions = files.reduce((sum, file) => sum + file.additions, 0)
          const deletions = files.reduce((sum, file) => sum + file.deletions, 0)
          const done = isReviewed(session, chapterReviewKeys(chapter))
          return (
            <li key={chapter.id}>
              <button
                type="button"
                onClick={() => dispatch({ type: 'step/go', index: index + 2 })}
                className="flex w-full gap-2.5 rounded-[6px] px-2 py-1 text-left transition-colors hover:bg-accent"
              >
                <span aria-hidden className="text-muted-foreground">•</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2.5">
                    <span className="text-muted-foreground tabular-nums">{pad2(index + 1)}</span>
                    <span className="min-w-0 truncate font-medium">{chapter.title}</span>
                    {done && <Check aria-label="Reviewed" className="size-3.5 shrink-0 text-added" strokeWidth={3} />}
                    <span className="flex-1" />
                    <span className="shrink-0 text-[11.5px] text-muted-foreground">
                      {files.length} {files.length === 1 ? 'file' : 'files'}
                    </span>
                    <DiffStat additions={additions} deletions={deletions} className="text-[11.5px]" />
                  </span>
                  <span className="flex gap-2 text-muted-foreground">
                    <span aria-hidden>└</span>
                    <span className="line-clamp-1">{chapter.summary}</span>
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
