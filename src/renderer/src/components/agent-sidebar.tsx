import { useMemo, useState } from 'react'
import { Bot, FileText, ListFilter, Plus, RefreshCw } from 'lucide-react'
import type { AgentProvider, AgentsState, AgentSummary, ProviderInfo } from '@shared/agents'
import { AGENT_PROVIDERS, PROVIDER_NAMES } from '@shared/agents'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { DiffStat } from '@/components/diff-stat'
import { Frame, PaneButton, PaneHeader } from '@/components/pane'
import { PromptDialog } from '@/components/prompt-dialog'
import { PrBadge, ProviderMark, StatusDot, UnreadDot } from '@/components/agent-bits'
import { AGENT_SECTIONS, effortLabel, modelLabel, sectionAgents, useHiddenProviders } from '@/lib/agents'
import { useCollapsed } from '@/lib/inbox-prefs'
import { relativeTime } from '@/lib/paths'
import { cn } from '@/lib/utils'

export function AgentSidebar({
  state,
  error,
  refreshing,
  onRefresh,
  selected,
  onSelect,
  onNew
}: {
  state: AgentsState | null
  error: string | null
  refreshing: boolean
  onRefresh: () => void
  selected: string | null
  onSelect: (id: string) => void
  onNew: () => void
}) {
  const [hidden, setHidden] = useHiddenProviders()
  const collapse = useCollapsed()
  const agents = state?.agents
  const sections = useMemo(() => sectionAgents(agents ?? [], hidden), [agents, hidden])
  const providers = state?.providers ?? []

  return (
    <aside aria-label="Agents" className="pane flex w-[288px] shrink-0 flex-col">
      <PaneHeader
        icon={<Bot />}
        title="Agents"
        actions={
          <>
            <AgentFilter hidden={hidden} onChange={setHidden} />
            <PaneButton aria-label="Refresh agents" title="Re-detect CLIs, sign-in and outside sessions" onClick={onRefresh} disabled={refreshing}>
              <RefreshCw className={cn(refreshing && 'animate-spin')} />
            </PaneButton>
          </>
        }
      />
      <div className="shrink-0 px-2.5 pb-1">
        <button
          type="button"
          onClick={onNew}
          aria-current={selected === null ? 'page' : undefined}
          className={cn(
            'flex h-7 w-full items-center gap-1.5 rounded-[6px] border border-pane-border px-2 font-mono text-[11.5px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
            selected === null ? 'bg-selection text-foreground' : 'bg-muted/40 text-muted-foreground hover:bg-accent hover:text-foreground'
          )}
        >
          <Plus aria-hidden className="size-3.5" />
          New agent
        </button>
      </div>
      <div className="scroll-quiet min-h-0 flex-1 space-y-5 overflow-y-auto px-2.5 pt-3 pb-3">
        {error && (
          <div role="alert" className="rounded-[6px] border border-destructive/30 bg-destructive/5 p-2.5 font-mono text-[11.5px]">
            <p className="text-destructive">! could not load agents</p>
            <p className="mt-1 text-muted-foreground">{error}</p>
            <button type="button" onClick={onRefresh} className="mt-1.5 text-foreground hover:underline">
              try again
            </button>
          </div>
        )}
        {AGENT_SECTIONS.map((section, i) => {
          const { agents: shown, total } = sections[section.id]
          const key = `agents:${section.id}`
          if (section.empty === null && total === 0) return null
          return (
            <Frame
              key={section.id}
              aria-label={section.title}
              index={i + 1}
              title={section.title}
              count={shown.length === total ? total : `${shown.length} of ${total}`}
              expanded={!collapse.isCollapsed(key)}
              onToggle={() => collapse.toggle(key)}
            >
              {state === null ? (
                <div className="space-y-1.5 p-1">
                  <Skeleton className="h-[62px] rounded-[6px]" />
                </div>
              ) : total === 0 ? (
                <p className="px-1.5 py-1 font-mono text-[11.5px] text-muted-foreground">{section.empty}</p>
              ) : shown.length === 0 ? (
                <div className="flex items-center justify-between gap-2 px-1.5 py-1 font-mono text-[11.5px] text-muted-foreground">
                  <p>No agents match these filters</p>
                  <button type="button" onClick={() => setHidden([])} className="shrink-0 text-foreground hover:underline">
                    Reset
                  </button>
                </div>
              ) : (
                <ul className="space-y-px">
                  {shown.map((agent) => (
                    <li key={agent.id}>
                      <AgentCard agent={agent} providers={providers} selected={selected === agent.id} onSelect={onSelect} />
                    </li>
                  ))}
                </ul>
              )}
            </Frame>
          )
        })}
      </div>
      <AgentPromptBar />
    </aside>
  )
}

