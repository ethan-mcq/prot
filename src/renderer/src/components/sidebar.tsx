import { useMemo } from 'react'
import { ChevronRight, GitBranch, GitPullRequest, RefreshCw } from 'lucide-react'
import type { GitHubUser, InboxState, PullBucket, PullSummary } from '@shared/types'
import { pullKey } from '@shared/types'
import { buildInboxView, DEFAULT_FILTERS, inboxAuthors, type InboxEntry, type InboxGroup, type InboxUnit } from '@shared/inbox'
import { Skeleton } from '@/components/ui/skeleton'
import { Frame, PaneButton, PaneHeader } from '@/components/pane'
import { InboxFilter } from '@/components/inbox-filter'
import { SettingsMenu } from '@/components/settings-menu'
import { UserAvatar } from '@/components/user-avatar'
import { useCollapsed, useInboxFilters } from '@/lib/inbox-prefs'
import { relativeTime } from '@/lib/paths'
import { cn } from '@/lib/utils'

const SECTIONS: { bucket: PullBucket; title: string; empty: string }[] = [
  { bucket: 'review', title: 'Needs your review', empty: 'Nothing is waiting on you.' },
  { bucket: 'mine', title: 'Your pull requests', empty: 'You have no open pull requests.' }
]

type RowProps = { selected: string | null; onSelect: (pull: PullSummary) => void }
type Collapse = ReturnType<typeof useCollapsed>

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
  const [filters, setFilters] = useInboxFilters()
  const collapse = useCollapsed()
  const pulls = inbox?.pulls
  const view = useMemo(() => buildInboxView(pulls ?? [], filters, Date.now()), [pulls, filters])
  const authors = useMemo(() => inboxAuthors(pulls ?? []), [pulls])
  const loading = !inbox?.fetchedAt && !inbox?.error

  return (
    <aside className="pane flex w-[288px] shrink-0 flex-col">
      <PaneHeader
        icon={<GitPullRequest />}
        title="Pull requests"
        actions={
          <>
            <InboxFilter filters={filters} authors={authors} onChange={setFilters} />
            <PaneButton aria-label="Refresh pull requests" title="Refresh the pull request list (r)" onClick={onRefresh} disabled={refreshing}>
              <RefreshCw className={cn(refreshing && 'animate-spin')} />
            </PaneButton>
          </>
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
          const { groups, shown, total } = view[section.bucket]
          const key = `section:${section.bucket}`
          return (
            <Frame
              key={section.bucket}
              aria-label={section.title}
              index={i + 1}
              title={section.title}
              count={shown === total ? total : `${shown} of ${total}`}
              expanded={!collapse.isCollapsed(key)}
              onToggle={() => collapse.toggle(key)}
            >
              {loading ? (
                <div className="space-y-1.5 p-1">
                  <Skeleton className="h-[62px] rounded-[6px]" />
                  <Skeleton className="h-[62px] rounded-[6px]" />
                </div>
              ) : total === 0 ? (
                <p className="px-1.5 py-1 font-mono text-[11.5px] text-muted-foreground">{section.empty}</p>
              ) : shown === 0 ? (
                <div className="flex items-center justify-between gap-2 px-1.5 py-1 font-mono text-[11.5px] text-muted-foreground">
                  <p>No pull requests match these filters</p>
                  <button type="button" onClick={() => setFilters(DEFAULT_FILTERS)} className="shrink-0 text-foreground hover:underline">
                    Reset
                  </button>
                </div>
              ) : (
                groups.map((group) => (
                  <PullGroup key={group.key} group={group} collapse={collapse} selected={selected} onSelect={onSelect} />
                ))
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

function PullGroup({ group, collapse, ...row }: { group: InboxGroup; collapse: Collapse } & RowProps) {
  const units = (
    <ul className="space-y-px">
      {group.units.map((unit) => (
        <li key={unit.key}>
          {unit.members.length > 1 ? (
            <Stack unit={unit} collapse={collapse} {...row} />
          ) : (
            unit.members.map((member) => <PullRow key={pullKey(member.pull.ref)} entry={member} {...row} />)
          )}
        </li>
      ))}
    </ul>
  )
  if (group.state === 'open') return units

  const key = `group:${group.key}`
  const expanded = !collapse.isCollapsed(key)
  let count = 0
  for (const unit of group.units) count += unit.members.length
  return (
    <div role="group" aria-label="Drafts" className="mt-1 first:mt-0">
      <button
        type="button"
        aria-label="Drafts"
        aria-expanded={expanded}
        onClick={() => collapse.toggle(key)}
        className="flex w-full items-center gap-1 rounded-[3px] px-1 py-1 font-mono text-[11px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <ChevronRight aria-hidden className={cn('size-3 transition-transform', expanded && 'rotate-90')} />
        drafts
        <span className="tabular-nums">{count}</span>
        <span aria-hidden className="ml-1 flex-1 border-t border-dashed border-frame" />
      </button>
      {expanded && units}
    </div>
  )
}

function Stack({ unit, collapse, ...row }: { unit: InboxUnit; collapse: Collapse } & RowProps) {
  const key = `stack:${unit.key}`
  const expanded = !collapse.isCollapsed(key)
  const label = `stack · ${unit.members.length}`
  const members = expanded ? unit.members : unit.members.slice(0, 1)
  return (
    <div role="group" aria-label={label} className="py-0.5">
      <button
        type="button"
        aria-label={label}
        aria-expanded={expanded}
        onClick={() => collapse.toggle(key)}
        className="flex items-center gap-1 rounded-[3px] px-2 py-0.5 font-mono text-[10.5px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <ChevronRight aria-hidden className={cn('size-3 transition-transform', expanded && 'rotate-90')} />
        <GitBranch aria-hidden className="size-3" />
        {label}
        {!expanded && <span className="text-foreground">+{unit.members.length - 1}</span>}
      </button>
      <ul className="ml-2.5 space-y-px border-l border-frame">
        {members.map((member) => (
          <li key={pullKey(member.pull.ref)} style={{ paddingLeft: member.depth * 10 }}>
            <PullRow entry={member} {...row} />
          </li>
        ))}
      </ul>
    </div>
  )
}

function PullRow({ entry, selected, onSelect }: { entry: InboxEntry } & RowProps) {
  const { pull, stackedOn } = entry
  const key = pullKey(pull.ref)
  const isSelected = selected === key
  return (
    <button
      type="button"
      onClick={() => onSelect(pull)}
      aria-label={`${key} ${pull.title}`}
      aria-current={isSelected ? 'page' : undefined}
      className={cn(
        'relative w-full rounded-[6px] px-2 py-1.5 text-left transition-colors',
        isSelected ? 'bg-selection' : 'hover:bg-accent'
      )}
    >
      <div className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
        <span className={cn('shrink-0', isSelected ? 'text-foreground' : 'text-transparent')} aria-hidden>
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
      {stackedOn !== null && (
        <p className="mt-0.5 pl-3 font-mono text-[10.5px] text-muted-foreground/80">↳ stacked on #{stackedOn}</p>
      )}
    </button>
  )
}
