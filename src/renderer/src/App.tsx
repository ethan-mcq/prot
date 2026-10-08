import { useCallback, useEffect, useState } from 'react'
import { Inbox } from 'lucide-react'
import { toast } from 'sonner'
import type { AuthState, GitHubUser, InboxState, PullRef } from '@shared/types'
import { pullKey } from '@shared/types'
import { fallbackRepo } from '@shared/pull-input'
import { Toaster } from '@/components/ui/sonner'
import { AgentsScreen } from '@/components/agents-screen'
import { AuthGate } from '@/components/auth-gate'
import { ChatWidget } from '@/components/chat-widget'
import { Logo } from '@/components/logo'
import { Home } from '@/components/home'
import { DashedFrame, PaneHeader } from '@/components/pane'
import { PullView } from '@/components/pull-view'
import { Sidebar } from '@/components/sidebar'
import { TitleBar, TitleBarSlotProvider } from '@/components/title-bar'
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
  const [screen, setScreen] = useState<'home' | 'review' | 'agents'>('home')
  const [selected, setSelected] = useState<PullRef | null>(null)
  const goHome = () => setScreen('home')
  const login = auth?.status === 'signed_in' ? auth.user.login : null

  function openPull(ref: PullRef) {
    window.prot.inbox
      .checkout(ref)
      .then((resolved) => {
        setSelected(resolved)
        setScreen('review')
      })
      .catch((error: unknown) => {
        toast.error(`Could not open ${pullKey(ref)}`, { description: errorMessage(error) })
      })
  }

  useEffect(() => {
    window.prot.auth.get().then(setAuth)
  }, [])

  function signOut() {
    void window.prot.auth.signOut().then((state) => {
      setSelected(null)
      setAuth(state)
    })
  }

  return (
    <>
      {screen === 'home' && (
        <Home login={login} onReview={() => setScreen('review')} onAgents={() => setScreen('agents')} />
      )}
      {screen === 'agents' && <AgentsScreen login={login} onHome={goHome} onOpenPull={openPull} />}
      {screen === 'review' && auth?.status === 'signed_out' && <AuthGate error={auth.error} onAuth={setAuth} onHome={goHome} />}
      {screen === 'review' && auth?.status === 'signed_in' && (
        <Shell
          key={auth.user.login}
          user={auth.user}
          selected={selected}
          onSelect={setSelected}
          onHome={goHome}
          onSignOut={signOut}
        />
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

function Shell({
  user,
  selected,
  onSelect,
  onHome,
  onSignOut
}: {
  user: GitHubUser
  selected: PullRef | null
  onSelect: (ref: PullRef) => void
  onHome: () => void
  onSignOut: () => void
}) {
  const { inbox, refreshing, refresh } = useInbox()
  const [titleSlot, setTitleSlot] = useState<HTMLElement | null>(null)
  const reviewCount = inbox?.pulls.filter((pull) => pull.bucket === 'review').length ?? 0

  useHotkeys({ r: () => void refresh() })

  return (
    <ViewProvider>
      <TitleBarSlotProvider value={titleSlot}>
        <div className="flex h-full flex-col">
          <TitleBar login={user.login} onHome={onHome} slotRef={setTitleSlot} />
          <div className="surface mx-2 mb-2 flex min-h-0 flex-1 gap-2 p-2">
            <Sidebar
              inbox={inbox}
              refreshing={refreshing}
              onRefresh={() => void refresh()}
              selected={selected ? pullKey(selected) : null}
              onSelect={onSelect}
              fallbackRepo={fallbackRepo(selected, inbox?.pulls ?? [])}
              user={user}
              onSignOut={onSignOut}
            />
            <main id="main-pane" className="relative min-w-0 flex-1">
              {selected ? (
                <PullView key={pullKey(selected)} pullRef={selected} viewer={user.login} />
              ) : (
                <EmptyState reviewCount={reviewCount} />
              )}
            </main>
          </div>
        </div>
        <ChatWidget />
      </TitleBarSlotProvider>
    </ViewProvider>
  )
}

function EmptyState({ reviewCount }: { reviewCount: number }) {
  return (
    <div className="pane flex h-full flex-col">
      <PaneHeader icon={<Inbox />} title="Pick a pull request" />
      <div className="flex flex-1 items-center justify-center px-8 pb-10">
        <DashedFrame label={`P R O T   waiting: ${reviewCount}`} className="w-full max-w-[520px]">
          <div className="flex flex-col items-center gap-3 px-6 py-14 text-center font-mono text-[12.5px]">
            <Logo className="size-11" />
            <p className="mt-2 text-foreground">Pick a pull request from the left.</p>
            <p className="text-muted-foreground">
              {reviewCount === 0
                ? 'Nothing is waiting for your review.'
                : `${reviewCount} ${reviewCount === 1 ? 'pull request is' : 'pull requests are'} waiting for your review.`}
            </p>
          </div>
        </DashedFrame>
      </div>
    </div>
  )
}
