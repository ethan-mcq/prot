import { useEffect, useState } from 'react'
import type { AgentPr } from '@shared/agents'
import type { PullRef } from '@shared/types'
import { AgentDash } from '@/components/agent-dash'
import { AgentSidebar } from '@/components/agent-sidebar'
import { AgentView } from '@/components/agent-view'
import { TitleBar } from '@/components/title-bar'
import { useAgents } from '@/lib/agents'

export function AgentsScreen({
  login,
  onHome,
  onOpenPull
}: {
  login: string | null
  onHome: () => void
  onOpenPull: (ref: PullRef) => void
}) {
  const store = useAgents()
  const [selected, setSelected] = useState<string | null>(null)
  const agents = store.state?.agents

  // An archived or vanished agent drops back to the dash.
  useEffect(() => {
    if (selected !== null && agents && !agents.some((agent) => agent.id === selected)) setSelected(null)
  }, [agents, selected])

  function openPull(pr: AgentPr) {
    if (login) onOpenPull({ owner: pr.owner, repo: pr.repo, number: pr.number })
    else void window.prot.openExternal(pr.url)
  }

  return (
    <div className="flex h-full flex-col">
      <TitleBar login={login} onHome={onHome} />
      <div className="surface mx-2 mb-2 flex min-h-0 flex-1 gap-2 p-2">
        <AgentSidebar
          state={store.state}
          error={store.error}
          refreshing={store.refreshing}
          onRefresh={() => void store.refresh()}
          selected={selected}
          onSelect={setSelected}
          onNew={() => setSelected(null)}
        />
        <main id="main-pane" className="relative min-w-0 flex-1">
          {selected ? (
            <AgentView key={selected} id={selected} store={store} onSelect={setSelected} onClosed={() => setSelected(null)} onOpenPull={openPull} />
          ) : (
            <AgentDash store={store} onSelect={setSelected} onOpenPull={openPull} />
          )}
        </main>
      </div>
    </div>
  )
}
