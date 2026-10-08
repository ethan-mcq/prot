import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ComponentProps } from 'react'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  GitCommitHorizontal,
  GitPullRequest,
  Link,
  Loader2,
  RefreshCw,
  ScrollText,
  Sparkles,
  WandSparkles,
  Workflow,
  X
} from 'lucide-react'
import { displayName, findVersion, livePrompt, type PromptLibrary } from '@shared/prompts'
import type { CardContext, Chapter, DriftReason, GuideDrift, GuideStep, PullDetail, PullRef, StoryContext } from '@shared/types'
import { pullKey } from '@shared/types'
import { classifyFile } from '@shared/guide'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ChapterStep } from '@/components/chapter-step'
import { DiffStat } from '@/components/diff-stat'
import { FlowStep } from '@/components/flow-step'
import { IdeView } from '@/components/ide-view'
import { OverviewStep } from '@/components/overview-step'
import { PaneHeader } from '@/components/pane'
import { ReviewDialog } from '@/components/review-dialog'
import { TitleBarPortal } from '@/components/title-bar'
import { UserAvatar } from '@/components/user-avatar'
import { useHotkeys } from '@/lib/hooks'
import { pad2, relativeTime, splitPath } from '@/lib/paths'
import { usePrefs } from '@/lib/prefs'
import { ReviewContext, useReview, type Review } from '@/lib/review-context'
import {
  chapterReviewKeys,
  guideSteps,
  initSession,
  isFileReviewed,
  isReviewed,
  readStored,
  reviewReducer,
  saveSession,
  storageKey,
  symbolFor,
  type ReviewSession
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
      <div className="pane flex h-full flex-col">
        <PaneHeader icon={<GitPullRequest />} title="Could not load this pull request" />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center font-mono text-[12.5px]">
          <p className="text-destructive">! {load.message}</p>
          <Button variant="outline" size="sm" onClick={() => setVersion((v) => v + 1)}>
            <RefreshCw /> Try again
          </Button>
        </div>
      </div>
    )
  }
  return <ReviewScreen initial={load.detail} viewer={viewer} />
}

