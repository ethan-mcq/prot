import { useEffect, useState, type ReactNode } from 'react'
import { ArrowUp, Bot, Folder, FolderGit2, GitBranch, LoaderCircle, Plus, RefreshCw, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import type { AgentPr, AgentRepo, AgentsState, AgentSummary, ProviderInfo } from '@shared/agents'
import { PROVIDER_NAMES } from '@shared/agents'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Frame, PaneButton, PaneHeader } from '@/components/pane'
import { PrIcon, ProviderMark } from '@/components/agent-bits'
import {
  chooseModel,
  effortLabel,
  formatReset,
  newestFirst,
  providerProblem,
  providerReady,
  readChoice,
  resolveChoice,
  runningFor,
  useNow,
  writeChoice,
  type AgentsStore,
  type ComposerChoice
} from '@/lib/agents'
import { cn, errorMessage } from '@/lib/utils'

const ADD_REPO = '__add_repo__'
const PICKER =
  'h-7 gap-1.5 rounded-[6px] border-0 bg-transparent px-2 font-mono text-[11.5px] text-muted-foreground shadow-none hover:bg-accent hover:text-foreground dark:bg-transparent dark:hover:bg-accent'

export function AgentDash({
  store,
  onSelect,
  onOpenPull
}: {
  store: AgentsStore
  onSelect: (id: string) => void
  onOpenPull: (pr: AgentPr) => void
}) {
  const { state, refreshing, refresh } = store
  const [choice, setChoice] = useState<ComposerChoice | null>(null)
  const providers = state?.providers
  const repos = state?.repos
  const running = state?.agents.filter((agent) => agent.status === 'running').length ?? 0

  // Providers and repos arrive or change after a refresh; keep the choice valid against them.
  useEffect(() => {
    if (!providers || !repos) return
    setChoice((prev) => resolveChoice(providers, repos, prev ?? readChoice()))
  }, [providers, repos])

  function update(patch: Partial<ComposerChoice>) {
    setChoice((prev) => {
      if (!prev) return prev
      const next = { ...prev, ...patch }
      writeChoice(next)
      return next
    })
  }

  return (
    <div className="pane flex h-full flex-col">
      <PaneHeader
        icon={<Bot />}
        title="Agent dash"
        detail={`${running} running`}
        actions={
          <PaneButton aria-label="Refresh agents" title="Re-detect CLIs, sign-in and outside sessions" onClick={() => void refresh()} disabled={refreshing}>
            <RefreshCw className={cn(refreshing && 'animate-spin')} />
          </PaneButton>
        }
      />
      <div className="scroll-quiet @container min-h-0 flex-1 overflow-y-auto px-5 pb-8">
        <h1 className="mt-10 text-center font-mono text-[20px] font-semibold tracking-tight">What should your agents work on?</h1>
        {state ? (
          <Composer state={state} store={store} choice={choice} onChange={update} onStarted={onSelect} />
        ) : (
          <div className="mx-auto mt-6 h-[132px] w-full max-w-[680px] animate-pulse rounded-[10px] border border-pane-border bg-muted/40" />
        )}
        {state && (
          <div className="mx-auto mt-10 grid max-w-[1100px] grid-cols-1 gap-x-4 gap-y-6 @3xl:grid-cols-2">
            <WorkingTile state={state} onSelect={onSelect} />
            <PullsTile agents={state.agents} onOpenPull={onOpenPull} />
            <SubscriptionsTile providers={state.providers} />
            <WorktreesTile agents={state.agents} onSelect={onSelect} onRemoved={() => void store.reload()} />
            <ReposTile repos={state.repos} onUse={(repoPath) => update({ repoPath })} />
          </div>
        )}
      </div>
    </div>
  )
}

