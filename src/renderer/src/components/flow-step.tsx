import { useLayoutEffect, useRef, useState, type MouseEvent } from 'react'
import { Check, Maximize2, Workflow } from 'lucide-react'
import type { FlowNode } from '@shared/types'
import { DiffStat } from '@/components/diff-stat'
import { chapterFiles } from '@/components/chapter-step'
import { DashedFrame, PaneHeader } from '@/components/pane'
import { pad2 } from '@/lib/paths'
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
            <DashedFrame
              label={
                <span className="flex flex-wrap items-center justify-between gap-x-6">
                  <span>{`F L O W   nodes: ${flow.nodes.length}`}</span>
                  <span className="tracking-normal">
                    <span className="text-added">+ added</span>
                    <span className="ml-4 text-modified">~ modified</span>
                    <span className="ml-4">· existing</span>
                  </span>
                </span>
              }
            >
              <div className="px-7 py-9">
                <Serpentine nodes={flow.nodes} />
              </div>
            </DashedFrame>
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
  const edges = new Set(session.guide.flow.edges.map((edge) => `${edge.from}>${edge.to}`))
  const linked = (a: FlowNode, b: FlowNode) => edges.has(`${a.id}>${b.id}`) || edges.has(`${b.id}>${a.id}`)

  const rows: FlowNode[][] = []
  for (let i = 0; i < nodes.length; i += columns) rows.push(nodes.slice(i, i + columns))
  const grid = { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, columnGap: GAP_X }

  return (
    <div ref={ref} role="list" aria-label="Flow">
      {rows.map((row, r) => {
        const reversed = r % 2 === 1
        const next = rows[r + 1]
        const last = row[row.length - 1]
        return (
          <div key={r}>
            <div className="grid" style={grid}>
              {row.map((node, i) => {
                const following = row[i + 1]
                return (
                  <div
                    key={node.id}
                    role="listitem"
                    className="relative"
                    style={{ gridColumn: reversed ? columns - i : i + 1, gridRow: 1 }}
                  >
                    <FlowPill node={node} />
                    {following && <Arrow direction={reversed ? 'left' : 'right'} solid={linked(node, following)} />}
                  </div>
                )
              })}
            </div>
            {next && last && (
              <div className="grid h-8" style={grid}>
                <div className="flex justify-center" style={{ gridColumn: reversed ? 1 : columns }}>
                  <Arrow direction="down" solid={next[0] ? linked(last, next[0]) : false} />
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function Arrow({ direction, solid }: { direction: 'left' | 'right' | 'down'; solid: boolean }) {
  const stroke = { strokeDasharray: solid ? undefined : '3 3' }
  if (direction === 'down') {
    return (
      <svg aria-hidden width="10" height="32" className="text-frame">
        <line x1="5" y1="2" x2="5" y2="27" stroke="currentColor" style={stroke} />
        <path d="M1.5 24 L5 29 L8.5 24" fill="none" stroke="currentColor" />
      </svg>
    )
  }
  const left = direction === 'left'
  return (
    <svg
      aria-hidden
      width={GAP_X}
      height="10"
      className={cn('absolute top-1/2 -translate-y-1/2 text-frame', left ? 'right-full' : 'left-full')}
    >
      <line x1={left ? 7 : 4} y1="5" x2={left ? GAP_X - 4 : GAP_X - 7} y2="5" stroke="currentColor" style={stroke} />
      <path
        d={left ? 'M8 1.5 L3 5 L8 8.5' : `M${GAP_X - 8} 1.5 L${GAP_X - 3} 5 L${GAP_X - 8} 8.5`}
        fill="none"
        stroke="currentColor"
      />
    </svg>
  )
}

function FlowPill({ node }: { node: FlowNode }) {
  const { session, dispatch } = useReview()
  const tone = TONE[node.change]
  const chapterIndex = session.guide.chapters.findIndex((chapter) => chapter.id === node.chapterId)
  const hasChapter = chapterIndex !== -1

  function openFile() {
    if (node.file) dispatch({ type: 'ide/open', path: node.file })
  }

  function onClick(event: MouseEvent) {
    if ((event.metaKey || event.ctrlKey || event.altKey || !hasChapter) && node.file) openFile()
    else if (hasChapter) dispatch({ type: 'step/go', index: chapterIndex + 2 })
  }

  const clickable = hasChapter || node.file !== null
  const hint = [node.file, hasChapter ? `Chapter ${pad2(chapterIndex + 1)}` : null, node.file && hasChapter ? '⌘-click to open the file' : null]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="group/pill relative">
      <button
        type="button"
        onClick={onClick}
        disabled={!clickable}
        title={hint || node.label}
        aria-label={node.label}
        className={cn(
          'flex h-8 w-full items-center gap-2 rounded-[7px] border border-pane-border bg-card px-2.5 text-left font-mono text-[12px] transition-colors disabled:cursor-default',
          tone.pill,
          clickable && 'hover:border-frame hover:bg-accent'
        )}
      >
        <span aria-hidden className="font-semibold">{tone.sign}</span>
        <span className="truncate">{node.label}</span>
      </button>
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
      {node.file && (
        <button
          type="button"
          aria-label={`Open ${node.file} in IDE`}
          title="Open in IDE"
          onClick={openFile}
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