function ReviewScreen({ initial, viewer }: { initial: PullDetail; viewer: string }) {
  const [session, dispatch] = useReducer(reviewReducer, initial, initSession)
  const [reviewOpen, setReviewOpen] = useState(false)
  const { settings, keys, prompts } = usePrefs()
  const { updateView, setQuestions } = useViewStore()
  const ref = initial.summary.ref
  const { detail, guide, drift } = session
  const sha = detail.head.sha
  const steps = guideSteps(guide)
  const step = steps[session.step] ?? { kind: 'overview' }

  useEffect(() => {
    saveSession(storageKey(detail), session)
  }, [detail, session])

  const latestFetch = useRef(0)
  const syncedAt = useRef(initial.summary.updatedAt)
  const refetch = useCallback(
    async (inboxUpdatedAt: string | null) => {
      const id = ++latestFetch.current
      try {
        const next = await window.prot.pulls.get(ref)
        if (id !== latestFetch.current) return
        dispatch({ type: 'detail/updated', detail: next, reviewed: readStored(storageKey(next)).reviewed })
        if (inboxUpdatedAt !== null) syncedAt.current = inboxUpdatedAt
      } catch {
        // syncedAt only moves on success, so the next inbox change retries.
      }
    },
    [ref]
  )

  useEffect(
    () =>
      window.prot.inbox.onChange((inbox) => {
        const summary = inbox.pulls.find((pull) => pullKey(pull.ref) === pullKey(ref))
        if (summary && summary.updatedAt !== syncedAt.current) void refetch(summary.updatedAt)
      }),
    [ref, refetch]
  )

  const files = useRef(new Map<string, Promise<string>>())
  const tree = useRef<{ sha: string; paths: Promise<string[]> } | null>(null)
  const loadFile = useCallback(
    (path: string) => {
      const key = `${sha}:${path}`
      let pending = files.current.get(key)
      if (!pending) {
        pending = window.prot.pulls.file(ref, path, sha)
        pending.catch(() => files.current.delete(key))
        files.current.set(key, pending)
      }
      return pending
    },
    [ref, sha]
  )
  const loadTree = useCallback(() => {
    if (tree.current?.sha !== sha) {
      const paths = window.prot.pulls.tree(ref, sha)
      paths.catch(() => (tree.current = null))
      tree.current = { sha, paths }
    }
    return tree.current.paths
  }, [ref, sha])

  useEffect(() => {
    let live = true
    window.prot.guide
      .story(ref)
      .then((guide) => live && dispatch({ type: 'story/loaded', guide }))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [ref, sha])

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

  // Once per head SHA, so a regenerated guide that still reads stale cannot loop.
  const autoRefreshedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!settings.autoRefreshStaleGuides || !keys.anthropic) return
    if (drift.kind !== 'significant' || session.ai.status === 'loading' || autoRefreshedFor.current === sha) return
    autoRefreshedFor.current = sha
    void requestAi(true)
  }, [settings.autoRefreshStaleGuides, keys.anthropic, drift.kind, session.ai.status, sha, requestAi])

  const story = useMemo(() => storyContext(session), [session.guide, session.symbols])
  useEffect(() => {
    updateView({
      pull: { ref, author: detail.summary.author.login },
      story,
      step,
      chapter: step.kind === 'chapter' ? (guide.chapters[step.index] ?? null) : null,
      flow: guide.flow
    })
  }, [updateView, ref, detail, guide, story, step.kind, session.step])
  useEffect(() => () => updateView(EMPTY_VIEW), [updateView])
  useEffect(() => {
    setQuestions(guide.questions)
    return () => setQuestions([])
  }, [setQuestions, guide.questions])

  useHotkeys(
    {
      ArrowLeft: () => dispatch({ type: 'step/move', delta: -1 }),
      ArrowRight: () => dispatch({ type: 'step/move', delta: 1 })
    },
    !session.ide.open
  )

  const review: Review = useMemo(
    () => ({ detail, session, dispatch, loadFile, loadTree, refetch: () => void refetch(null) }),
    [detail, session, loadFile, loadTree, refetch]
  )

  const reviewedCount = detail.files.filter((file) => isFileReviewed(session, file.path)).length
  const last = session.step === steps.length - 1

  return (
    <ReviewContext.Provider value={review}>
      <TitleBarPortal>
        <StepTabs />
        <div className="no-drag flex shrink-0 items-center gap-1.5">
          <div className="flex items-center">
            <TitleButton
              aria-label="Back"
              title="Back (←)"
              disabled={session.step === 0}
              onClick={() => dispatch({ type: 'step/move', delta: -1 })}
            >
              <ChevronLeft />
            </TitleButton>
            <TitleButton
              aria-label="Next"
              title="Next (→)"
              disabled={last}
              onClick={() => dispatch({ type: 'step/move', delta: 1 })}
            >
              <ChevronRight />
            </TitleButton>
            <span className="w-14 text-center font-mono text-[11px] text-tab-foreground tabular-nums">
              {session.step + 1} of {steps.length}
            </span>
          </div>
          <GuideChip onRequest={(refresh) => void requestAi(refresh)} />
          <TitleButton
            aria-label="Open on GitHub"
            title="Open on GitHub"
            onClick={() => void window.prot.openExternal(detail.summary.url)}
          >
            <ExternalLink />
          </TitleButton>
          <CopyLinkButton url={detail.summary.url} />
          <button
            type="button"
            onClick={() => setReviewOpen(true)}
            className="flex h-7 items-center gap-1.5 rounded-full bg-primary px-3.5 text-[12.5px] font-medium text-primary-foreground shadow-raised transition-opacity hover:opacity-90"
          >
            Review
            {session.drafts.length > 0 && (
              <span className="rounded-full bg-primary-foreground/20 px-1.5 font-mono text-[10px] leading-4 tabular-nums">
                {session.drafts.length}
              </span>
            )}
          </button>
        </div>
      </TitleBarPortal>

      <div className="relative flex h-full flex-col">
        <div className={cn('flex min-h-0 flex-1 flex-col gap-2', session.ide.open && 'invisible')}>
          <header className="pane shrink-0 px-3.5 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <GitPullRequest aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
              <h1 className="min-w-0 truncate text-[13.5px] font-medium" title={detail.summary.title}>
                {detail.summary.title}
              </h1>
              <span className="shrink-0 font-mono text-[11.5px] text-muted-foreground">
                {ref.owner}/{ref.repo}#{ref.number}
              </span>
              {detail.summary.draft && (
                <span className="shrink-0 rounded-[4px] border px-1 font-mono text-[10px] text-modified">draft</span>
              )}
            </div>
            <p className="mt-1 flex min-w-0 items-center gap-x-2 pl-[22px] font-mono text-[11.5px] whitespace-nowrap text-muted-foreground">
              <UserAvatar user={detail.summary.author} className="size-3.5" />
              <span className="text-foreground/80">{detail.summary.author.login}</span>
              <span aria-hidden>·</span>
              <span>updated {relativeTime(detail.summary.updatedAt)}</span>
              <span aria-hidden>·</span>
              <span className="max-w-48 truncate text-command" title={detail.base.ref}>
                {detail.base.ref}
              </span>
              <span aria-label="from">←</span>
              <span className="max-w-64 truncate text-command" title={detail.head.ref}>
                {detail.head.ref}
              </span>
              <span aria-hidden>·</span>
              <DiffStat additions={detail.additions} deletions={detail.deletions} className="text-[11.5px]" />
              <span aria-hidden>·</span>
              <span>
                {detail.files.length} {detail.files.length === 1 ? 'file' : 'files'}
              </span>
              <span aria-hidden>·</span>
              <span className={cn(reviewedCount === detail.files.length && reviewedCount > 0 && 'text-added')}>
                {reviewedCount}/{detail.files.length} reviewed
              </span>
            </p>
          </header>

          {drift.kind === 'significant' && (
            <StaleGuideNotice drift={drift} loading={session.ai.status === 'loading'} onRefresh={() => void requestAi(true)} />
          )}
          {guide.source === 'ai' && guide.promptHash !== prompts.guide.liveHash && (
            <PromptNotice
              prompts={prompts.guide}
              guideHash={guide.promptHash}
              loading={session.ai.status === 'loading'}
              canRegenerate={keys.anthropic}
              onRegenerate={() => void requestAi(true)}
            />
          )}
          {session.ai.status === 'failed' && (
            <AiNotice message={session.ai.message} onRetry={() => void requestAi(true)} />
          )}

          <div key={session.step} role="tabpanel" aria-label={stepLabel(step, guide.chapters)} className="min-h-0 flex-1">
            {step.kind === 'overview' && <OverviewStep />}
            {step.kind === 'flow' && <FlowStep />}
            {step.kind === 'chapter' && <ChapterStep index={step.index} />}
          </div>
        </div>

        {session.ide.open && <IdeView path={session.ide.path} />}
      </div>
      <ReviewDialog open={reviewOpen} onOpenChange={setReviewOpen} viewer={viewer} onSubmitted={() => void refetch(null)} />
    </ReviewContext.Provider>
  )
}

