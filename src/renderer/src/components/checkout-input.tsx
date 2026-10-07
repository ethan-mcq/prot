import { useId, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import type { PullRef } from '@shared/types'
import { parsePullInput, type RepoRef } from '@shared/pull-input'
import { cn, errorMessage } from '@/lib/utils'

export function CheckoutInput({ fallback, onOpen }: { fallback: RepoRef | null; onOpen: (ref: PullRef) => void }) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const errorId = useId()

  async function submit() {
    if (busy) return
    const parsed = parsePullInput(text, fallback)
    if ('error' in parsed) {
      setError(parsed.error)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const ref = await window.prot.inbox.checkout(parsed.ref)
      setText('')
      onOpen(ref)
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="shrink-0 px-2.5 pb-1"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <div className="relative">
        <span aria-hidden className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 font-mono text-[11.5px] text-muted-foreground">
          #
        </span>
        <input
          aria-label="Check out a pull request"
          aria-invalid={error !== null}
          aria-describedby={error ? errorId : undefined}
          aria-busy={busy}
          placeholder="PR link, owner/repo#123 or #123"
          value={text}
          readOnly={busy}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => {
            setText(event.target.value)
            setError(null)
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            setText('')
            setError(null)
          }}
          className={cn(
            'h-7 w-full rounded-[6px] border border-pane-border bg-muted/40 pr-7 pl-5 font-mono text-[11.5px] transition-colors outline-none placeholder:text-muted-foreground/70',
            'focus-visible:border-ring focus-visible:bg-transparent focus-visible:ring-2 focus-visible:ring-ring/40',
            error && 'border-destructive/40'
          )}
        />
        {busy && (
          <LoaderCircle
            aria-hidden
            className="absolute top-1/2 right-2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground"
          />
        )}
      </div>
      {error && (
        <p id={errorId} role="alert" className="mt-1 px-0.5 font-mono text-[11px] leading-4 text-destructive/80">
          {error}
        </p>
      )}
    </form>
  )
}
