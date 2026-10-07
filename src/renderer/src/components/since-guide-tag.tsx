import { cn } from '@/lib/utils'

export function SinceGuideTag({ compact = false }: { compact?: boolean }) {
  return (
    <span
      title="Changed since the guide was written"
      className={cn(
        'shrink-0 rounded-[4px] border border-current/25 px-1 font-mono text-[10px] leading-[15px] text-violet-600 dark:text-violet-300',
        compact && 'leading-[14px]'
      )}
    >
      {compact ? 'Δ guide' : 'changed since guide'}
    </span>
  )
}
