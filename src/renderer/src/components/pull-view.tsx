import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, ExternalLink, Loader2, RefreshCw, Sparkles, X } from 'lucide-react'
import type { Chapter, GuideStep, PullDetail, PullRef } from '@shared/types'
import { buildHeuristicGuide } from '@shared/guide'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ChapterStep } from '@/components/chapter-step'
import { DiffStat } from '@/components/diff-stat'
import { FlowStep } from '@/components/flow-step'
import { IdeView } from '@/components/ide-view'
import { OverviewStep } from '@/components/overview-step'
import { ReviewDialog } from '@/components/review-dialog'
import { UserAvatar } from '@/components/user-avatar'
import { useHotkeys } from '@/lib/hooks'
import { pad2, relativeTime } from '@/lib/paths'
import { usePrefs } from '@/lib/prefs'
import { ReviewContext, useReview, type Review } from '@/lib/review-context'
import {
  chapterReviewKeys,
  guideSteps,
  initSession,
  isReviewed,
  reviewReducer,
  saveSession,
  storageKey
} from '@/lib/review-session'
import { cn, errorMessage } from '@/lib/utils'
import { EMPTY_VIEW, useViewStore } from '@/lib/view-context'

type Load = { status: 'loading' } | { status: 'failed'; message: string } | { status: 'ready'; detail: PullDetail }

export function PullView({ pullRef, viewer }: { pullRef: PullRef; viewer: string }) {
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let live = true
    window.prot.pulls
      .get(pullRef)
      .then((detail) => live && setLoad({ status: 'ready', detail }))
      .catch((error: unknown) => live && setLoad({ status: 'failed', message: errorMessage(error) }))
    return () => {
      live = false
    }
  }, [pullRef, version])

  if (load.status === 'loading') return <PullSkeleton />
  if (load.status === 'failed') {
    return (
      <div className="flex h-full flex-col">
        <div className="drag-region h-12 shrink-0 border-b" />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <p className="font-serif text-xl">Could not load this pull request</p>
          <p className="max-w-md text-sm text-muted-foreground">{load.message}</p>
          <Button variant="outline" size="sm" onClick={() => setVersion((v) => v + 1)}>
            <RefreshCw /> Try again
          </Button>
        </div>
      </div>
    )
  }
  return (
    <ReviewScreen
      key={load.detail.head.sha}
      detail={load.detail}
      viewer={viewer}
      onRefetch={() => setVersion((v) => v + 1)}
    />
  )
}

