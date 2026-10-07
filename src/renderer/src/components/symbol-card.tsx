import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, CornerDownRight, Loader2, Maximize2 } from 'lucide-react'
import { parsePatch } from '@shared/diff'
import { locateSymbol } from '@shared/guide/locate'
import { excerptRows, focusRows, symbolRows, type SymbolRow } from '@shared/symbol-rows'
import type { Chapter, CodeChange, CodeSymbol, StoryCard, SymbolKind } from '@shared/types'
import { Checkbox } from '@/components/ui/checkbox'
import { CommentableLine, useFocusScroll, useLineComments } from '@/components/diff-view'
import { PaneButton } from '@/components/pane'
import { SinceGuideTag } from '@/components/since-guide-tag'
import { languageFor } from '@/lib/highlight'
import { useHighlighted } from '@/lib/hooks'
import { fileLines, pad2 } from '@/lib/paths'
import { useReview } from '@/lib/review-context'
import { cardKey, isChangedSinceGuide, isReviewed, symbolFor, type ReviewSession } from '@/lib/review-session'
import { cn } from '@/lib/utils'

export const KIND_BADGE: Record<SymbolKind, string> = {
  function: 'fn',
  method: 'method',
  class: 'class',
  interface: 'iface',
  type: 'type',
  enum: 'enum',
  constant: 'const',
  test: 'test',
  module: 'module'
}

export const CHANGE_TAG: Record<CodeChange, { label: string; sign: string; className: string }> = {
  added: { label: 'Added', sign: '+', className: 'text-added' },
  modified: { label: 'Modified', sign: '~', className: 'text-modified' },
  deleted: { label: 'Deleted', sign: '−', className: 'text-removed' },
  context: { label: 'Context', sign: '·', className: 'text-muted-foreground' }
}

const LONG_BODY = 60
const SHOWN_WHEN_LONG = 40
const CHIP_LIMIT = 3

export function displayName(symbol: CodeSymbol): string {
  if (symbol.kind !== 'module') return symbol.qualifiedName
  return `${symbol.path.split('/').pop()} top level`
}

export function cardDomId(symbolId: string): string {
  return `card-${symbolId}`
}

export function KindBadge({ kind, className }: { kind: SymbolKind; className?: string }) {
  return (
    <span
      className={cn(
        'shrink-0 rounded-[4px] bg-foreground/[0.06] px-1 font-mono text-[10px] leading-[15px] text-muted-foreground dark:bg-foreground/10',
        className
      )}
    >
      {KIND_BADGE[kind]}
    </span>
  )
}

function lineCount(symbol: CodeSymbol): string {
  const range = symbol.head ?? symbol.base
  return range === null ? '' : `:${range.start}-${range.end}`
}

function within(symbol: CodeSymbol, line: number, side: 'LEFT' | 'RIGHT'): boolean {
  const range = side === 'RIGHT' ? symbol.head : symbol.base
  return range !== null && line >= range.start && line <= range.end
}

function allSymbols(session: ReviewSession): CodeSymbol[] {
  return Object.values({ ...session.guide.symbols, ...session.symbols })
}

export function useJumpToSymbol(): (symbolId: string) => void {
  const { detail, session, dispatch } = useReview()
  return (symbolId) => {
    const symbol = symbolFor(session, symbolId)
    if (symbol === undefined) return
    const symbols = { ...session.guide.symbols, ...session.symbols }
    const at = locateSymbol(symbol, symbols, detail.files)
    const node = { id: symbol.id, label: symbol.qualifiedName, file: symbol.path, change: 'context' as const, chapterId: null, symbolId: symbol.id }
    dispatch({ type: 'focus/node', node, at, ide: false })
  }
}