function storyContext(session: ReviewSession): StoryContext {
  const { overview, chapters } = session.guide
  const sections = chapters.map((chapter) => {
    const cards: CardContext[] = []
    for (const card of chapter.cards) {
      const symbol = card.seeChapterId === null ? symbolFor(session, card.symbolId) : undefined
      if (symbol === undefined) continue
      cards.push({ qualifiedName: symbol.qualifiedName, kind: symbol.kind, path: symbol.path, lines: symbol.head ?? symbol.base, change: symbol.change })
    }
    return { title: chapter.title, cards, files: chapter.cards.length === 0 ? chapter.files : [] }
  })
  return { risk: overview.risk, synopsis: overview.synopsis, sections }
}

function TitleButton({ className, ...props }: ComponentProps<'button'>) {
  return (
    <button
      type="button"
      className={cn(
        'flex size-7 items-center justify-center rounded-[8px] text-tab-foreground transition-colors outline-none hover:bg-tab-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-35 [&_svg]:size-4',
        className
      )}
      {...props}
    />
  )
}

function stepLabel(step: GuideStep, chapters: Chapter[]): string {
  if (step.kind === 'overview') return 'Overview'
  if (step.kind === 'flow') return 'Story map'
  return `${pad2(step.index + 1)} ${chapters[step.index]?.title ?? ''}`
}