function AgentCard({
  agent,
  providers,
  selected,
  onSelect
}: {
  agent: AgentSummary
  providers: ProviderInfo[]
  selected: boolean
  onSelect: (id: string) => void
}) {
  const model = modelLabel(providers, agent.provider, agent.model)
  const where = [agent.repoName, agent.branch].filter(Boolean).join(' · ')
  return (
    <button
      type="button"
      onClick={() => onSelect(agent.id)}
      aria-label={agent.title}
      aria-current={selected ? 'page' : undefined}
      className={cn('relative w-full rounded-[6px] px-2 py-1.5 text-left transition-colors', selected ? 'bg-selection' : 'hover:bg-accent')}
    >
      <div className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
        <span className={cn('shrink-0', selected ? 'text-foreground' : 'text-transparent')} aria-hidden>
          ›
        </span>
        <StatusDot status={agent.status} />
        <span className="min-w-0 flex-1 truncate" title={agent.cwd}>
          {where || agent.cwd}
        </span>
        {agent.unread && <UnreadDot />}
      </div>
      <p className={cn('mt-0.5 line-clamp-2 pl-3 text-[12.5px] leading-[17px]', agent.unread ? 'font-semibold' : 'font-medium')}>
        {agent.title}
      </p>
      <div className="mt-1 flex items-center gap-1.5 pl-3 font-mono text-[10.5px] text-muted-foreground">
        <ProviderMark provider={agent.provider} />
        <span className="min-w-0 truncate">
          {model ?? PROVIDER_NAMES[agent.provider]}
          {agent.effort && ` · ${effortLabel(agent.effort).toLowerCase()}`}
        </span>
        <span aria-hidden>·</span>
        <span className="shrink-0">{relativeTime(agent.updatedAt)}</span>
      </div>
      {(agent.pr || (agent.changes && (agent.changes.additions > 0 || agent.changes.deletions > 0))) && (
        <div className="mt-0.5 flex items-center gap-2 pl-3 text-[10.5px]">
          {agent.pr && <PrBadge pr={agent.pr} />}
          {agent.changes && <DiffStat additions={agent.changes.additions} deletions={agent.changes.deletions} className="text-[10.5px]" />}
        </div>
      )}
    </button>
  )
}

function AgentFilter({ hidden, onChange }: { hidden: AgentProvider[]; onChange: (hidden: AgentProvider[]) => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <PaneButton aria-label="Filter agents" title="Filter agents" className={cn('relative', hidden.length > 0 && 'text-foreground')}>
          <ListFilter />
          {hidden.length > 0 && (
            <span
              aria-hidden
              className="absolute -top-0.5 -right-0.5 flex size-3 items-center justify-center rounded-full bg-primary font-mono text-[8.5px] leading-none text-primary-foreground"
            >
              {hidden.length}
            </span>
          )}
        </PaneButton>
      </PopoverTrigger>
      <PopoverContent align="start" collisionPadding={10} className="w-60 space-y-4 p-4">
        <div className="space-y-1.5">
          <p className="font-mono text-[11.5px] text-muted-foreground">provider</p>
          <div className="-mx-1 space-y-px">
            {AGENT_PROVIDERS.map((provider) => (
              <div key={provider} className="flex items-center gap-2 rounded-[6px] px-1 py-1 hover:bg-accent">
                <Checkbox
                  id={`agent-provider-${provider}`}
                  checked={!hidden.includes(provider)}
                  onCheckedChange={() =>
                    onChange(hidden.includes(provider) ? hidden.filter((p) => p !== provider) : [...hidden, provider])
                  }
                />
                <Label htmlFor={`agent-provider-${provider}`} className="flex min-w-0 flex-1 items-center gap-1.5 text-[12.5px] font-normal">
                  <ProviderMark provider={provider} />
                  {PROVIDER_NAMES[provider]}
                </Label>
              </div>
            ))}
          </div>
        </div>
        <Separator />
        <Button variant="ghost" size="sm" className="w-full" disabled={hidden.length === 0} onClick={() => onChange([])}>
          Reset filters
        </Button>
      </PopoverContent>
    </Popover>
  )
}

function AgentPromptBar() {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-t border-pane-border pr-2 pl-3">
      <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-muted-foreground">agent prompt</span>
      <PaneButton aria-label="Agent system prompt" title="Agent system prompt and skills folder" onClick={() => setOpen(true)}>
        <FileText />
      </PaneButton>
      <PromptDialog open={open} onOpenChange={setOpen} initialKind="agent" />
    </div>
  )
}
