import logo from '@/assets/logo.png'
import { cn } from '@/lib/utils'

export function Logo({ className }: { className?: string }) {
  return <img src={logo} alt="prot" draggable={false} className={cn('size-7 object-contain select-none dark:invert', className)} />
}