function Composer({
  state,
  store,
  choice,
  onChange,
  onStarted
}: {
  state: AgentsState
  store: AgentsStore
  choice: ComposerChoice | null
  onChange: (patch: Partial<ComposerChoice>) => void
  onStarted: (id: string) => void
}) {
  const [prompt, setPrompt] = useState('')
  const [starting, setStarting] = useState(false)
  const info = state.providers.find((p) => p.provider === choice?.provider)
  const ready = choice !== null && info !== undefined && providerReady(info) && choice.repoPath !== null && prompt.trim().length > 0 && !starting

  async function addRepo() {
    try {
      const repo = await window.prot.agents.addRepo()
      if (!repo) return
      store.addRepo(repo)
      onChange({ repoPath: repo.path })
    } catch (error) {
      toast.error('Could not add the repo', { description: errorMessage(error) })
    }
  }

  async function start() {
    if (!ready || !choice || choice.repoPath === null) return
    setStarting(true)
    try {
      const agent = await window.prot.agents.start({
        provider: choice.provider,
        repoPath: choice.repoPath,
        prompt: prompt.trim(),
        model: choice.model,
        effort: choice.effort,
        permission: choice.permission,
        worktree: choice.worktree
      })
      store.upsert(agent)
      setPrompt('')
      onStarted(agent.id)
    } catch (error) {
      toast.error('Could not start the agent', { description: errorMessage(error) })
    } finally {
      setStarting(false)
    }
  }

  const anyReady = state.providers.some(providerReady)
  return (
    <div className="mx-auto mt-6 w-full max-w-[680px]">
      <div className="rounded-[10px] border border-pane-border bg-muted/40 p-1.5 transition-colors focus-within:border-frame">
        <Textarea
          autoFocus
          aria-label="Task"
          placeholder="Describe a task, a bug to fix, an idea to try…"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              void start()
            }
          }}
          rows={3}
          className="max-h-60 min-h-[76px] resize-none border-0 bg-transparent px-2 py-1.5 font-mono text-[12.5px] leading-5 shadow-none focus-visible:ring-0 dark:bg-transparent"
        />
        <div className="flex flex-wrap items-center gap-0.5 pt-1">
          <RepoPicker repos={state.repos} value={choice?.repoPath ?? null} onChange={(repoPath) => onChange({ repoPath })} onAdd={() => void addRepo()} />
          <Select value={choice?.worktree === false ? 'local' : 'worktree'} onValueChange={(value) => onChange({ worktree: value === 'worktree' })}>
            <SelectTrigger aria-label="Checkout" size="sm" className={PICKER}>
              <GitBranch aria-hidden className="size-3.5" />
              {choice?.worktree === false ? 'Local checkout' : 'New worktree'}
            </SelectTrigger>
            <SelectContent position="popper" align="start">
              <SelectItem value="worktree">New worktree</SelectItem>
              <SelectItem value="local">Local checkout</SelectItem>
            </SelectContent>
          </Select>
          {choice && info && <ModelPicker providers={state.providers} choice={choice} onChange={onChange} />}
          {choice && info && <EffortPicker info={info} choice={choice} onChange={onChange} />}
          {choice && info && <PermissionPicker info={info} choice={choice} onChange={onChange} />}
          <span className="flex-1" />
          <Button
            size="icon-sm"
            aria-label="Start agent"
            title="Start agent (⌘↵)"
            disabled={!ready}
            onClick={() => void start()}
            className="size-7 rounded-[7px]"
          >
            {starting ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
          </Button>
        </div>
      </div>
      <p className="mt-1.5 px-1 font-mono text-[10.5px] text-muted-foreground">
        {!anyReady
          ? 'Sign in to Claude Code or Codex in a terminal, then refresh.'
          : choice?.repoPath === null
            ? 'Add a repo to start an agent in it.'
            : '⌘↵ to start'}
      </p>
    </div>
  )
}

function RepoPicker({
  repos,
  value,
  onChange,
  onAdd
}: {
  repos: AgentRepo[]
  value: string | null
  onChange: (path: string) => void
  onAdd: () => void
}) {
  const current = repos.find((repo) => repo.path === value)
  return (
    <Select
      value={value ?? ''}
      onValueChange={(next) => {
        if (next === ADD_REPO) onAdd()
        else onChange(next)
      }}
    >
      <SelectTrigger aria-label="Repository" size="sm" className={cn(PICKER, !current && 'text-foreground')} title={current?.path}>
        <Folder aria-hidden className="size-3.5" />
        {current?.name ?? 'Choose repo'}
      </SelectTrigger>
      <SelectContent position="popper" align="start" className="max-w-[360px]">
        {repos.map((repo) => (
          <SelectItem key={repo.path} value={repo.path} title={repo.path}>
            <span className="font-mono text-[12px]">{repo.name}</span>
            {repo.branch && <span className="font-mono text-[11px] text-muted-foreground">{repo.branch}</span>}
          </SelectItem>
        ))}
        {repos.length > 0 && <SelectSeparator />}
        <SelectItem value={ADD_REPO}>
          <Plus aria-hidden className="size-3.5" />
          Add repo…
        </SelectItem>
      </SelectContent>
    </Select>
  )
}

