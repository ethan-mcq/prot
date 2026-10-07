import type { ReactNode } from 'react'
import { ListFilter } from 'lucide-react'
import type { GitHubUser } from '@shared/types'
import { changedFilterCount, DEFAULT_FILTERS, toggleAuthor, type InboxFilters, type OpenedWithin } from '@shared/inbox'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { PaneButton } from '@/components/pane'
import { UserAvatar } from '@/components/user-avatar'
import { cn } from '@/lib/utils'

const OPENED: { value: OpenedWithin; label: string }[] = [
  { value: 'any', label: 'Any time' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' }
]

export function InboxFilter({
  filters,
  authors,
  onChange
}: {
  filters: InboxFilters
  authors: GitHubUser[]
  onChange: (filters: InboxFilters) => void
}) {
  const changed = changedFilterCount(filters)
  const logins = authors.map((author) => author.login)
  return (
    <Popover>
      <PopoverTrigger asChild>
        <PaneButton aria-label="Filter pull requests" title="Filter pull requests" className={cn('relative', changed > 0 && 'text-foreground')}>
          <ListFilter />
          {changed > 0 && (
            <span
              aria-hidden
              className="absolute -top-0.5 -right-0.5 flex size-3 items-center justify-center rounded-full bg-primary font-mono text-[8.5px] leading-none text-primary-foreground"
            >
              {changed}
            </span>
          )}
        </PaneButton>
      </PopoverTrigger>
      <PopoverContent align="start" collisionPadding={10} className="w-72 space-y-4 p-4">
        <div className="space-y-1.5">
          <p className="font-mono text-[11.5px] text-muted-foreground">author</p>
          <div className="scroll-quiet -mx-1 max-h-48 space-y-px overflow-y-auto">
            <FilterCheck
              id="author-all"
              checked={filters.authors === 'all'}
              onChange={() => onChange({ ...filters, authors: 'all' })}
            >
              All authors
            </FilterCheck>
            {authors.map((author) => (
              <FilterCheck
                key={author.login}
                id={`author-${author.login}`}
                checked={filters.authors === 'all' || filters.authors.includes(author.login)}
                onChange={() => onChange(toggleAuthor(filters, author.login, logins))}
              >
                <span aria-hidden className="flex">
                  <UserAvatar user={author} className="size-4" />
                </span>
                <span className="truncate font-mono text-[12px]">{author.login}</span>
              </FilterCheck>
            ))}
          </div>
        </div>
        <div className="space-y-1.5">
          <p className="font-mono text-[11.5px] text-muted-foreground">opened</p>
          <div role="radiogroup" aria-label="Opened" className="grid grid-cols-4 rounded-[8px] bg-muted p-0.5">
            {OPENED.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={filters.opened === option.value}
                onClick={() => onChange({ ...filters, opened: option.value })}
                className={cn(
                  'rounded-[6px] py-1 text-[11.5px] whitespace-nowrap transition-colors',
                  filters.opened === option.value ? 'bg-card font-medium shadow-raised' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <Separator />
        <FilterSwitch
          id="show-drafts"
          label="Show drafts"
          checked={filters.showDrafts}
          onChange={(showDrafts) => onChange({ ...filters, showDrafts })}
        />
        <FilterSwitch
          id="group-stacks"
          label="Group stacks"
          checked={filters.groupStacks}
          onChange={(groupStacks) => onChange({ ...filters, groupStacks })}
        />
        <Separator />
        <Button
          variant="ghost"
          size="sm"
          className="w-full"
          disabled={changed === 0}
          onClick={() => onChange(DEFAULT_FILTERS)}
        >
          Reset filters
        </Button>
      </PopoverContent>
    </Popover>
  )
}

function FilterCheck({
  id,
  checked,
  onChange,
  children
}: {
  id: string
  checked: boolean
  onChange: () => void
  children: ReactNode
}) {
  return (
    <div className="flex items-center gap-2 rounded-[6px] px-1 py-1 hover:bg-accent">
      <Checkbox id={id} checked={checked} onCheckedChange={onChange} />
      <Label htmlFor={id} className="flex min-w-0 flex-1 items-center gap-1.5 text-[12.5px] font-normal">
        {children}
      </Label>
    </div>
  )
}

function FilterSwitch({
  id,
  label,
  checked,
  onChange
}: {
  id: string
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <Label htmlFor={id} className="text-sm">
        {label}
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  )
}
