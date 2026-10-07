import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { FileText, Loader2, Pencil, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  displayName,
  findVersion,
  livePrompt,
  normalizePrompt,
  PROMPT_NAME_MAX,
  promptHash,
  type PromptLibrary,
  type PromptVersion
} from '@shared/prompts'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { PaneButton, PaneHeader } from '@/components/pane'
import { relativeTime } from '@/lib/paths'
import { usePrefs } from '@/lib/prefs'
import { cn, errorMessage } from '@/lib/utils'

export function PromptDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return <Dialog open={open} onOpenChange={onOpenChange}>{open && <PromptEditor onClose={() => onOpenChange(false)} />}</Dialog>
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

function PromptEditor({ onClose }: { onClose: () => void }) {
  const { prompts, setPrompts } = usePrefs()
  const [selectedHash, setSelectedHash] = useState(prompts.liveHash)
  const selected = findVersion(prompts, selectedHash) ?? livePrompt(prompts)
  const [draft, setDraft] = useState(selected.text)
  const [renaming, setRenaming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pending, setPending] = useState<(() => void) | null>(null)
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

  async function save() {
    setSaving(true)
    try {
      const { library, version } = await window.prot.prompts.save(draft)
      const existed = findVersion(prompts, version.hash) !== undefined
      setPrompts(library)
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
      setPrompts(await change())
    } catch (error) {
      toast.error(failure, { description: errorMessage(error) })
    }
  }

  function finishRename(name: string | null) {
    setRenaming(false)
    if (name === null || name.trim() === (selected.name ?? '')) return
    void run(() => window.prot.prompts.rename(selected.hash, name), 'Could not rename the prompt')
  }

  function onListKey(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    if (step === 0) return
    event.preventDefault()
    const next = versions[versions.findIndex((version) => version.hash === selected.hash) + step]
    if (next) guard(() => select(next))
  }

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
            <span className="text-[12.5px] font-medium">Review prompt</span>
          </DialogTitle>
        }
        detail="the system prompt AI guides are written with"
        className="border-b border-pane-border"
        actions={
          <PaneButton aria-label="Close" onClick={() => guard(onClose)}>
            <X />
          </PaneButton>
        }
      />
      <DialogDescription className="sr-only">
        Edit the system prompt, save it as a new version, name versions, and choose which one is live.
      </DialogDescription>
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
            placeholder="Write the system prompt for AI guides"
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
              onClick={() => void run(() => window.prot.prompts.setLive(selected.hash), 'Could not make the prompt live')}
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
      <DiscardDialog
        open={pending !== null}
        onKeep={() => setPending(null)}
        onDiscard={() => {
          const action = pending
          setPending(null)
          action?.()
        }}
      />
    </DialogContent>
  )
}

function VersionRow({
  version,
  selected,
  live,
  onSelect
}: {
  version: PromptVersion
  selected: boolean
  live: boolean
  onSelect: () => void
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

function DiscardDialog({ open, onKeep, onDiscard }: { open: boolean; onKeep: () => void; onDiscard: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onKeep()}>
      <DialogContent showCloseButton={false} className="gap-4 p-5 sm:max-w-sm">
        <DialogHeader className="gap-1">
          <DialogTitle className="text-[15px] font-medium">Discard your edits?</DialogTitle>
          <DialogDescription className="font-mono text-[11.5px]">The prompt text has changes that are not saved as a version.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onKeep}>
            Keep editing
          </Button>
          <Button variant="destructive" size="sm" onClick={onDiscard}>
            Discard
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