function StepTabs() {
  const { session, dispatch } = useReview()
  const steps = guideSteps(session.guide)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // scrollIntoView would also scroll the window's own layout sideways, under the traffic lights.
    const list = listRef.current
    const active = list?.querySelector<HTMLElement>('[aria-selected="true"]')
    if (!list || !active) return
    const left = active.offsetLeft - list.offsetLeft - 24
    const right = left + active.offsetWidth + 48
    if (left < list.scrollLeft) list.scrollLeft = left
    else if (right > list.scrollLeft + list.clientWidth) list.scrollLeft = right - list.clientWidth
  }, [session.step])

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label="Steps"
      className="scroll-none no-drag -mx-2 flex min-w-0 flex-1 scroll-px-6 items-center gap-1 overflow-x-auto px-2 py-2 [mask-image:linear-gradient(to_right,transparent,black_8px,black_calc(100%-28px),transparent)]"
    >
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
              'flex h-[30px] shrink-0 items-center gap-2 rounded-[9px] px-3 text-[12.5px]',
              active
                ? 'bg-tab-active font-medium text-foreground shadow-raised'
                : 'bg-tab text-tab-foreground hover:bg-tab-hover hover:text-foreground'
            )}
          >
            <StepIcon step={step} done={done} />
            {step.kind === 'chapter' && chapter ? (
              <span className="max-w-44 truncate">{chapter.title}</span>
            ) : (
              <span>{step.kind === 'overview' ? 'Overview' : 'Story map'}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

function StepIcon({ step, done }: { step: GuideStep; done: boolean }) {
  if (step.kind === 'overview') return <ScrollText aria-hidden className="size-3.5 shrink-0" />
  if (step.kind === 'flow') return <Workflow aria-hidden className="size-3.5 shrink-0" />
  return (
    <span
      className={cn(
        'flex h-4 min-w-5 shrink-0 items-center justify-center rounded-[4px] font-mono text-[10px] leading-none tabular-nums',
        done ? 'bg-added-mark text-white' : 'bg-foreground/8 dark:bg-foreground/12'
      )}
    >
      {done ? <Check className="size-2.5" strokeWidth={3.5} /> : pad2(step.index + 1)}
    </span>
  )
}

function GuideChip({ onRequest }: { onRequest: (refresh: boolean) => void }) {
  const { session } = useReview()
  const { keys, prompts } = usePrefs()
  const { setChatOpen } = useViewStore()
  const loading = session.ai.status === 'loading'
  const guide = session.guide
  const ai = guide.source === 'ai'
  const action = 'flex h-5 items-center gap-1 rounded-full px-1.5 transition-colors hover:bg-card hover:text-foreground'

  return (
    <div
      title={guide.source === 'ai' ? `Written with prompt ${promptLabel(prompts.guide, guide.promptHash)}` : undefined}
      className="flex h-7 items-center gap-1 rounded-full bg-tab pr-0.5 pl-2.5 font-mono text-[11px] text-tab-foreground"
    >
      {ai ? <Sparkles className="size-3 text-violet-500 dark:text-violet-300" /> : <span className="size-1.5 rounded-full bg-current opacity-60" />}
      <span className="text-foreground/80">{ai ? 'ai guide' : 'quick guide'}</span>
      {loading ? (
        <span className="flex items-center gap-1 px-1.5">
          <Loader2 className="size-3 animate-spin" /> writing
        </span>
      ) : keys.anthropic ? (
        <button
          type="button"
          onClick={() => onRequest(ai)}
          aria-label={ai ? 'Regenerate AI guide' : 'Generate AI guide'}
          title={ai ? 'Regenerate the AI guide for this pull request' : 'Generate an AI guide for this pull request'}
          className={action}
        >
          {ai ? <WandSparkles className="size-3" /> : <><Sparkles className="size-3" /> use ai</>}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setChatOpen(true)}
          title="Add an Anthropic API key to write an AI guide"
          className={action}
        >
          add api key
        </button>
      )}
    </div>
  )
}

function reasonText(reason: DriftReason): string {
  switch (reason.kind) {
    case 'uncovered-file':
      return `New ${classifyFile(reason.path)} file ${splitPath(reason.path).name} is not in any chapter yet.`
    case 'removed-file':
      return `${splitPath(reason.path).name} was in the guide and is no longer part of this pull request.`
    case 'line-share':
      return `${reason.lines} lines changed, against ${reason.covered} the guide covered.`
  }
}

function StaleGuideNotice({
  drift,
  loading,
  onRefresh
}: {
  drift: Extract<GuideDrift, { kind: 'significant' }>
  loading: boolean
  onRefresh: () => void
}) {
  const files = drift.changed.length + drift.added.length + drift.removed.length
  const [reason, ...more] = drift.reasons
  return (
    <div role="status" className="pane flex shrink-0 items-center gap-3 py-2 pr-2 pl-3.5 font-mono text-[11.5px] leading-[18px]">
      <GitCommitHorizontal aria-hidden className="size-3.5 shrink-0 text-modified" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-foreground/85">
          This PR changed since the guide was written
          <span className="text-muted-foreground">
            {' · '}
            {files} {files === 1 ? 'file' : 'files'}, <span className="text-added">+{drift.additions}</span>{' '}
            <span className="text-removed">−{drift.deletions}</span> since{' '}
            <span className="text-command">{drift.sinceSha.slice(0, 7)}</span>
          </span>
        </p>
        {reason && (
          <p className="truncate text-muted-foreground">
            {reasonText(reason)}
            {more.length > 0 && ` (+${more.length} more)`}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onRefresh}
        disabled={loading}
        className="flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-primary px-3 font-sans text-[12px] font-medium text-primary-foreground shadow-raised transition-opacity hover:opacity-90 disabled:opacity-60 [&_svg]:size-3.5"
      >
        {loading ? <Loader2 className="animate-spin" /> : <WandSparkles />}
        {loading ? 'Refreshing guide' : 'Refresh guide'}
      </button>
    </div>
  )
}

function promptLabel(prompts: PromptLibrary, hash: string): string {
  const version = findVersion(prompts, hash)
  return version === undefined ? hash : displayName(version)
}

function PromptNotice({
  prompts,
  guideHash,
  loading,
  canRegenerate,
  onRegenerate
}: {
  prompts: PromptLibrary
  guideHash: string
  loading: boolean
  canRegenerate: boolean
  onRegenerate: () => void
}) {
  return (
    <div role="status" className="pane flex shrink-0 items-center gap-3 px-3.5 py-1.5 font-mono text-[11.5px] text-muted-foreground">
      <ScrollText aria-hidden className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">
        Generated with prompt <span className="text-foreground/85">{promptLabel(prompts, guideHash)}</span>. The live prompt is{' '}
        <span className="text-foreground/85">{displayName(livePrompt(prompts))}</span>. Regenerate to use it.
      </span>
      {canRegenerate && (
        <button type="button" onClick={onRegenerate} disabled={loading} className="shrink-0 text-foreground hover:underline disabled:opacity-50">
          {loading ? 'regenerating' : 'regenerate'}
        </button>
      )}
    </div>
  )
}

function AiNotice({ message, onRetry }: { message: string; onRetry: () => void }) {
  const [hidden, setHidden] = useState(false)
  if (hidden) return null
  return (
    <div role="status" className="pane flex shrink-0 items-center gap-3 px-3.5 py-1.5 font-mono text-[11.5px]">
      <span className="text-modified">!</span>
      <span className="min-w-0 flex-1 truncate text-foreground/80" title={message}>
        The AI guide could not be written, so this is the quick guide. {message}
      </span>
      <button type="button" onClick={onRetry} className="shrink-0 hover:underline">
        retry
      </button>
      <button type="button" aria-label="Dismiss" onClick={() => setHidden(true)} className="shrink-0 text-muted-foreground hover:text-foreground">
        <X className="size-3.5" />
      </button>
    </div>
  )
}

function PullSkeleton() {
  return (
    <div className="flex h-full flex-col gap-2" aria-busy="true" aria-label="Loading pull request">
      <div className="pane space-y-2 px-3.5 py-3">
        <Skeleton className="h-3.5 w-2/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>
      <div className="flex min-h-0 flex-1 gap-2">
        <div className="pane flex-1 space-y-3 p-5">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
          <Skeleton className="h-3 w-4/6" />
        </div>
        <div className="pane w-[380px] space-y-2 p-5">
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      </div>
    </div>
  )
}

function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])
  return (
    <TitleButton
      aria-label={copied ? 'Link copied' : 'Copy link'}
      title={copied ? 'Copied' : 'Copy pull request link'}
      onClick={() => void window.prot.copyLink(url).then(() => setCopied(true))}
    >
      {copied ? <Check className="text-added" /> : <Link />}
    </TitleButton>
  )
}
