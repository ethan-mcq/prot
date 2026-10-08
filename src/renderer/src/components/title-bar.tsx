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
  onHome,
  slotRef
}: {
  login: string | null
  onHome: () => void
  slotRef?: (element: HTMLElement | null) => void
}) {
  return (
    <div className="drag-region flex h-[52px] shrink-0 items-center gap-4 overflow-hidden pr-3 pl-[84px]">
      <button
        type="button"
        aria-label="Home"
        title="Home"
        onClick={onHome}
        className="no-drag -mx-1.5 flex shrink-0 items-center gap-2 rounded-[8px] px-1.5 py-1 text-left outline-none transition-colors hover:bg-tab focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <Logo className="size-[22px]" />
        <span className="leading-none">
          <span className="block text-[13px] font-semibold tracking-tight">prot</span>
          {login && <span className="mt-[3px] block text-[10.5px] text-tab-foreground">{login}</span>}
        </span>
      </button>
      <div ref={slotRef} className="flex min-w-0 flex-1 items-center gap-2" />
    </div>
  )
}
