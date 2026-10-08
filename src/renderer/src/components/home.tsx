import { useId, type ReactNode } from 'react'
import { ArrowRight, Bot, GitPullRequest } from 'lucide-react'
import { TitleBar } from '@/components/title-bar'
import { cn } from '@/lib/utils'

export function Home({ login, onReview, onAgents }: { login: string | null; onReview: () => void; onAgents: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <TitleBar login={login} onHome={() => {}} />
      <div className="surface mx-2 mb-2 flex flex-1 items-center justify-center px-8 pb-12">
        <div className="grid w-full max-w-[760px] grid-cols-2 gap-5">
          <HomeCard
            index={1}
            tag="agents"
            title="Agent dash"
            icon={<Bot />}
            description="Watch and steer the agents working on your repos."
            footer={
              <>
                open
                <ArrowRight aria-hidden className="size-3.5 transition-transform group-hover/card:translate-x-0.5" />
              </>
            }
            onOpen={onAgents}
          />
          <HomeCard
            index={2}
            tag="review"
            title="PR Review"
            icon={<GitPullRequest />}
            description="Walk GitHub pull requests as an overview, a story map and sections."
            footer={
              <>
                open
                <ArrowRight aria-hidden className="size-3.5 transition-transform group-hover/card:translate-x-0.5" />
              </>
            }
            onOpen={onReview}
          />
        </div>
      </div>
    </div>
  )
}

function HomeCard({
  index,
  tag,
  title,
  icon,
  description,
  footer,
  onOpen
}: {
  index: number
  tag: string
  title: string
  icon: ReactNode
  description: string
  footer: ReactNode
  onOpen?: () => void
}) {
  const descriptionId = useId()
  const enabled = onOpen !== undefined
  const body = (
    <>
      <span className="flex h-10 items-center gap-2 border-b border-pane-border pr-2.5 pl-3.5 font-mono text-[11.5px] text-muted-foreground">
        [{index}]─<span className="text-foreground">{tag}</span>
        <span className="flex-1" />
        {!enabled && (
          <span className="rounded-[4px] border border-dashed border-frame px-1.5 text-[10.5px] leading-[18px]">Under development</span>
        )}
      </span>
      <span className="flex flex-1 flex-col px-6 pt-6 pb-5">
        <span
          className={cn(
            'flex size-11 items-center justify-center rounded-[10px] border border-pane-border [&_svg]:size-5',
            enabled ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
          )}
        >
          {icon}
        </span>
        <span className="mt-5 font-mono text-[17px] font-semibold tracking-tight">{title}</span>
        <span id={descriptionId} className="mt-1.5 font-copy text-[12.5px] leading-[1.7] text-muted-foreground">
          {description}
        </span>
        <span className="flex-1" />
        <span className={cn('mt-6 flex items-center gap-1.5 font-mono text-[12px]', enabled ? 'text-foreground' : 'text-muted-foreground')}>
          {footer}
        </span>
      </span>
    </>
  )
  const card = 'pane flex h-[280px] flex-col overflow-hidden text-left'
  if (!enabled) {
    return (
      <div role="button" aria-disabled="true" aria-label={title} aria-describedby={descriptionId} className={cn(card, 'cursor-default opacity-75')}>
        {body}
      </div>
    )
  }
  return (
    <button
      type="button"
      aria-label={title}
      aria-describedby={descriptionId}
      onClick={onOpen}
      className={cn(
        card,
        'group/card transition-[translate,box-shadow,border-color] duration-150 outline-none hover:-translate-y-0.5 hover:border-frame hover:shadow-[0_14px_32px_-14px_rgb(20_35_48/0.35)] focus-visible:ring-2 focus-visible:ring-ring/50 dark:hover:shadow-[0_14px_32px_-14px_rgb(0_0_0/0.7)]'
      )}
    >
      {body}
    </button>
  )
}
