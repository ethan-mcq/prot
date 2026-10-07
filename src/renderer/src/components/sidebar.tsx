import { RefreshCw } from 'lucide-react'
import type { GitHubUser, InboxState, PullBucket, PullSummary } from '@shared/types'
import { pullKey } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Logo } from '@/components/logo'
import { SettingsMenu } from '@/components/settings-menu'
import { UserAvatar } from '@/components/user-avatar'
import { relativeTime } from '@/lib/paths'
import { cn } from '@/lib/utils'

const SECTIONS: { bucket: PullBucket; title: string; empty: string }[] = [
  { bucket: 'review', title: 'Needs your review', empty: 'Nothing is waiting on you.' },
  { bucket: 'mine', title: 'Your pull requests', empty: 'You have no open pull requests.' }
]

export function Sidebar({
  inbox,
  refreshing,
  onRefresh,
  selected,
  onSelect,
  user,
  onSignOut
}: {
  inbox: InboxState | null
  refreshing: boolean
  onRefresh: () => void
  selected: string | null
  onSelect: (pull: PullSummary) => void
  user: GitHubUser
  onSignOut: () => void
}) {
  const reviewCount = inbox?.pulls.filter((pull) => pull.bucket === 'review').length ?? 0
  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="drag-region flex h-12 shrink-0 items-center gap-2 pr-3 pl-20">
        <Logo className="size-6" />
        <span className="font-serif text-[17px] font-semibold tracking-tight">prot</span>
        {reviewCount > 0 && (
          <span
            className="rounded-full bg-primary px-1.5 font-mono text-[10.5px] leading-[18px] text-primary-foreground tabular-nums"
            title={`${reviewCount} waiting for your review`}
          >
            {reviewCount}
          </span>
        )}
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Refresh pull requests"
          title="Refresh (r)"
          onClick={onRefresh}
          disabled={refreshing}
          className="no-drag text-muted-foreground"
        >
          <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} />
        </Button>
      </div>
      <div className="scroll-quiet min-h-0 flex-1 space-y-6 overflow-y-auto px-3 pt-2 pb-4">
        {inbox?.error && (
          <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs">
            <p className="font-medium text-destructive">Could not refresh</p>
            <p className="mt-1 text-muted-foreground">{inbox.error}</p>
            <button type="button" onClick={onRefresh} className="mt-2 font-medium hover:underline">
              Try again
            </button>
          </div>
        )}
        {SECTIONS.map((section) => {
          const pulls = inbox?.pulls.filter((pull) => pull.bucket === section.bucket) ?? []
          return (
            <section key={section.bucket} aria-label={section.title}>
              <h2 className="micro-label mb-2 flex items-center justify-between px-1.5">
                {section.title}
                <span className="tabular-nums">{pulls.length}</span>
              </h2>
              {!inbox?.fetchedAt && !inbox?.error ? (
                <div className="space-y-2">
                  <Skeleton className="h-[86px] rounded-xl" />
                  <Skeleton className="h-[86px] rounded-xl" />
                </div>
              ) : pulls.length === 0 ? (
                <p className="px-1.5 text-xs text-muted-foreground">{section.empty}</p>
              ) : (
                <ul className="space-y-1">
                  {pulls.map((pull) => (
                    <li key={pullKey(pull.ref)}>
                      <PullCard pull={pull} selected={selected === pullKey(pull.ref)} onSelect={() => onSelect(pull)} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )
        })}
      </div>
      <div className="flex h-12 shrink-0 items-center gap-2 border-t border-sidebar-border px-3">
        <UserAvatar user={user} className="size-6" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{user.login}</span>
        <SettingsMenu onSignOut={onSignOut} />
      </div>
    </aside>
  )
}

function PullCard({ pull, selected, onSelect }: { pull: PullSummary; selected: boolean; onSelect: () => void }) {
  const key = pullKey(pull.ref)
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={`${key} ${pull.title}`}
      aria-current={selected ? 'page' : undefined}
      className={cn(
        'w-full rounded-xl border px-3 py-2.5 text-left transition-[background-color,border-color,box-shadow]',
        selected
          ? 'border-border bg-card shadow-soft'
          : 'border-transparent hover:border-sidebar-border hover:bg-sidebar-accent'
      )}
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-muted-foreground" title={key}>
          {pull.ref.owner}/{pull.ref.repo} #{pull.ref.number}
        </span>
        {pull.labels.length > 0 && (
          <span className="flex shrink-0 items-center gap-1">
            {pull.labels.slice(0, 3).map((label) => (
              <span
                key={label.name}
                title={label.name}
                className="size-2 rounded-full ring-1 ring-black/5 dark:ring-white/10"
                style={{ backgroundColor: `#${label.color}` }}
              />
            ))}
          </span>
        )}
      </div>
      <p className="mt-1 line-clamp-2 text-[13px] leading-[18px] font-medium">{pull.title}</p>
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <UserAvatar user={pull.author} className="size-4" />
        <span className="truncate">{pull.author.login}</span>
        <span aria-hidden>·</span>
        <span className="shrink-0">{relativeTime(pull.updatedAt)}</span>
        {pull.draft && (
          <span className="ml-auto shrink-0 rounded-full border px-1.5 text-[10px] leading-4 font-medium">Draft</span>
        )}
      </div>
    </button>
  )
}