function ReviewScreen({ detail, viewer, onRefetch }: { detail: PullDetail; viewer: string; onRefetch: () => void }) {
  const [session, dispatch] = useReducer(
    reviewReducer,
    { detail, guide: buildHeuristicGuide(detail) },
    initSession
  )
  const [reviewOpen, setReviewOpen] = useState(false)
  const { settings, keys } = usePrefs()
  const { updateView } = useViewStore()
  const ref = detail.summary.ref
  const { guide } = session
  const steps = guideSteps(guide)
  const step = steps[session.step] ?? { kind: 'overview' }

  useEffect(() => {
    saveSession(storageKey(detail), session)
  }, [detail, session])

  const files = useRef(new Map<string, Promise<string>>())
  const tree = useRef<Promise<string[]> | null>(null)
  const loadFile = useCallback(
    (path: string) => {
      let pending = files.current.get(path)
      if (!pending) {
        pending = window.prot.pulls.file(ref, path, detail.head.sha)
        pending.catch(() => files.current.delete(path))
        files.current.set(path, pending)
      }
      return pending
    },
    [ref, detail.head.sha]
  )
  const loadTree = useCallback(() => {
    tree.current ??= window.prot.pulls.tree(ref, detail.head.sha)
    tree.current.catch(() => (tree.current = null))
    return tree.current
  }, [ref, detail.head.sha])

  const requestAi = useCallback(
    async (refresh: boolean) => {
      dispatch({ type: 'ai/start' })
      try {
        dispatch({ type: 'ai/loaded', guide: await window.prot.guide.ai(ref, refresh) })
      } catch (error) {
        dispatch({ type: 'ai/failed', message: errorMessage(error) })
      }
    },
    [ref]
  )

  const autoStarted = useRef(false)
  useEffect(() => {
    if (autoStarted.current || !settings.autoAiGuide || !keys.anthropic) return
    autoStarted.current = true
    void requestAi(false)
  }, [settings.autoAiGuide, keys.anthropic, requestAi])

  useEffect(() => {
    updateView({
      pull: { ref, title: detail.summary.title, author: detail.summary.author.login, body: detail.body },
      step,
      chapter: step.kind === 'chapter' ? (guide.chapters[step.index] ?? null) : null,
      flow: guide.flow
    })
  }, [updateView, ref, detail, guide, step.kind, session.step])
  useEffect(() => () => updateView(EMPTY_VIEW), [updateView])

  useHotkeys(
    {
      ArrowLeft: () => dispatch({ type: 'step/move', delta: -1 }),
      ArrowRight: () => dispatch({ type: 'step/move', delta: 1 })
    },
    !session.ide.open
  )

  const review: Review = useMemo(
    () => ({ detail, session, dispatch, loadFile, loadTree }),
    [detail, session, loadFile, loadTree]
  )

  const reviewedCount = detail.files.filter((file) => session.reviewed.includes(file.path)).length
  const last = session.step === steps.length - 1

  return (
    <ReviewContext.Provider value={review}>
      <div className="relative flex h-full flex-col">
        <header className="shrink-0 border-b">
          <div className="drag-region flex h-12 items-center gap-3 px-6">
            <span className="font-mono text-xs text-muted-foreground">
              {ref.owner}/{ref.repo}#{ref.number}
            </span>
            <GuideChip onRequest={(refresh) => void requestAi(refresh)} />
            <span className="flex-1" />
            <div className="no-drag flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => void window.prot.openExternal(detail.summary.url)}>
                <ExternalLink /> Open on GitHub
              </Button>
              <Button size="sm" onClick={() => setReviewOpen(true)}>
                Review
                {session.drafts.length > 0 && (
                  <span className="rounded-full bg-primary-foreground/20 px-1.5 font-mono text-[10px] tabular-nums">
                    {session.drafts.length}
                  </span>
                )}
              </Button>
            </div>
          </div>
          <div className="px-6 pt-1 pb-4">
            <h1 className="line-clamp-2 font-serif text-[22px] leading-snug font-semibold tracking-tight" title={detail.summary.title}>
              {detail.summary.title}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5 text-foreground/80">
                <UserAvatar user={detail.summary.author} className="size-4" />
                {detail.summary.author.login}
              </span>
              <span>updated {relativeTime(detail.summary.updatedAt)}</span>
              <span className="flex min-w-0 items-center gap-1.5 font-mono text-[11px]">
                <span className="max-w-48 truncate rounded border bg-muted px-1.5 py-px" title={detail.base.ref}>
                  {detail.base.ref}
                </span>
                <span aria-label="from">←</span>
                <span className="max-w-64 truncate rounded border bg-muted px-1.5 py-px" title={detail.head.ref}>
                  {detail.head.ref}
                </span>
              </span>
              <DiffStat additions={detail.additions} deletions={detail.deletions} />
              <span>
                {detail.files.length} {detail.files.length === 1 ? 'file' : 'files'}
              </span>
              <span className={cn(reviewedCount === detail.files.length && reviewedCount > 0 && 'text-added')}>
                {reviewedCount}/{detail.files.length} reviewed
              </span>
              {detail.summary.draft && (
                <span className="rounded-full border px-1.5 py-px text-[10.5px] font-medium">Draft</span>
              )}
            </div>
          </div>
        </header>

        <nav aria-label="Review steps" className="flex h-11 shrink-0 items-center gap-2 border-b bg-sidebar/60 pr-3 pl-4">
          <StepTabs />
          <div className="flex shrink-0 items-center gap-1 border-l pl-3">
            <Button
              variant="ghost"
              size="sm"
              disabled={session.step === 0}
              onClick={() => dispatch({ type: 'step/move', delta: -1 })}
            >
              <ChevronLeft /> Back
            </Button>
            <span className="w-14 text-center font-mono text-[11px] text-muted-foreground tabular-nums">
              {session.step + 1} of {steps.length}
            </span>
            {last ? (
              <Button size="sm" onClick={() => setReviewOpen(true)}>
                Finish <Check />
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => dispatch({ type: 'step/move', delta: 1 })}>
                Next <ChevronRight />
              </Button>
            )}
          </div>
        </nav>

        {session.ai.status === 'failed' && (
          <AiNotice message={session.ai.message} onRetry={() => void requestAi(true)} />
        )}

        <div
          key={session.step}
          role="tabpanel"
          aria-label={stepLabel(step, guide.chapters)}
          className="scroll-quiet min-h-0 flex-1 overflow-y-auto"
        >
          {step.kind === 'overview' && <OverviewStep />}
          {step.kind === 'flow' && <FlowStep />}
          {step.kind === 'chapter' && <ChapterStep index={step.index} />}
        </div>

        {session.ide.open && <IdeView path={session.ide.path} />}
      </div>
      <ReviewDialog open={reviewOpen} onOpenChange={setReviewOpen} viewer={viewer} onSubmitted={onRefetch} />
    </ReviewContext.Provider>
  )
}

