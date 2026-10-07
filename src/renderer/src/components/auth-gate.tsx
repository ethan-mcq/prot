import { useState, type FormEvent } from 'react'
import { Loader2, Terminal } from 'lucide-react'
import type { AuthState } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Logo } from '@/components/logo'
import { errorMessage } from '@/lib/utils'

type Pending = 'gh' | 'token' | null

export function AuthGate({ error, onAuth }: { error: string | null; onAuth: (state: AuthState) => void }) {
  const [token, setToken] = useState('')
  const [pending, setPending] = useState<Pending>(null)
  const [localError, setLocalError] = useState<string | null>(null)

  async function run(kind: Exclude<Pending, null>, attempt: () => Promise<AuthState>) {
    setPending(kind)
    setLocalError(null)
    try {
      onAuth(await attempt())
    } catch (failure) {
      setLocalError(errorMessage(failure))
    } finally {
      setPending(null)
    }
  }

  function submitToken(event: FormEvent) {
    event.preventDefault()
    if (token.trim()) void run('token', () => window.prot.auth.signInWithToken(token.trim()))
  }

  const shown = localError ?? error

  return (
    <div className="flex h-full flex-col bg-sidebar">
      <div className="drag-region h-12 shrink-0" />
      <div className="dot-grid flex flex-1 items-center justify-center px-6 pb-12">
        <div className="w-full max-w-[380px] rounded-2xl border bg-card p-8 shadow-soft">
          <Logo className="mx-auto size-16" />
          <h1 className="mt-5 text-center text-3xl font-semibold tracking-tight">prot</h1>
          <p className="mt-1.5 text-center text-sm text-muted-foreground">Guided reviews for your GitHub pull requests</p>
          <Button
            className="mt-7 w-full"
            disabled={pending !== null}
            onClick={() => void run('gh', () => window.prot.auth.signInWithGh())}
          >
            {pending === 'gh' ? <Loader2 className="animate-spin" /> : <Terminal />}
            Continue with GitHub CLI
          </Button>
          <div className="my-6 flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="micro-label">or</span>
            <span className="h-px flex-1 bg-border" />
          </div>
          <form onSubmit={submitToken} className="space-y-2.5">
            <Label htmlFor="token" className="text-xs text-muted-foreground">
              Personal access token
            </Label>
            <Input
              id="token"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="ghp_…"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              className="font-mono"
            />
            <Button type="submit" variant="outline" className="w-full" disabled={pending !== null || !token.trim()}>
              {pending === 'token' && <Loader2 className="animate-spin" />}
              Sign in
            </Button>
          </form>
          {shown && (
            <p role="alert" className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {shown}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