function Chips({ symbol, chapter }: { symbol: CodeSymbol; chapter: Chapter }) {
  const { session } = useReview()
  const jump = useJumpToSymbol()
  const carded = new Set(session.guide.chapters.flatMap((item) => item.cards.map((card) => card.symbolId)))
  const callers = allSymbols(session).filter((other) => other.id !== symbol.id && other.calls.includes(symbol.id) && carded.has(other.id))
  const callees = symbol.calls.map((id) => symbolFor(session, id)).filter((other): other is CodeSymbol => other !== undefined && carded.has(other.id))
  const inSection = (other: CodeSymbol) => chapter.cards.some((card) => card.symbolId === other.id && card.seeChapterId === null)
  const chip = (other: CodeSymbol, verb: string) => (
    <button
      key={`${verb}-${other.id}`}
      type="button"
      onClick={() => jump(other.id)}
      aria-label={`Go to ${other.qualifiedName}`}
      title={`${verb} ${other.qualifiedName}${inSection(other) ? '' : ' (another section)'}`}
      className="flex h-5 max-w-56 shrink-0 items-center gap-1 rounded-full border border-pane-border px-1.5 font-mono text-[10.5px] text-muted-foreground transition-colors hover:border-frame hover:text-foreground"
    >
      <span className="shrink-0 whitespace-nowrap text-muted-foreground/70">{verb}</span>
      <span className="truncate text-foreground/80">{other.name}</span>
    </button>
  )
  if (callers.length === 0 && callees.length === 0) return null
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1 px-3.5 pb-2">
      {callers.slice(0, CHIP_LIMIT).map((other) => chip(other, 'called by'))}
      {callers.length > CHIP_LIMIT && <span className="font-mono text-[10.5px] text-muted-foreground">+{callers.length - CHIP_LIMIT}</span>}
      {callees.slice(0, CHIP_LIMIT).map((other) => chip(other, 'calls'))}
      {callees.length > CHIP_LIMIT && <span className="font-mono text-[10.5px] text-muted-foreground">+{callees.length - CHIP_LIMIT}</span>}
    </div>
  )
}

export function SymbolCard({ card, chapter }: { card: StoryCard; chapter: Chapter }) {
  const { session, dispatch } = useReview()
  const symbol = symbolFor(session, card.symbolId)
  const key = cardKey(card.symbolId)
  const reviewed = isReviewed(session, [key])
  const focus = session.focus
  const focused = symbol !== undefined && focus !== null && focus.path === symbol.path && within(symbol, focus.line, focus.side)
  const [open, setOpen] = useState(!reviewed || focused)

  useEffect(() => {
    if (focused) setOpen(true)
  }, [focused, focus?.nonce])

  if (symbol === undefined) return null
  const tag = CHANGE_TAG[symbol.change]
  const entry = card.role === 'entry'

  function setReviewed(value: boolean) {
    dispatch({ type: 'reviewed/set', keys: [key], reviewed: value })
    setOpen(!value)
  }

  return (
    <section aria-label={displayName(symbol)} id={cardDomId(symbol.id)} className="pane scroll-mt-2 overflow-clip">
      <div className={cn('sticky top-0 z-10 bg-card', open && 'border-b border-pane-border')}>
        <header className="flex h-10 items-center gap-2 pr-2 pl-3.5">
          <KindBadge kind={symbol.kind} />
          <span className="min-w-0 truncate font-mono text-[12.5px] font-medium" title={symbol.qualifiedName}>
            {displayName(symbol)}
          </span>
          <span className="min-w-0 shrink truncate font-mono text-[11px] text-muted-foreground" title={symbol.path}>
            {symbol.path.split('/').pop()}
            {lineCount(symbol)}
          </span>
          <span className={cn('shrink-0 rounded-[4px] border border-current/25 px-1 font-mono text-[10px] leading-[15px]', tag.className)}>
            {tag.label}
          </span>
          {entry && (
            <span className="shrink-0 rounded-[4px] bg-command/12 px-1 font-mono text-[10px] leading-[15px] text-command">Entry</span>
          )}
          {card.excerpt !== null && (
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground" title="Only the lines that reach the story are shown">
              excerpt
            </span>
          )}
          {isChangedSinceGuide(session.drift, symbol.path) && <SinceGuideTag />}
          <span className="flex-1" />
          <label className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-[6px] px-1.5 py-1 font-mono text-[11.5px] text-muted-foreground transition-colors hover:bg-accent has-[[data-state=checked]]:text-added">
            <Checkbox
              checked={reviewed}
              onCheckedChange={(value) => setReviewed(value === true)}
              aria-label={`Reviewed ${symbol.qualifiedName}`}
              className="size-3.5"
            />
            Reviewed
          </label>
          <PaneButton
            aria-expanded={open}
            aria-label={`${open ? 'Collapse' : 'Expand'} ${symbol.qualifiedName}`}
            title={open ? 'Collapse' : 'Expand'}
            onClick={() => setOpen(!open)}
          >
            {open ? <ChevronUp /> : <ChevronDown />}
          </PaneButton>
          <PaneButton
            aria-label={`Open ${symbol.path} in IDE`}
            title="Open in IDE"
            onClick={() => dispatch({ type: 'ide/open', path: symbol.path })}
          >
            <Maximize2 />
          </PaneButton>
        </header>
        <Chips symbol={symbol} chapter={chapter} />
      </div>
      {open && <SymbolBody symbol={symbol} card={card} chapter={chapter} />}
    </section>
  )
}

