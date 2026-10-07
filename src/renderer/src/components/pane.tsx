import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function PaneHeader({
  icon,
  title,
  detail,
  actions,
  className
}: {
  icon?: ReactNode
  title: ReactNode
  detail?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <header className={cn('flex h-10 shrink-0 items-center gap-2 pr-2 pl-3.5', className)}>
      {icon && <span className="flex shrink-0 text-muted-foreground [&_svg]:size-3.5">{icon}</span>}
      <span className="min-w-0 truncate text-[12.5px] font-medium">
        {title}
        {detail && <span className="font-normal text-muted-foreground"> | {detail}</span>}
      </span>
      <span className="flex-1" />
      {actions && <span className="flex shrink-0 items-center gap-0.5">{actions}</span>}
    </header>
  )
}

export function PaneButton({ className, ...props }: ComponentProps<'button'>) {
  return (
    <button
      type="button"
      className={cn(
        'flex size-6 items-center justify-center rounded-[6px] text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-3.5',
        className
      )}
      {...props}
    />
  )
}

export function Frame({
  index,
  title,
  count,
  className,
  children,
  ...props
}: { index: number; title: string; count?: number } & ComponentProps<'section'>) {
  return (
    <section className={cn('relative rounded-[3px] border border-frame px-1.5 pt-3 pb-1.5', className)} {...props}>
      <h2 className="absolute -top-[9px] left-2 flex items-center bg-card px-1 font-mono text-[11.5px] leading-4 text-muted-foreground">
        [{index}]─<span className="text-foreground">{title}</span>
        {count !== undefined && <span className="ml-1.5 tabular-nums">{count}</span>}
      </h2>
      {children}
    </section>
  )
}

export function DashedFrame({
  label,
  className,
  children
}: {
  label?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <div className={className}>
      {label && (
        <p className="mb-1.5 font-mono text-[12px] tracking-[0.35em] whitespace-pre text-muted-foreground">{label}</p>
      )}
      <div className="relative border border-dashed border-frame">
        {[
          '-top-[9px] -left-[4px]',
          '-top-[9px] -right-[4px]',
          '-bottom-[9px] -left-[4px]',
          '-bottom-[9px] -right-[4px]'
        ].map((corner) => (
          <span key={corner} aria-hidden className={cn('absolute font-mono text-[12px] leading-4 text-frame', corner)}>
            +
          </span>
        ))}
        {children}
      </div>
    </div>
  )
}
