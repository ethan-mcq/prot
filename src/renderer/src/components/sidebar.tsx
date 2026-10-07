import { GitPullRequest, RefreshCw } from 'lucide-react'
import type { GitHubUser, InboxState, PullBucket, PullSummary } from '@shared/types'
import { pullKey } from '@shared/types'
import { Skeleton } from '@/components/ui/skeleton'
import { Frame, PaneButton, PaneHeader } from '@/components/pane'
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
  return (
    <aside className="pane flex w-[288px] shrink-0 flex-col">
      <PaneHeader
        icon={<GitPullRequest />}
        title="Pull requests"
        actions={
          <PaneButton aria-label="Refresh pull requests" title="Refresh the pull request list (r)" onClick={onRefresh} disabled={refreshing}>
            <RefreshCw className={cn(refreshing && 'animate-spin')} />
          </PaneButton>
        }
      />
      <div className="scroll-quiet min-h-0 flex-1 space-y-5 overflow-y-auto px-2.5 pt-3 pb-3">
        {inbox?.error && (
          <div role="alert" className="rounded-[6px] border border-destructive/30 bg-destructive/5 p-2.5 font-mono text-[11.5px]">
            <p className="text-destructive">! could not refresh</p>
            <p className="mt-1 text-muted-foreground">{inbox.error}</p>
            <button type="button" onClick={onRefresh} className="mt-1.5 text-foreground hover:underline">
              try again
            </button>
          </div>
        )}
        {SECTIONS.map((section, i) => {
          const pulls = inbox?.pulls.filter((pull) => pull.bucket === section.bucket) ?? []
          return (
            <Frame key={section.bucket} aria-label={section.title} index={i + 1} title={section.title} count={pulls.length}>
              {!inbox?.fetchedAt && !inbox?.error ? (
                <div className="space-y-1.5 p-1">
                  <Skeleton className="h-[62px] rounded-[6px]" />
                  <Skeleton className="h-[62px] rounded-[6px]" />
                </div>
              ) : pulls.length === 0 ? (
                <p className="px-1.5 py-1 font-mono text-[11.5px] text-muted-foreground">{section.empty}</p>
              ) : (
                <ul className="space-y-px">
                  {pulls.map((pull) => (
                    <li key={pullKey(pull.ref)}>
                      <PullRow pull={pull} selected={selected === pullKey(pull.ref)} onSelect={() => onSelect(pull)} />
                    </li>
                  ))}
                </ul>
              )}
            </Frame>
          )
        })}
      </div>
      <div className="flex h-11 shrink-0 items-center gap-2 border-t border-pane-border pr-2 pl-3">
        <UserAvatar user={user} className="size-5" />
        <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{user.login}</span>
        <SettingsMenu onSignOut={onSignOut} />
      </div>
    </aside>
  )
}

function PullRow({ pull, selected, onSelect }: { pull: PullSummary; selected: boolean; onSelect: () => void }) {
  const key = pullKey(pull.ref)
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={`${key} ${pull.title}`}
      aria-current={selected ? 'page' : undefined}
      className={cn(
        'relative w-full rounded-[6px] px-2 py-1.5 text-left transition-colors',
        selected ? 'bg-selection' : 'hover:bg-accent'
      )}
    >
      <div className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
        <span className={cn('shrink-0', selected ? 'text-foreground' : 'text-transparent')} aria-hidden>
          ›
        </span>
        <span className="min-w-0 flex-1 truncate" title={key}>
          {pull.ref.owner}/{pull.ref.repo}#{pull.ref.number}
        </span>
        {pull.draft && <span className="shrink-0 text-modified">draft</span>}
        {pull.labels.slice(0, 3).map((label) => (
          <span
            key={label.name}
            title={label.name}
            className="size-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: `#${label.color}` }}
          />
        ))}
      </div>
      <p className="mt-0.5 line-clamp-2 pl-3 text-[12.5px] leading-[17px] font-medium">{pull.title}</p>
      <div className="mt-1 flex items-center gap-1.5 pl-3 font-mono text-[10.5px] text-muted-foreground">
        <UserAvatar user={pull.author} className="size-3.5" />
        <span className="truncate">{pull.author.login}</span>
        <span aria-hidden>·</span>
        <span className="shrink-0">{relativeTime(pull.updatedAt)}</span>
      </div>
    </button>
  )
}