function storyMarks(symbol: CodeSymbol, chapter: Chapter): Set<number> {
  const marks = new Set<number>()
  if (symbol.change !== 'context') return marks
  for (const card of chapter.cards) {
    for (const line of symbol.callLines[card.symbolId] ?? []) marks.add(line)
  }
  return marks
}

function rowKey(row: SymbolRow, index: number): string {
  if (row.kind === 'line') return `${row.line.kind}:${row.line.oldLine}:${row.line.newLine}`
  if (row.kind === 'fold') return `fold:${row.symbolId}`
  return `gap:${index}`
}

export function useSymbolRows(symbol: CodeSymbol, card: StoryCard, chapter: Chapter): { rows: SymbolRow[]; head: string[] | null; loading: boolean } {
  const { detail, session, loadFile } = useReview()
  const patch = detail.files.find((file) => file.path === symbol.path)?.patch ?? null
  const hunks = useMemo(() => (patch === null ? [] : parsePatch(patch)), [patch])
  const children = useMemo(() => allSymbols(session).filter((child) => child.parentId === symbol.id), [session, symbol.id])
  const needsHead = symbol.head !== null && (symbol.change === 'modified' || symbol.change === 'context' || children.length > 0)
  const [head, setHead] = useState<string[] | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!needsHead) return
    let live = true
    loadFile(symbol.path)
      .then((text) => live && setHead(fileLines(text)))
      .catch(() => live && setFailed(true))
    return () => {
      live = false
    }
  }, [needsHead, loadFile, symbol.path])
  const rows = useMemo(() => {
    const all = symbolRows(symbol, children, hunks, head, storyMarks(symbol, chapter))
    if (card.excerpt !== null) return excerptRows(all, card.excerpt)
    return symbol.change === 'added' || symbol.change === 'deleted' ? all : focusRows(all)
  }, [symbol, children, hunks, head, chapter, card.excerpt])
  return { rows, head, loading: needsHead && head === null && !failed }
}

