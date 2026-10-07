import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { AuthState, GitHubUser, InboxState, PullRef } from '@shared/types'
import { pullKey } from '@shared/types'
import { Toaster } from '@/components/ui/sonner'
import { AuthGate } from '@/components/auth-gate'
import { ChatWidget } from '@/components/chat-widget'
import { Logo } from '@/components/logo'
import { PullView } from '@/components/pull-view'
import { Sidebar } from '@/components/sidebar'
import { useHotkeys } from '@/lib/hooks'
import { PrefsProvider, usePrefs } from '@/lib/prefs'
import { errorMessage } from '@/lib/utils'
import { ViewProvider } from '@/lib/view-context'

export function App() {
  return (
    <PrefsProvider>
      <Root />
    </PrefsProvider>
  )
}

function Root() {
  const { resolvedTheme } = usePrefs()
  const [auth, setAuth] = useState<AuthState | null>(null)

  useEffect(() => {
    window.prot.auth.get().then(setAuth)
  }, [])

  return (
    <>
      {auth?.status === 'signed_out' && <AuthGate error={auth.error} onAuth={setAuth} />}
      {auth?.status === 'signed_in' && (
        <Shell key={auth.user.login} user={auth.user} onSignOut={() => void window.prot.auth.signOut().then(setAuth)} />
      )}
      <Toaster theme={resolvedTheme} position="bottom-center" />
    </>
  )
}

function useInbox() {
  const [inbox, setInbox] = useState<InboxState | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    let live = true
    window.prot.inbox.get().then((state) => live && setInbox(state))
    const unsubscribe = window.prot.inbox.onChange(setInbox)
    return () => {
      live = false
      unsubscribe()
    }
  }, [])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      setInbox(await window.prot.inbox.refresh())
    } catch (error) {
      toast.error('Could not refresh pull requests', { description: errorMessage(error) })
    } finally {
      setRefreshing(false)
    }
  }, [])

  return { inbox, refreshing, refresh }
}

function Shell({ user, onSignOut }: { user: GitHubUser; onSignOut: () => void }) {
  const { inbox, refreshing, refresh } = useInbox()
  const [selected, setSelected] = useState<PullRef | null>(null)
  const reviewCount = inbox?.pulls.filter((pull) => pull.bucket === 'review').length ?? 0

  useHotkeys({ r: () => void refresh() })

  return (
    <ViewProvider>
      <div className="flex h-full">
        <Sidebar
          inbox={inbox}
          refreshing={refreshing}
          onRefresh={() => void refresh()}
          selected={selected ? pullKey(selected) : null}
          onSelect={(pull) => setSelected(pull.ref)}
          user={user}
          onSignOut={onSignOut}
        />
        <main id="main-pane" className="relative min-w-0 flex-1 bg-background">
          {selected ? (
            <PullView key={pullKey(selected)} pullRef={selected} viewer={user.login} />
          ) : (
            <EmptyState reviewCount={reviewCount} />
          )}
        </main>
      </div>
      <ChatWidget />
    </ViewProvider>
  )
}

function EmptyState({ reviewCount }: { reviewCount: number }) {
  return (
    <div className="flex h-full flex-col">
      <div className="drag-region h-12 shrink-0" />
      <div className="dot-grid flex flex-1 flex-col items-center justify-center gap-3 pb-12 text-center">
        <Logo className="size-14" />
        <h1 className="mt-2 font-serif text-2xl font-semibold tracking-tight">Pick a pull request</h1>
        <p className="text-sm text-muted-foreground">
          {reviewCount === 0
            ? 'Nothing is waiting for your review.'
            : `${reviewCount} ${reviewCount === 1 ? 'pull request is' : 'pull requests are'} waiting for your review.`}
        </p>
      </div>
    </div>
  )
}
