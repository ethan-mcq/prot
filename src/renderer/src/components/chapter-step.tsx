import { Fragment, useEffect, useRef, useState } from 'react'
import { BookOpen, Check } from 'lucide-react'
import { symbolCode } from '@shared/guide'
import type { ChangedFile, Chapter, CodeSymbol, SectionContext, StoryCard } from '@shared/types'
import { Checkbox } from '@/components/ui/checkbox'
import { FileCard } from '@/components/file-card'
import { FileTree } from '@/components/file-tree'
import { Markdown } from '@/components/markdown'
import { PaneHeader } from '@/components/pane'
import { CHANGE_TAG, cardDomId, displayName, KindBadge, SeeCard, SymbolCard } from '@/components/symbol-card'
import { pad2 } from '@/lib/paths'
import { useReview } from '@/lib/review-context'
import { cardKey, chapterReviewKeys, isReviewed, symbolFor, type ReviewSession } from '@/lib/review-session'
import { cn } from '@/lib/utils'
import { useViewStore } from '@/lib/view-context'

export function chapterFiles(chapter: Chapter, files: ChangedFile[]): ChangedFile[] {
  const byPath = new Map(files.map((file) => [file.path, file]))
  const result: ChangedFile[] = []
  for (const path of chapter.files) {
    const file = byPath.get(path)
    if (file) result.push(file)
  }
  return result
}

export function ChapterStep({ index }: { index: number }) {
  const { session } = useReview()
  const chapter = session.guide.chapters[index]
  if (!chapter) return null
  if (chapter.cards.length > 0) return <StorySection chapter={chapter} index={index} />
  return <FileChapter chapter={chapter} index={index} />
}

