import { useState, type FormEvent } from 'react'
import { Loader2, Terminal } from 'lucide-react'
import type { AuthState } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Logo } from '@/components/logo'
import { PaneHeader } from '@/components/pane'
import { TitleBar } from '@/components/title-bar'
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
    <div className="flex h-full flex-col">
      <TitleBar login={null} />
      <div className="surface mx-2 mb-2 flex flex-1 items-center justify-center px-6 pb-12">
        <div className="pane w-full max-w-[400px] overflow-hidden">
          <PaneHeader icon={<Logo className="size-4" />} title="prot" detail="sign in" />
          <div className="px-7 pt-5 pb-7">
            <h1 className="font-display text-[52px]">Guided reviews</h1>
            <p className="mt-2 font-copy text-[12.5px] leading-[1.7] text-muted-foreground">
              Walk your GitHub pull requests as an overview, a flow and chapters.
            </p>
            <Button
              className="mt-6 w-full"
              disabled={pending !== null}
              onClick={() => void run('gh', () => window.prot.auth.signInWithGh())}
            >
              {pending === 'gh' ? <Loader2 className="animate-spin" /> : <Terminal />}
              Continue with GitHub CLI
            </Button>
            <div className="my-6 flex items-center gap-3">
              <span className="h-px flex-1 bg-border" />
              <span className="font-mono text-[11px] text-muted-foreground">or</span>
              <span className="h-px flex-1 bg-border" />
            </div>
            <form onSubmit={submitToken} className="space-y-2.5">
              <Label htmlFor="token" className="font-mono text-[11.5px] font-normal text-muted-foreground">
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
              <p role="alert" className="mt-4 font-mono text-[11.5px] text-destructive">
                ! {shown}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
