import { createContext, useContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Logo } from '@/components/logo'

const SlotContext = createContext<HTMLElement | null>(null)

export const TitleBarSlotProvider = SlotContext.Provider

export function TitleBarPortal({ children }: { children: ReactNode }) {
  const slot = useContext(SlotContext)
  return slot ? createPortal(children, slot) : null
}

export function TitleBar({
  login,
  slotRef
}: {
  login: string | null
  slotRef?: (element: HTMLElement | null) => void
}) {
  return (
    <div className="drag-region flex h-[52px] shrink-0 items-center gap-4 pr-3 pl-[84px]">
      <div className="flex shrink-0 items-center gap-2">
        <Logo className="size-[22px]" />
        <div className="leading-none">
          <p className="text-[13px] font-semibold tracking-tight">prot</p>
          {login && <p className="mt-[3px] text-[10.5px] text-tab-foreground">{login}</p>}
        </div>
      </div>
      <div ref={slotRef} className="flex min-w-0 flex-1 items-center gap-2" />
    </div>
  )
}