function ModelPicker({
  providers,
  choice,
  onChange
}: {
  providers: ProviderInfo[]
  choice: ComposerChoice
  onChange: (patch: Partial<ComposerChoice>) => void
}) {
  const info = providers.find((p) => p.provider === choice.provider)
  const label = info?.models.find((m) => m.id === choice.model)?.label ?? choice.model
  return (
    <Select
      value={`${choice.provider}::${choice.model}`}
      onValueChange={(value) => {
        const [provider, model] = value.split('::')
        const next = providers.find((p) => p.provider === provider)
        if (!next || model === undefined) return
        const same = next.provider === choice.provider
        const picked = chooseModel(next, model, same ? choice.effort : undefined)
        onChange({
          provider: next.provider,
          ...picked,
          permission: same ? choice.permission : next.defaultPermission
        })
      }}
    >
      <SelectTrigger aria-label="Model" size="sm" className={cn(PICKER, 'text-foreground')}>
        <ProviderMark provider={choice.provider} className="size-3.5" />
        {PROVIDER_NAMES[choice.provider]}
        <span className="text-muted-foreground">{label}</span>
      </SelectTrigger>
      <SelectContent position="popper" align="start">
        {providers.map((p, i) => {
          const problem = providerProblem(p)
          return (
            <SelectGroup key={p.provider}>
              {i > 0 && <SelectSeparator />}
              <SelectLabel className="flex items-center gap-1.5 font-mono text-[11px]">
                <ProviderMark provider={p.provider} />
                {PROVIDER_NAMES[p.provider]}
              </SelectLabel>
              {problem ? (
                <SelectItem value={`${p.provider}::__unavailable__`} disabled>
                  <span className="font-mono text-[11.5px]">{problem}</span>
                </SelectItem>
              ) : (
                p.models.map((model) => (
                  <SelectItem key={model.id} value={`${p.provider}::${model.id}`}>
                    {model.label}
                  </SelectItem>
                ))
              )}
            </SelectGroup>
          )
        })}
      </SelectContent>
    </Select>
  )
}

