import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { FileText, Loader2, Pencil, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import type { AgentInstructions } from '@shared/agents'
import {
  displayName,
  findVersion,
  livePrompt,
  normalizePrompt,
  PROMPT_KINDS,
  PROMPT_NAME_MAX,
  promptHash,
  type PromptKind,
  type PromptLibrary,
  type PromptVersion
} from '@shared/prompts'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { PaneButton, PaneHeader } from '@/components/pane'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { relativeTime } from '@/lib/paths'
import { usePrefs } from '@/lib/prefs'
import { cn, errorMessage } from '@/lib/utils'

export function PromptDialog({
  open,
  onOpenChange,
  initialKind = 'guide'
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialKind?: PromptKind
}) {
  return <Dialog open={open} onOpenChange={onOpenChange}>{open && <PromptEditor initialKind={initialKind} onClose={() => onOpenChange(false)} />}</Dialog>
}

function useHash(text: string): string | null {
  const [hashed, setHashed] = useState<{ text: string; hash: string } | null>(null)
  useEffect(() => {
    let live = true
    void promptHash(text).then((hash) => live && setHashed({ text, hash }))
    return () => {
      live = false
    }
  }, [text])
  return hashed?.text === text ? hashed.hash : null
}

const KINDS: Record<PromptKind, { tab: string; detail: string; placeholder: string; deleteNote: string }> = {
  guide: {
    tab: 'Review guide',
    detail: 'the system prompt AI guides are written with',
    placeholder: 'Write the system prompt for AI guides',
    deleteNote: 'Guides already written with it keep working.'
  },
  chat: {
    tab: 'Chat',
    detail: 'sent at the start of each new chat',
    placeholder: 'Write the system prompt for Ask prot chats',
    deleteNote: 'Chats started with it switch to the live prompt.'
  },
  agent: {
    tab: 'Agents',
    detail: 'sent to every new agent, with your skills folder',
    placeholder: 'Write the system prompt for Agent dash agents',
    deleteNote: 'Agents started with it switch to the live prompt.'
  }
}

function PromptEditor({ initialKind, onClose }: { initialKind: PromptKind; onClose: () => void }) {
  const { prompts: libraries, setPrompts } = usePrefs()
  const [kind, setKind] = useState<PromptKind>(initialKind)
  const prompts = libraries[kind]
  const [selectedHash, setSelectedHash] = useState(prompts.liveHash)
  const selected = findVersion(prompts, selectedHash) ?? livePrompt(prompts)
  const [draft, setDraft] = useState(selected.text)
  const [renaming, setRenaming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pending, setPending] = useState<(() => void) | null>(null)
  const [deleting, setDeleting] = useState<PromptVersion | null>(null)
  const draftHash = useHash(draft)
  const normalized = normalizePrompt(draft)
  const dirty = normalized !== selected.text
  const live = selected.hash === prompts.liveHash
  const versions = [...prompts.versions].reverse()

  function guard(action: () => void) {
    if (dirty) setPending(() => action)
    else action()
  }

  function select(version: PromptVersion) {
    setSelectedHash(version.hash)
    setDraft(version.text)
    setRenaming(false)
  }

  function switchKind(next: PromptKind) {
    if (next === kind) return
    guard(() => {
      setKind(next)
      select(livePrompt(libraries[next]))
    })
  }

  async function save() {
    setSaving(true)
    try {
      const { library, version } = await window.prot.prompts.save(kind, draft)
      const existed = findVersion(prompts, version.hash) !== undefined
      setPrompts(kind, library)
      select(version)
      toast.success(existed ? `Already saved as ${displayName(version)}` : `Saved as ${version.hash}`)
    } catch (error) {
      toast.error('Could not save the prompt', { description: errorMessage(error) })
    } finally {
      setSaving(false)
    }
  }

  async function run(change: () => Promise<PromptLibrary>, failure: string) {
    try {
      setPrompts(kind, await change())
    } catch (error) {
      toast.error(failure, { description: errorMessage(error) })
    }
  }

  async function remove(version: PromptVersion) {
    try {
      const library = await window.prot.prompts.remove(kind, version.hash)
      setPrompts(kind, library)
      if (version.hash === selected.hash) select(livePrompt(library))
      toast.success(`Deleted ${displayName(version)}`)
    } catch (error) {
      toast.error('Could not delete the prompt', { description: errorMessage(error) })
    }
  }

  function finishRename(name: string | null) {
    setRenaming(false)
    if (name === null || name.trim() === (selected.name ?? '')) return
    void run(() => window.prot.prompts.rename(kind, selected.hash, name), 'Could not rename the prompt')
  }

  function onListKey(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    if (step === 0) return
    event.preventDefault()
    const next = versions[versions.findIndex((version) => version.hash === selected.hash) + step]
    if (next) guard(() => select(next))
  }

  const body = (
    <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,10rem)_minmax(0,1fr)] md:grid-cols-[272px_minmax(0,1fr)] md:grid-rows-1">
      <div
        role="listbox"
        aria-label="Prompt versions"
        tabIndex={0}
        onKeyDown={onListKey}
        className="scroll-quiet min-h-0 space-y-px overflow-y-auto border-b border-pane-border p-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset md:border-r md:border-b-0"
      >
        {versions.map((version) => (
          <VersionRow
            key={version.hash}
            version={version}
            selected={version.hash === selected.hash}
            live={version.hash === prompts.liveHash}
            onSelect={() => version.hash !== selected.hash && guard(() => select(version))}
            onDelete={() => setDeleting(version)}
          />
        ))}
      </div>
      <div className="flex min-h-0 flex-col">
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-pane-border px-3.5">
          {renaming ? (
            <NameField key={selected.hash} version={selected} onDone={finishRename} />
          ) : (
            <>
              <span className={cn('min-w-0 truncate text-[13px] font-medium', selected.name === null && 'font-mono')}>
                {displayName(selected)}
              </span>
              <PaneButton aria-label="Rename prompt" title="Rename this version" onClick={() => setRenaming(true)}>
                <Pencil />
              </PaneButton>
            </>
          )}
          <span className="flex-1" />
          {live && <LiveBadge />}
          {selected.builtIn && <BuiltInTag />}
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
            {selected.name !== null && `${selected.hash} · `}
            {relativeTime(selected.createdAt)}
          </span>
        </div>
        <textarea
          aria-label="System prompt"
          value={draft}
          spellCheck={false}
          onChange={(event) => setDraft(event.target.value)}
          className="scroll-quiet min-h-0 flex-1 resize-none bg-transparent px-3.5 py-3 font-mono text-[12px] leading-[19px] outline-none placeholder:text-muted-foreground"
          placeholder={KINDS[kind].placeholder}
        />
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-pane-border px-3.5 py-2">
          <span className="mr-auto font-mono text-[11px] text-muted-foreground tabular-nums">
            {draft.length.toLocaleString()} characters ·{' '}
            {normalized === '' ? 'empty' : draftHash === null ? 'hashing' : dirty ? `saves as ${draftHash}` : draftHash}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={live}
            onClick={() => void run(() => window.prot.prompts.setLive(kind, selected.hash), 'Could not make the prompt live')}
          >
            Make live
          </Button>
          <Button size="sm" disabled={!dirty || normalized === '' || saving} onClick={() => void save()}>
            {saving && <Loader2 className="animate-spin" />}
            Save as new version
          </Button>
        </div>
      </div>
    </div>
  )

  return (
    <DialogContent
      showCloseButton={false}
      onEscapeKeyDown={(event) => {
        if (renaming) return event.preventDefault()
        if (dirty) {
          event.preventDefault()
          setPending(() => onClose)
        }
      }}
      onInteractOutside={(event) => {
        if (dirty) {
          event.preventDefault()
          setPending(() => onClose)
        }
      }}
      className="flex h-[min(700px,calc(100vh-2rem))] w-[min(1000px,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden rounded-[12px] p-0 sm:max-w-none"
    >
      <PaneHeader
        icon={<FileText />}
        title={
          <DialogTitle asChild>
            <span className="text-[12.5px] font-medium">System prompts</span>
          </DialogTitle>
        }
        detail={KINDS[kind].detail}
        className="border-b border-pane-border"
        actions={
          <PaneButton aria-label="Close" onClick={() => guard(onClose)}>
            <X />
          </PaneButton>
        }
      />
      <DialogDescription className="sr-only">
        Edit the system prompts for AI guides and for chat, save them as versions, name versions, and choose which one is live.
      </DialogDescription>
      <Tabs value={kind} onValueChange={(next) => switchKind(next as PromptKind)} className="min-h-0 flex-1 gap-0">
        <TabsList variant="line" aria-label="Prompt kinds" className="h-9 w-full shrink-0 justify-start border-b border-pane-border px-1">
          {PROMPT_KINDS.map((option) => (
            <TabsTrigger key={option} value={option} className="flex-none px-2.5 text-[12.5px]">
              {KINDS[option].tab}
            </TabsTrigger>
          ))}
        </TabsList>
        {PROMPT_KINDS.map((option) => (
          <TabsContent key={option} value={option} className="flex min-h-0 flex-col">
            {option === 'agent' && <InstructionsBar onImported={(library) => setPrompts('agent', library)} />}
            {body}
          </TabsContent>
        ))}
      </Tabs>
      <ConfirmDialog
        open={pending !== null}
        title="Discard your edits?"
        description="The prompt text has changes that are not saved as a version."
        keep="Keep editing"
        confirm="Discard"
        onKeep={() => setPending(null)}
        onConfirm={() => {
          const action = pending
          setPending(null)
          action?.()
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        title="Delete this prompt version?"
        description={KINDS[kind].deleteNote}
        keep="Cancel"
        confirm="Delete"
        onKeep={() => setDeleting(null)}
        onConfirm={() => {
          const version = deleting
          setDeleting(null)
          if (version !== null) void remove(version)
        }}
      />
    </DialogContent>
  )
}

function VersionRow({
  version,
  selected,
  live,
  onSelect,
  onDelete
}: {
  version: PromptVersion
  selected: boolean
  live: boolean
  onSelect: () => void
  onDelete: () => void
}) {
  return (
    <div
      role="option"
      aria-selected={selected}
      aria-label={displayName(version)}
      onClick={onSelect}
      className={cn('cursor-default rounded-[6px] px-2 py-1.5', selected ? 'bg-selection' : 'hover:bg-accent')}
    >
      <div className="flex items-center gap-1.5">
        <span aria-hidden className={cn('shrink-0 font-mono text-[11px]', selected ? 'text-foreground' : 'text-transparent')}>
          ›
        </span>
        <span className={cn('min-w-0 flex-1 truncate text-[12.5px]', version.name === null ? 'font-mono' : 'font-medium')}>
          {displayName(version)}
        </span>
        {live && <LiveBadge />}
        <PaneButton
          aria-label={`Delete ${displayName(version)}`}
          title={live ? 'Make another version live first' : 'Delete this version'}
          disabled={live}
          onClick={(event) => {
            event.stopPropagation()
            onDelete()
          }}
          className="-my-1 size-5 hover:text-destructive"
        >
          <Trash2 />
        </PaneButton>
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 pl-3 font-mono text-[10.5px] text-muted-foreground">
        {version.name !== null && <span>{version.hash}</span>}
        {version.name !== null && <span aria-hidden>·</span>}
        <span className="shrink-0">{relativeTime(version.createdAt)}</span>
        {version.builtIn && <BuiltInTag />}
      </div>
    </div>
  )
}

function LiveBadge() {
  return (
    <span className="shrink-0 rounded-full bg-added-line px-1.5 font-mono text-[10px] leading-4 text-added">live</span>
  )
}

function BuiltInTag() {
  return <span className="shrink-0 rounded-[4px] border px-1 font-mono text-[10px] leading-4 text-muted-foreground">built-in</span>
}

function NameField({ version, onDone }: { version: PromptVersion; onDone: (name: string | null) => void }) {
  const finished = useRef(false)
  function finish(name: string | null) {
    if (finished.current) return
    finished.current = true
    onDone(name)
  }
  return (
    <input
      aria-label="Prompt name"
      autoFocus
      defaultValue={version.name ?? ''}
      placeholder={version.hash}
      maxLength={PROMPT_NAME_MAX}
      onKeyDown={(event) => {
        if (event.key === 'Enter') finish(event.currentTarget.value)
        if (event.key === 'Escape') finish(null)
      }}
      onBlur={(event) => finish(event.currentTarget.value)}
      className="h-7 min-w-0 flex-1 rounded-[6px] border border-input bg-transparent px-2 text-[13px] font-medium outline-none placeholder:font-mono placeholder:font-normal placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
    />
  )
}

function ConfirmDialog({
  open,
  title,
  description,
  keep,
  confirm,
  onKeep,
  onConfirm
}: {
  open: boolean
  title: string
  description: string
  keep: string
  confirm: string
  onKeep: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onKeep()}>
      <DialogContent showCloseButton={false} className="gap-4 p-5 sm:max-w-sm">
        <DialogHeader className="gap-1">
          <DialogTitle className="text-[15px] font-medium">{title}</DialogTitle>
          <DialogDescription className="font-mono text-[11.5px]">{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onKeep}>
            {keep}
          </Button>
          <Button variant="destructive" size="sm" onClick={onConfirm}>
            {confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function InstructionsBar({ onImported }: { onImported: (library: PromptLibrary) => void }) {
  const [info, setInfo] = useState<AgentInstructions | null>(null)

  useEffect(() => {
    void window.prot.agents.instructions().then(setInfo)
  }, [])

  function run(action: () => Promise<AgentInstructions>, failure: string) {
    action().then(setInfo, (error: unknown) => toast.error(failure, { description: errorMessage(error) }))
  }

  function importFile() {
    window.prot.agents.importAgentsMd().then(onImported, (error: unknown) =>
      toast.error('Could not import AGENTS.md', { description: errorMessage(error) })
    )
  }

  return (
    <div aria-label="Skills folder" role="group" className="flex h-10 shrink-0 items-center gap-2 border-b border-pane-border px-3 font-mono text-[11.5px] text-muted-foreground">
      <span className="shrink-0">folder</span>
      <span className="min-w-0 truncate text-foreground" title={info?.folder ?? undefined}>
        {info?.folder ?? 'none'}
      </span>
      {info?.folder && (
        <span className="min-w-0 truncate" title={info.file ?? undefined}>
          · {info.file ? info.file.slice(info.folder.length + 1) : 'no AGENTS.md'}
        </span>
      )}
      <span className="flex-1" />
      <Button size="xs" variant="outline" onClick={() => run(() => window.prot.agents.chooseInstructionsFolder(), 'Could not set the folder')}>
        {info?.folder ? 'Change folder…' : 'Choose folder…'}
      </Button>
      {info?.file && (
        <Button size="xs" variant="outline" onClick={importFile}>
          Import AGENTS.md
        </Button>
      )}
      {info?.folder && !info.file && (
        <Button size="xs" variant="outline" onClick={() => run(() => window.prot.agents.createAgentsMd(), 'Could not create AGENTS.md')}>
          Create AGENTS.md
        </Button>
      )}
    </div>
  )
}