function FileChapter({ chapter, index }: { chapter: Chapter; index: number }) {
  const { detail, session, dispatch } = useReview()
  const files = chapterFiles(chapter, detail.files)
  const keys = chapterReviewKeys(chapter)
  const reviewed = isReviewed(session, keys)

  const { ref } = detail.summary

  return (
    <div className="flex h-full gap-2">
      <aside className="pane flex w-[340px] shrink-0 flex-col">
        <PaneHeader
          icon={<BookOpen />}
          title="Chapter"
          detail={`${ref.repo}#${ref.number}`}
          actions={
            <span className="px-1.5 font-mono text-[11px] text-muted-foreground tabular-nums">
              {pad2(index + 1)} / {pad2(session.guide.chapters.length)}
            </span>
          }
        />
        <div className="scroll-quiet min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pt-2 pb-5 font-mono text-[12.5px] leading-[1.7]">
          <h2 className="text-[16px] font-semibold text-foreground break-words">{chapter.title}</h2>
          <label className="flex w-fit cursor-pointer items-center gap-2 rounded-[6px] border border-pane-border px-2 py-1 text-[12px] transition-colors hover:bg-accent has-[[data-state=checked]]:border-added/40 has-[[data-state=checked]]:text-added">
            <Checkbox
              checked={reviewed}
              aria-label="Chapter reviewed"
              onCheckedChange={(value) => dispatch({ type: 'reviewed/set', keys, reviewed: value === true })}
            />
            Reviewed
          </label>
          <Markdown className="font-copy text-[13px] leading-[1.75] text-foreground/85">{chapter.summary}</Markdown>
          {files.length > 0 && (
            <section className="space-y-1.5">
              <h3 className="font-semibold">
                Files <span className="font-normal text-muted-foreground">{files.length}</span>
              </h3>
              <FileTree
                files={files}
                onSelect={(file) =>
                  document.getElementById(`file-${file.path}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }
              />
            </section>
          )}
        </div>
      </aside>
      <div className="scroll-quiet min-w-0 flex-1 space-y-2 overflow-y-auto rounded-[12px]">
        {files.map((file) => (
          <FileCard key={file.path} file={file} />
        ))}
        {files.length === 0 && (
          <div className="pane px-6 py-10 text-center font-mono text-[12.5px] text-muted-foreground">
            This chapter has no file changes of its own.
          </div>
        )}
      </div>
    </div>
  )
}

type Relation = 'calls' | 'uses' | 'tested by' | null

function relation(cards: StoryCard[], index: number, session: ReviewSession): Relation {
  const next = cards[index]
  const prev = cards[index - 1]
  if (next === undefined || prev === undefined) return null
  if (next.role === 'test') return prev.role === 'test' ? null : 'tested by'
  const prevSymbol = symbolFor(session, prev.symbolId)
  if (prevSymbol?.calls.includes(next.symbolId)) return 'calls'
  if (next.role === 'data' && cards.slice(0, index).some((card) => symbolFor(session, card.symbolId)?.calls.includes(next.symbolId))) {
    return 'uses'
  }
  return null
}

function Connector({ label }: { label: Relation }) {
  return (
    <div aria-hidden className="flex h-6 items-stretch pl-7">
      <span className="w-px bg-frame/70" />
      {label && <span className="ml-2 self-center font-mono text-[10.5px] text-muted-foreground">{label}</span>}
    </div>
  )
}

function useSectionContext(chapter: Chapter, container: React.RefObject<HTMLDivElement | null>) {
  const { detail, session, loadFile } = useReview()
  const { updateView } = useViewStore()
  const [visible, setVisible] = useState<string | null>(chapter.cards[0]?.symbolId ?? null)
  const [head, setHead] = useState<{ path: string; lines: string } | null>(null)

  useEffect(() => {
    const element = container.current
    if (!element) return
    const measure = () => {
      const top = element.getBoundingClientRect().top
      for (const card of chapter.cards) {
        const node = document.getElementById(cardDomId(card.symbolId))
        if (node && node.getBoundingClientRect().bottom > top + 24) {
          setVisible(card.symbolId)
          return
        }
      }
    }
    element.addEventListener('scroll', measure, { passive: true })
    return () => element.removeEventListener('scroll', measure)
  }, [chapter, container])

  const focus = session.focus
  const holder =
    focus === null
      ? undefined
      : chapter.cards.find((card) => {
          const symbol = symbolFor(session, card.symbolId)
          const range = focus.side === 'LEFT' ? symbol?.base : symbol?.head
          return symbol?.path === focus.path && range != null && focus.line >= range.start && focus.line <= range.end
        })
  const focusedId = holder?.symbolId ?? visible
  const focused = focusedId === null ? undefined : symbolFor(session, focusedId)

  useEffect(() => {
    if (focused === undefined || focused.head === null) return
    let live = true
    loadFile(focused.path)
      .then((text) => live && setHead({ path: focused.path, lines: text }))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [focused, loadFile])

  useEffect(() => {
    const cards = chapter.cards
      .map((card) => symbolFor(session, card.symbolId))
      .filter((symbol): symbol is CodeSymbol => symbol !== undefined)
      .map((symbol) => ({ qualifiedName: symbol.qualifiedName, kind: symbol.kind, path: symbol.path, lines: symbol.head ?? symbol.base, change: symbol.change }))
    let code: SectionContext['focused'] = null
    if (focused !== undefined) {
      const heads = head !== null && head.path === focused.path ? { [head.path]: head.lines } : {}
      const guide = { ...session.guide, symbols: { ...session.guide.symbols, ...session.symbols } }
      code = { qualifiedName: focused.qualifiedName, path: focused.path, code: symbolCode(focused, guide, detail, heads) }
    }
    updateView({ section: { cards, focused: code } })
  }, [chapter, session, detail, focused, head, updateView])

  useEffect(() => () => updateView({ section: null }), [updateView])
}

function StorySection({ chapter, index }: { chapter: Chapter; index: number }) {
  const { detail, session, dispatch } = useReview()
  const keys = chapterReviewKeys(chapter)
  const reviewed = isReviewed(session, keys)
  const scroller = useRef<HTMLDivElement>(null)
  useSectionContext(chapter, scroller)
  const { ref } = detail.summary
  const story = chapter.cards.filter((card) => card.role !== 'test')
  const tests = chapter.cards.filter((card) => card.role === 'test')
  const touched = new Set(chapter.cards.map((card) => symbolFor(session, card.symbolId)?.path))
  const extraFiles = chapterFiles(chapter, detail.files).filter((file) => !touched.has(file.path))

  return (
    <div className="flex h-full gap-2">
      <aside className="pane flex w-[340px] shrink-0 flex-col">
        <PaneHeader
          icon={<BookOpen />}
          title="Section"
          detail={`${ref.repo}#${ref.number}`}
          actions={
            <span className="px-1.5 font-mono text-[11px] text-muted-foreground tabular-nums">
              {pad2(index + 1)} / {pad2(session.guide.chapters.length)}
            </span>
          }
        />
        <div className="scroll-quiet min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pt-2 pb-5 font-mono text-[12.5px] leading-[1.7]">
          <h2 className="text-[16px] font-semibold text-foreground break-words">{chapter.title}</h2>
          <label className="flex w-fit cursor-pointer items-center gap-2 rounded-[6px] border border-pane-border px-2 py-1 text-[12px] transition-colors hover:bg-accent has-[[data-state=checked]]:border-added/40 has-[[data-state=checked]]:text-added">
            <Checkbox
              checked={reviewed}
              aria-label="Chapter reviewed"
              onCheckedChange={(value) => dispatch({ type: 'reviewed/set', keys, reviewed: value === true })}
            />
            Reviewed
          </label>
          <Markdown className="font-copy text-[13px] leading-[1.75] text-foreground/85">{chapter.summary}</Markdown>
          <section className="space-y-1.5">
            <h3 className="font-semibold">
              Cards <span className="font-normal text-muted-foreground">{chapter.cards.length}</span>
            </h3>
            <CardOutline cards={story} />
            {tests.length > 0 && (
              <>
                <p className="pt-1 text-[11.5px] text-muted-foreground">Tests</p>
                <CardOutline cards={tests} />
              </>
            )}
          </section>
        </div>
      </aside>
      <div ref={scroller} className="scroll-quiet min-w-0 flex-1 overflow-y-auto rounded-[12px]" aria-label="Storyline">
        {story.map((card, i) => (
          <Fragment key={`${card.symbolId}-${card.seeChapterId ?? ''}`}>
            {i > 0 && <Connector label={relation(story, i, session)} />}
            {card.seeChapterId === null ? <SymbolCard card={card} chapter={chapter} /> : <SeeCard card={card} />}
          </Fragment>
        ))}
        {tests.length > 0 && (
          <>
            <Connector label="tested by" />
            <div role="separator" aria-label="Tests" className="flex items-center gap-2 px-1 pb-2 font-mono text-[11.5px] text-muted-foreground">
              <span>Tests</span>
              <span className="h-px flex-1 bg-pane-border" />
            </div>
            <div className="space-y-2">
              {tests.map((card) => (
                <SymbolCard key={card.symbolId} card={card} chapter={chapter} />
              ))}
            </div>
          </>
        )}
        {extraFiles.length > 0 && (
          <div className="mt-2 space-y-2">
            {extraFiles.map((file) => (
              <FileCard key={file.path} file={file} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function CardOutline({ cards }: { cards: StoryCard[] }) {
  const { session } = useReview()
  return (
    <ul className="font-mono text-[12px] leading-6">
      {cards.map((card) => {
        const symbol = symbolFor(session, card.symbolId)
        if (symbol === undefined) return null
        const tag = CHANGE_TAG[symbol.change]
        const see = card.seeChapterId !== null
        const done = !see && isReviewed(session, [cardKey(card.symbolId)])
        return (
          <li key={`${card.symbolId}-${card.seeChapterId ?? ''}`}>
            <button
              type="button"
              aria-label={displayName(symbol)}
              title={`${symbol.path}${see ? ' (shown in another section)' : ''}`}
              onClick={() => document.getElementById(cardDomId(card.symbolId))?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              className={cn('flex w-full min-w-0 items-center gap-2 rounded-[5px] px-1 text-left transition-colors hover:bg-accent', see && 'opacity-60')}
            >
              <span className={cn('w-2.5 shrink-0 text-center font-semibold', tag.className)}>{tag.sign}</span>
              <KindBadge kind={symbol.kind} />
              <span className="min-w-0 flex-1 truncate">{displayName(symbol)}</span>
              {card.role === 'entry' && <span className="shrink-0 text-[10px] text-command">entry</span>}
              {see && <span className="shrink-0 text-[10px] text-muted-foreground">see</span>}
              {done && <Check aria-label="Reviewed" className="size-3 shrink-0 text-added" strokeWidth={3} />}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
