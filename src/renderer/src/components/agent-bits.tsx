import { Aperture, Asterisk, GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft } from 'lucide-react'
import type { AgentPr, AgentProvider, AgentStatus } from '@shared/agents'
import { cn } from '@/lib/utils'

export function ProviderMark({ provider, className }: { provider: AgentProvider; className?: string }) {
  const Icon = provider === 'claude' ? Asterisk : Aperture
  return (
    <Icon
      aria-hidden
      strokeWidth={provider === 'claude' ? 2.75 : 2}
      className={cn('size-3 shrink-0', provider === 'claude' ? 'text-[#d97757]' : 'text-foreground/75', className)}
    />
  )
}

export const STATUS_TEXT: Record<AgentStatus, string> = {
  running: 'running',
  idle: 'idle',
  failed: 'failed',
  stopped: 'stopped'
}

export function StatusDot({ status, className }: { status: AgentStatus; className?: string }) {
  return (
    <span aria-hidden className={cn('relative flex size-2 shrink-0', className)}>
      {status === 'running' && <span className="absolute inset-0 animate-ping rounded-full bg-added-mark/60" />}
      <span
        className={cn(
          'relative size-2 rounded-full',
          status === 'running' && 'bg-added-mark',
          status === 'idle' && 'bg-muted-foreground/45',
          status === 'failed' && 'bg-removed-mark',
          status === 'stopped' && 'border border-muted-foreground/60'
        )}
      />
    </span>
  )
}

export function UnreadDot({ className }: { className?: string }) {
  return <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full bg-command', className)} />
}

const PR_TONE = {
  open: { icon: GitPullRequest, text: 'text-added' },
  draft: { icon: GitPullRequestDraft, text: 'text-muted-foreground' },
  merged: { icon: GitMerge, text: 'text-command' },
  closed: { icon: GitPullRequestClosed, text: 'text-removed' }
} as const

export function PrIcon({ pr, className }: { pr: AgentPr; className?: string }) {
  const tone = PR_TONE[pr.state]
  return <tone.icon aria-hidden className={cn('size-3 shrink-0', tone.text, className)} />
}

export function PrBadge({ pr, className }: { pr: AgentPr; className?: string }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 font-mono tabular-nums', PR_TONE[pr.state].text, className)}>
      <PrIcon pr={pr} className="size-2.5" />#{pr.number}
      <span className="text-muted-foreground">{pr.state}</span>
    </span>
  )
}