function SymbolBody({ symbol, card, chapter }: { symbol: CodeSymbol; card: StoryCard; chapter: Chapter }) {
  const { session } = useReview()
  const { rows, head, loading } = useSymbolRows(symbol, card, chapter)
  const [expanded, setExpanded] = useState(false)
  const [openGaps, setOpenGaps] = useState<Set<SymbolRow>>(() => new Set())
  const lang = languageFor(symbol.path)
  const lineRows: Extract<SymbolRow, { kind: 'line' }>[] = []
  for (const row of rows) {
    const inner = row.kind === 'gap' ? row.rows : [row]
    for (const item of inner) if (item.kind === 'line') lineRows.push(item)
  }
  const tokens = useHighlighted(
    lineRows.map((row) => row.line.text),
    lang
  )
  const tokenIndex = new Map(lineRows.map((row, index) => [row, index]))
  const comments = useLineComments(symbol.path)
  const focusRow = useFocusScroll(symbol.path, !loading && (lang === null || lineRows.length === 0 || tokens !== null))
  const jump = useJumpToSymbol()

  if (loading) {
    return (
      <p className="flex items-center gap-2 px-4 py-3 font-mono text-[12px] text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> loading {symbol.path.split('/').pop()}
      </p>
    )
  }
  const visible: SymbolRow[] = []
  for (const row of rows) {
    if (row.kind === 'gap' && openGaps.has(row)) visible.push(...row.rows)
    else visible.push(row)
  }
  const long = visible.length > LONG_BODY && !expanded
  const shown = long ? visible.slice(0, SHOWN_WHEN_LONG) : visible
  return (
    <div className="py-1 font-mono text-[12px] leading-5">
      {shown.map((row, index) => {
        if (row.kind === 'line') {
          return (
            <CommentableLine
              key={rowKey(row, index)}
              path={symbol.path}
              line={row.line}
              tokens={tokens?.[tokenIndex.get(row) ?? -1]}
              comments={comments.byLine}
              focusRef={focusRow}
              marked={row.mark}
            />
          )
        }
        if (row.kind === 'gap') {
          return (
            <button
              key={rowKey(row, index)}
              type="button"
              onClick={() => setOpenGaps((open) => new Set(open).add(row))}
              className="flex w-full py-0.5 pr-4 pl-[86px] text-left text-muted-foreground transition-colors select-none hover:bg-accent hover:text-foreground"
            >
              ⋯ {row.lines} unmodified {row.lines === 1 ? 'line' : 'lines'}
            </button>
          )
        }
        const member = symbolFor(session, row.symbolId)
        const signature = (head?.[row.line - 1] ?? member?.qualifiedName ?? '').trim()
        const tag = member ? CHANGE_TAG[member.change] : CHANGE_TAG.context
        return (
          <button
            key={rowKey(row, index)}
            type="button"
            onClick={() => jump(row.symbolId)}
            title={member ? `Go to ${member.qualifiedName}` : undefined}
            className="flex w-full min-w-0 items-center gap-2 py-0.5 pr-4 pl-[60px] text-left text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <span className="w-6 shrink-0 text-center">⋯</span>
            <span className="min-w-0 truncate">{signature}</span>
            <span className={cn('shrink-0 text-[10.5px]', tag.className)}>{tag.label.toLowerCase()}</span>
          </button>
        )
      })}
      {long && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex w-full items-center gap-2 py-1 pr-4 pl-[86px] text-left text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <CornerDownRight className="size-3" /> Show {visible.length - SHOWN_WHEN_LONG} more lines
        </button>
      )}
      {rows.length === 0 && <p className="px-4 py-3 text-muted-foreground">No lines to show for this symbol.</p>}
    </div>
  )
}

export function SeeCard({ card }: { card: StoryCard }) {
  const { session, dispatch } = useReview()
  const symbol = symbolFor(session, card.symbolId)
  const index = session.guide.chapters.findIndex((chapter) => chapter.id === card.seeChapterId)
  const target = session.guide.chapters[index]
  if (symbol === undefined || target === undefined) return null
  return (
    <button
      type="button"
      onClick={() => dispatch({ type: 'step/go', index: index + 2 })}
      aria-label={`${symbol.qualifiedName}, see section ${index + 1}`}
      className="pane flex h-9 w-full items-center gap-2 px-3.5 text-left font-mono text-[12px] text-muted-foreground transition-colors hover:text-foreground"
    >
      <CornerDownRight aria-hidden className="size-3.5 shrink-0" />
      <KindBadge kind={symbol.kind} />
      <span className="min-w-0 truncate text-foreground/85">{symbol.qualifiedName}</span>
      <span className="shrink-0">
        see section {pad2(index + 1)} · <span className="text-foreground/70">{target.title}</span>
      </span>
    </button>
  )
}