function stepLabel(step: GuideStep, chapters: Chapter[]): string {
  if (step.kind === 'overview') return 'Overview'
  if (step.kind === 'flow') return 'Flow'
  return `${pad2(step.index + 1)} ${chapters[step.index]?.title ?? ''}`
}

function StepTabs() {
  const { session, dispatch } = useReview()
  const steps = guideSteps(session.guide)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const active = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')
    active?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [session.step])

  return (
    <div ref={listRef} role="tablist" aria-label="Steps" className="scroll-quiet flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-1">
      {steps.map((step, index) => {
        const chapter = step.kind === 'chapter' ? session.guide.chapters[step.index] : undefined
        const done = chapter ? isReviewed(session, chapterReviewKeys(chapter)) : false
        const active = index === session.step
        return (
          <button
            key={index}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => dispatch({ type: 'step/go', index })}
            title={chapter?.title}
            className={cn(
              'flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors',
              active
                ? 'border-border bg-card font-medium text-foreground shadow-xs'
                : 'border-transparent text-muted-foreground hover:bg-accent hover:text-foreground'
            )}
          >
            {done && <Check aria-hidden className="size-3 text-added" strokeWidth={3} />}
            {step.kind === 'chapter' && chapter ? (
              <>
                <span className="font-mono text-[10.5px] opacity-70">{pad2(step.index + 1)}</span>
                <span className="max-w-52 truncate">{chapter.title}</span>
              </>
            ) : (
              <span>{step.kind === 'overview' ? 'Overview' : 'Flow'}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

function GuideChip({ onRequest }: { onRequest: (refresh: boolean) => void }) {
  const { session } = useReview()
  const { keys } = usePrefs()
  const { setChatOpen } = useViewStore()
  const loading = session.ai.status === 'loading'
  const ai = session.guide.source === 'ai'

  return (
    <div className="no-drag flex items-center gap-1 rounded-full border bg-card py-0.5 pr-0.5 pl-2 text-[11px] shadow-xs">
      {ai ? <Sparkles className="size-3 text-violet-500" /> : <span className="size-1.5 rounded-full bg-muted-foreground/50" />}
      <span className="font-medium">{ai ? 'AI guide' : 'Quick guide'}</span>
      {loading ? (
        <span className="flex items-center gap-1 px-1.5 text-muted-foreground">
          <Loader2 className="size-3 animate-spin" /> writing AI guide
        </span>
      ) : keys.anthropic ? (
        <button
          type="button"
          onClick={() => onRequest(ai)}
          aria-label={ai ? 'Regenerate AI guide' : 'Generate AI guide'}
          title={ai ? 'Regenerate AI guide' : 'Generate AI guide'}
          className="flex h-5 items-center gap-1 rounded-full px-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {ai ? <RefreshCw className="size-3" /> : <><Sparkles className="size-3" /> Use AI</>}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setChatOpen(true)}
          title="Add an Anthropic API key to write an AI guide"
          className="flex h-5 items-center rounded-full px-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          Add API key
        </button>
      )}
    </div>
  )
}

function AiNotice({ message, onRetry }: { message: string; onRetry: () => void }) {
  const [hidden, setHidden] = useState(false)
  if (hidden) return null
  return (
    <div role="status" className="flex shrink-0 items-center gap-3 border-b bg-modified-bg/40 px-6 py-1.5 text-xs">
      <span className="min-w-0 flex-1 truncate text-foreground/80" title={message}>
        The AI guide could not be written, so this is the quick guide. {message}
      </span>
      <button type="button" onClick={onRetry} className="shrink-0 font-medium hover:underline">
        Retry
      </button>
      <button type="button" aria-label="Dismiss" onClick={() => setHidden(true)} className="shrink-0 text-muted-foreground hover:text-foreground">
        <X className="size-3.5" />
      </button>
    </div>
  )
}

function PullSkeleton() {
  return (
    <div className="flex h-full flex-col" aria-busy="true" aria-label="Loading pull request">
      <div className="drag-region flex h-12 shrink-0 items-center border-b px-6">
        <Skeleton className="h-3 w-40" />
      </div>
      <div className="space-y-3 border-b px-6 pt-2 pb-4">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>
      <div className="h-11 border-b" />
      <div className="mx-auto w-full max-w-5xl space-y-4 px-8 py-8">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-4/6" />
      </div>
    </div>
  )
}
