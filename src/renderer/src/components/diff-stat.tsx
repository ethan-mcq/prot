import { cn } from '@/lib/utils'

export function DiffStat({ additions, deletions, className }: { additions: number; deletions: number; className?: string }) {
  if (additions === 0 && deletions === 0) return null
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1.5 font-mono text-xs tabular-nums', className)}>
      {additions > 0 && <span className="text-added">+{additions}</span>}
      {deletions > 0 && <span className="text-removed">-{deletions}</span>}
    </span>
  )
}