function EffortPicker({
  info,
  choice,
  onChange
}: {
  info: ProviderInfo
  choice: ComposerChoice
  onChange: (patch: Partial<ComposerChoice>) => void
}) {
  const efforts = info.models.find((m) => m.id === choice.model)?.efforts ?? []
  return (
    <Select value={choice.effort} disabled={efforts.length === 0} onValueChange={(effort) => onChange({ effort })}>
      <SelectTrigger aria-label="Effort" title="How hard the model thinks" size="sm" className={PICKER}>
        {efforts.length === 0 ? 'effort n/a' : effortLabel(choice.effort)}
      </SelectTrigger>
      <SelectContent position="popper" align="start">
        {efforts.map((effort) => (
          <SelectItem key={effort} value={effort}>
            {effortLabel(effort)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function PermissionPicker({
  info,
  choice,
  onChange
}: {
  info: ProviderInfo
  choice: ComposerChoice
  onChange: (patch: Partial<ComposerChoice>) => void
}) {
  const current = info.permissions.find((p) => p.id === choice.permission)
  return (
    <Select value={choice.permission} onValueChange={(permission) => onChange({ permission })}>
      <SelectTrigger aria-label="Permissions" title={current?.hint} size="sm" className={PICKER}>
        <ShieldCheck aria-hidden className="size-3.5" />
        {current?.label ?? choice.permission}
      </SelectTrigger>
      <SelectContent position="popper" align="start" className="max-w-[320px]">
        {info.permissions.map((permission) => (
          <SelectItem key={permission.id} value={permission.id} className="items-start">
            <span className="flex flex-col gap-0.5">
              <span>{permission.label}</span>
              <span className="text-[11px] leading-4 whitespace-normal text-muted-foreground">{permission.hint}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function Tile({ index, title, count, children }: { index: number; title: string; count?: ReactNode; children: ReactNode }) {
  return (
    <Frame aria-label={title} index={index} title={title} count={count} className="min-w-0 self-start">
      {children}
    </Frame>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-1.5 py-1 font-mono text-[11.5px] text-muted-foreground">{children}</p>
}

const ROW = 'flex w-full min-w-0 items-center gap-2 rounded-[6px] px-2 py-1.5 text-left transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50'

function WorkingTile({ state, onSelect }: { state: AgentsState; onSelect: (id: string) => void }) {
  const running = newestFirst(state.agents.filter((agent) => agent.status === 'running'))
  const now = useNow(1000, running.length > 0)
  return (
    <Tile index={1} title="Working now" count={running.length}>
      {running.length === 0 ? (
        <Empty>Nothing is running.</Empty>
      ) : (
        <ul className="space-y-px">
          {running.map((agent) => (
            <li key={agent.id}>
              <button type="button" aria-label={agent.title} onClick={() => onSelect(agent.id)} className={cn(ROW, 'items-start')}>
                <LoaderCircle aria-hidden className="mt-0.5 size-3.5 shrink-0 animate-spin text-command" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{agent.title}</span>
                    <ProviderMark provider={agent.provider} />
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
                      {runningFor(agent, now)}
                    </span>
                  </span>
                  {agent.lastMessage && (
                    <span className="mt-0.5 block truncate font-mono text-[10.5px] text-muted-foreground" title={agent.lastMessage}>
                      {agent.lastMessage}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Tile>
  )
}

function PullsTile({ agents, onOpenPull }: { agents: AgentSummary[]; onOpenPull: (pr: AgentPr) => void }) {
  const seen = new Set<string>()
  const pulls: AgentPr[] = []
  for (const agent of newestFirst(agents)) {
    if (!agent.pr || seen.has(agent.pr.url)) continue
    seen.add(agent.pr.url)
    pulls.push(agent.pr)
  }
  return (
    <Tile index={2} title="Pull requests" count={pulls.length}>
      {pulls.length === 0 ? (
        <Empty>No agent branch has a pull request yet.</Empty>
      ) : (
        <ul className="space-y-px">
          {pulls.map((pr) => (
            <li key={pr.url}>
              <button
                type="button"
                aria-label={`Open pull request ${pr.owner}/${pr.repo}#${pr.number}`}
                title={pr.title}
                onClick={() => onOpenPull(pr)}
                className={ROW}
              >
                <PrIcon pr={pr} className="size-3.5" />
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{pr.title}</span>
                <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">
                  {pr.repo}#{pr.number}
                </span>
                <span className="w-12 shrink-0 text-right font-mono text-[10.5px] text-muted-foreground">{pr.state}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Tile>
  )
}

function SubscriptionsTile({ providers }: { providers: ProviderInfo[] }) {
  const now = useNow(60000)
  return (
    <Tile index={3} title="Subscriptions" count={providers.filter(providerReady).length}>
      <ul className="space-y-3 px-1.5 py-1">
        {providers.map((info) => {
          const problem = providerProblem(info)
          return (
            <li key={info.provider} aria-label={PROVIDER_NAMES[info.provider]}>
              <div className="flex items-center gap-1.5">
                <ProviderMark provider={info.provider} className="size-3.5" />
                <span className="text-[12.5px] font-medium">{PROVIDER_NAMES[info.provider]}</span>
                <span className="flex-1" />
                {info.version && <span className="font-mono text-[10.5px] text-muted-foreground">v{info.version.replace(/^v/, '')}</span>}
              </div>
              <p className={cn('mt-0.5 pl-5 font-mono text-[10.5px]', problem ? 'text-modified' : 'text-muted-foreground')}>
                {problem ?? ['signed in', info.account].filter(Boolean).join(' · ')}
              </p>
              {info.usage.length > 0 && (
                <div className="mt-1.5 space-y-1 pl-5">
                  {info.usage.map((window) => {
                    const used = Math.max(0, Math.min(100, Math.round(window.usedPercent)))
                    const reset = formatReset(window.resetsAt, now)
                    return (
                      <div key={window.label} className="flex items-center gap-2 font-mono text-[10.5px] text-muted-foreground">
                        <span className="w-14 shrink-0 truncate" title={window.label}>
                          {window.label}
                        </span>
                        <div
                          role="meter"
                          aria-label={`${PROVIDER_NAMES[info.provider]} ${window.label} usage`}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={used}
                          className="h-1 min-w-10 flex-1 overflow-hidden rounded-full bg-muted"
                        >
                          <div
                            className={cn('h-full rounded-full', used >= 90 ? 'bg-removed-mark' : used >= 70 ? 'bg-modified' : 'bg-foreground/55')}
                            style={{ width: `${used}%` }}
                          />
                        </div>
                        <span className="w-8 shrink-0 text-right tabular-nums">{used}%</span>
                        {reset && <span className="w-[104px] shrink-0 truncate">{reset}</span>}
                      </div>
                    )
                  })}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </Tile>
  )
}

function WorktreesTile({
  agents,
  onSelect,
  onRemoved
}: {
  agents: AgentSummary[]
  onSelect: (id: string) => void
  onRemoved: () => void
}) {
  const [confirming, setConfirming] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const withTree = newestFirst(agents.filter((agent) => agent.worktree !== null))

  async function remove(id: string) {
    setRemoving(id)
    try {
      await window.prot.agents.removeWorktree(id)
      onRemoved()
    } catch (error) {
      toast.error('Could not remove the worktree', { description: errorMessage(error) })
    } finally {
      setRemoving(null)
      setConfirming(null)
    }
  }

  return (
    <Tile index={4} title="Worktrees" count={withTree.length}>
      {withTree.length === 0 ? (
        <Empty>No agent worktrees.</Empty>
      ) : (
        <ul className="space-y-px">
          {withTree.map((agent) => {
            const tree = agent.worktree
            if (!tree) return null
            return (
              <li key={agent.id} className="group/row flex items-center gap-1 rounded-[6px] pr-1 hover:bg-accent">
                <button
                  type="button"
                  aria-label={`Worktree ${tree.branch}`}
                  onClick={() => onSelect(agent.id)}
                  className="flex min-w-0 flex-1 items-start gap-2 rounded-[6px] px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <FolderGit2 aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 font-mono text-[11.5px]">
                      <span className="min-w-0 truncate font-medium">{tree.branch}</span>
                      <span className="shrink-0 text-muted-foreground">from {tree.base}</span>
                    </span>
                    <span className="block truncate font-mono text-[10.5px] text-muted-foreground" title={tree.path}>
                      {tree.path}
                    </span>
                  </span>
                </button>
                {confirming === agent.id ? (
                  <span className="flex shrink-0 items-center gap-1">
                    <Button
                      size="xs"
                      variant="destructive"
                      aria-label={`Confirm remove worktree ${tree.branch}`}
                      disabled={removing === agent.id}
                      onClick={() => void remove(agent.id)}
                    >
                      {removing === agent.id && <LoaderCircle className="animate-spin" />}
                      Remove
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => setConfirming(null)}>
                      Keep
                    </Button>
                  </span>
                ) : (
                  <Button
                    size="xs"
                    variant="ghost"
                    aria-label={`Remove worktree ${tree.branch}`}
                    title={agent.status === 'running' ? 'Stop the agent first' : 'Delete the worktree folder; the branch stays'}
                    disabled={agent.status === 'running'}
                    onClick={() => setConfirming(agent.id)}
                    className="shrink-0 font-mono text-[11px] text-muted-foreground opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"
                  >
                    remove
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Tile>
  )
}

function ReposTile({ repos, onUse }: { repos: AgentRepo[]; onUse: (path: string) => void }) {
  return (
    <Tile index={5} title="Recent repos" count={repos.length}>
      {repos.length === 0 ? (
        <Empty>Add a repo from the composer.</Empty>
      ) : (
        <ul className="space-y-px">
          {repos.map((repo) => (
            <li key={repo.path}>
              <button type="button" aria-label={`Use ${repo.name}`} title={repo.path} onClick={() => onUse(repo.path)} className={ROW}>
                <Folder aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="shrink-0 font-mono text-[12px] font-medium">{repo.name}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-muted-foreground">{repo.path}</span>
                {repo.branch && (
                  <span className="flex max-w-[40%] shrink-0 items-center gap-1 font-mono text-[10.5px] text-muted-foreground">
                    <GitBranch aria-hidden className="size-3" />
                    <span className="truncate">{repo.branch}</span>
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Tile>
  )
}

