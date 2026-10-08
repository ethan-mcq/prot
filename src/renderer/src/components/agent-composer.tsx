import { useEffect, useId, useMemo, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { FileText, Paperclip, X } from 'lucide-react'
import { toast } from 'sonner'
import { commandGroups, slashQuery } from '@shared/agent-commands'
import {
  agentFileUrl,
  ATTACHMENTS_PER_TURN,
  isImageMime,
  PROVIDER_NAMES,
  type AgentAttachment,
  type AgentCommand,
  type AgentContext,
  type AgentProvider
} from '@shared/agents'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { ProviderMark } from '@/components/agent-bits'
import { cn, errorMessage } from '@/lib/utils'

// Skills and commands for a folder; empty until they load or when the folder is unknown.
export function useCommands(folder: string | null): AgentCommand[] {
  const [commands, setCommands] = useState<AgentCommand[]>([])
  useEffect(() => {
    if (!folder) {
      setCommands([])
      return
    }
    let live = true
    window.prot.agents
      .commands(folder)
      .then((next) => {
        if (live) setCommands(next)
      })
      .catch(() => {
        if (live) setCommands([])
      })
    return () => {
      live = false
    }
  }, [folder])
  return commands
}

type Slash = {
  // Rendered next to the textarea; null while closed.
  menu: ReactNode
  // Returns true when the menu used the key.
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean
  // Keeps the caret in sync; call from onChange, onSelect and onClick.
  track: (element: HTMLTextAreaElement) => void
  inputProps: {
    'aria-autocomplete': 'list'
    'aria-controls': string | undefined
    'aria-activedescendant': string | undefined
  }
}

function groupTitle(owner: AgentProvider | null): string {
  return owner === null ? 'Skills folder' : PROVIDER_NAMES[owner]
}

// The `/` autocomplete: the agent's own commands first, then the skills folder's and the other CLI's (read as SKILL.md files).
export function useSlashMenu({
  text,
  setText,
  textarea,
  commands,
  provider,
  placement
}: {
  text: string
  setText: (text: string) => void
  textarea: RefObject<HTMLTextAreaElement | null>
  commands: AgentCommand[]
  provider: AgentProvider
  placement: 'above' | 'below'
}): Slash {
  const id = useId()
  const [caret, setCaret] = useState(0)
  const [active, setActive] = useState(0)
  const [dismissed, setDismissed] = useState<number | null>(null)
  const slash = slashQuery(text, Math.min(caret, text.length))
  const groups = useMemo(() => (slash ? commandGroups(commands, provider, slash.query) : []), [commands, provider, slash?.query])
  const flat: AgentCommand[] = []
  for (const group of groups) flat.push(...group.commands)
  const open = slash !== null && slash.start !== dismissed && flat.length > 0
  const current = Math.min(active, flat.length - 1)

  useEffect(() => {
    setActive(0)
  }, [slash?.query, slash?.start])

  useEffect(() => {
    if (!open) return
    document.getElementById(`${id}-${current}`)?.scrollIntoView({ block: 'nearest' })
  }, [open, current, id])

  function insert(command: AgentCommand) {
    if (!slash) return
    const before = text.slice(0, slash.start)
    const after = text.slice(Math.min(caret, text.length)).replace(/^\S*/, '')
    const token = `/${command.name}${after.startsWith(' ') ? '' : ' '}`
    const next = before + token + after
    const at = before.length + token.length
    setText(next)
    setCaret(at)
    requestAnimationFrame(() => {
      const element = textarea.current
      if (!element) return
      element.focus()
      element.setSelectionRange(at, at)
    })
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
    if (!open || event.metaKey || event.ctrlKey || event.altKey) return false
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive((current + step + flat.length) % flat.length)
      return true
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      const command = flat[current]
      if (command) insert(command)
      return true
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setDismissed(slash?.start ?? null)
      return true
    }
    return false
  }

  function track(element: HTMLTextAreaElement) {
    setCaret(element.selectionStart)
    if (dismissed !== null && slashQuery(element.value, element.selectionStart)?.start !== dismissed) setDismissed(null)
  }

  let index = 0
  const menu = open ? (
    <div
      id={`${id}-list`}
      role="listbox"
      aria-label="Commands and skills"
      className={cn(
        'scroll-quiet absolute right-0 left-0 z-30 max-h-72 overflow-y-auto rounded-[8px] border border-pane-border bg-popover p-1 text-popover-foreground shadow-lg',
        placement === 'above' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
      )}
    >
      {groups.map((group) => (
        <div key={group.provider ?? 'folder'} role="group" aria-label={groupTitle(group.provider)}>
          <div className="flex items-center gap-1.5 px-2 pt-1.5 pb-1 font-mono text-[10.5px] text-muted-foreground">
            {group.provider && <ProviderMark provider={group.provider} />}
            {groupTitle(group.provider)}
          </div>
          {group.commands.map((command) => {
            const position = index++
            const foreign = command.provider !== provider
            return (
              <div
                key={`${command.provider ?? 'folder'}:${command.name}`}
                id={`${id}-${position}`}
                role="option"
                aria-selected={position === current}
                title={command.path ?? undefined}
                onMouseDown={(event) => {
                  event.preventDefault()
                  insert(command)
                }}
                onMouseMove={() => setActive(position)}
                className={cn(
                  'flex cursor-default items-baseline gap-2 rounded-[5px] px-2 py-1 font-mono text-[11.5px]',
                  position === current && 'bg-accent'
                )}
              >
                <span className="shrink-0 text-foreground">/{command.name}</span>
                <span className="min-w-0 flex-1 truncate text-[10.5px] text-muted-foreground">{command.description}</span>
                {foreign && <span className="shrink-0 text-[10px] text-muted-foreground">via SKILL.md</span>}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  ) : null

  return {
    menu,
    onKeyDown,
    track,
    inputProps: {
      'aria-autocomplete': 'list',
      'aria-controls': open ? `${id}-list` : undefined,
      'aria-activedescendant': open ? `${id}-${current}` : undefined
    }
  }
}

export type Attachments = {
  items: AgentAttachment[]
  busy: boolean
  dragging: boolean
  pick: () => Promise<void>
  remove: (path: string) => void
  clear: () => void
  onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void
  dropProps: {
    onDragOver: (event: DragEvent<HTMLElement>) => void
    onDragLeave: (event: DragEvent<HTMLElement>) => void
    onDrop: (event: DragEvent<HTMLElement>) => void
  }
}

export function useAttachments(): Attachments {
  const [items, setItems] = useState<AgentAttachment[]>([])
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)

  function add(next: AgentAttachment[]) {
    setItems((prev) => {
      const out = [...prev]
      for (const item of next) {
        if (out.length < ATTACHMENTS_PER_TURN) out.push(item)
      }
      if (prev.length + next.length > ATTACHMENTS_PER_TURN) toast.error(`At most ${ATTACHMENTS_PER_TURN} attachments per message`)
      return out
    })
  }

  async function pick() {
    setBusy(true)
    try {
      add(await window.prot.agents.pickAttachments())
    } catch (error) {
      toast.error('Could not attach the files', { description: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  async function addFiles(files: File[]) {
    if (files.length === 0) return
    setBusy(true)
    try {
      const saved: AgentAttachment[] = []
      for (const file of files) {
        saved.push(await window.prot.agents.saveAttachment(file.name || 'pasted', new Uint8Array(await file.arrayBuffer())))
      }
      add(saved)
    } catch (error) {
      toast.error('Could not attach the file', { description: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  return {
    items,
    busy,
    dragging,
    pick,
    remove: (path) => setItems((prev) => prev.filter((item) => item.path !== path)),
    clear: () => setItems([]),
    onPaste: (event) => {
      const files = Array.from(event.clipboardData.files)
      if (files.length === 0) return
      event.preventDefault()
      void addFiles(files)
    },
    dropProps: {
      onDragOver: (event) => {
        if (!event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
        setDragging(true)
      },
      onDragLeave: () => setDragging(false),
      onDrop: (event) => {
        setDragging(false)
        if (event.dataTransfer.files.length === 0) return
        event.preventDefault()
        void addFiles(Array.from(event.dataTransfer.files))
      }
    }
  }
}

export function AttachButton({ attachments, disabled }: { attachments: Attachments; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-label="Attach files"
      title="Attach files (or paste or drop them)"
      disabled={disabled || attachments.busy}
      onClick={() => void attachments.pick()}
      className="flex size-7 shrink-0 items-center justify-center rounded-[6px] text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
    >
      <Paperclip className="size-3.5" />
    </button>
  )
}

export function AttachmentStrip({ attachments }: { attachments: Attachments }) {
  if (attachments.items.length === 0) return null
  return (
    <ul aria-label="Attachments" className="flex flex-wrap gap-1.5 px-1 pt-1 pb-1.5">
      {attachments.items.map((item) => (
        <li key={item.path} className="group/att relative flex items-center gap-1.5 rounded-[6px] border border-pane-border bg-background/60 p-0.5 pr-1.5">
          {isImageMime(item.mime) ? (
            <img src={agentFileUrl(item.path)} alt={item.name} className="size-8 rounded-[4px] object-cover" />
          ) : (
            <FileText aria-hidden className="m-1 size-4 text-muted-foreground" />
          )}
          <span className="max-w-[140px] truncate font-mono text-[10.5px]" title={item.path}>
            {item.name}
          </span>
          <button
            type="button"
            aria-label={`Remove ${item.name}`}
            onClick={() => attachments.remove(item.path)}
            className="rounded-[3px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <X className="size-3" />
          </button>
        </li>
      ))}
    </ul>
  )
}

function compactTokens(n: number): string {
  if (n >= 1e6) return `${Number((n / 1e6).toFixed(1))}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}

export function contextText(context: AgentContext): { percent: number; label: string } {
  const percent = Math.min(100, Math.round((context.usedTokens / context.windowTokens) * 100))
  return { percent, label: `${compactTokens(context.usedTokens)} / ${compactTokens(context.windowTokens)} tokens (${percent}%)` }
}

// A ring that fills with the share of the context window the newest request used.
export function ContextWheel({ context }: { context: AgentContext | null }) {
  if (!context) return null
  const { percent, label } = contextText(context)
  const radius = 6
  const length = 2 * Math.PI * radius
  return (
    <span
      role="meter"
      aria-label="Context window"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={label}
      title={label}
      className={cn(
        'flex size-7 shrink-0 items-center justify-center',
        percent >= 90 ? 'text-removed-mark' : percent >= 70 ? 'text-modified' : 'text-muted-foreground'
      )}
    >
      <svg aria-hidden viewBox="0 0 16 16" className="size-4 -rotate-90">
        <circle cx="8" cy="8" r={radius} fill="none" stroke="currentColor" strokeOpacity={0.25} strokeWidth="2" />
        <circle
          cx="8"
          cy="8"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={`${(percent / 100) * length} ${length}`}
        />
      </svg>
    </span>
  )
}

// Thumbnails of image files; a click opens the image larger.
export function ImageThumbs({ paths, className }: { paths: string[]; className?: string }) {
  const [open, setOpen] = useState<string | null>(null)
  if (paths.length === 0) return null
  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      {paths.map((path) => (
        <button
          key={path}
          type="button"
          aria-label={`Open image ${basename(path)}`}
          title={path}
          onClick={() => setOpen(path)}
          className="overflow-hidden rounded-[6px] border border-pane-border outline-none hover:border-frame focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <img src={agentFileUrl(path)} alt={basename(path)} className="h-20 max-w-[160px] object-cover" />
        </button>
      ))}
      <Dialog open={open !== null} onOpenChange={(next) => !next && setOpen(null)}>
        <DialogContent className="max-w-[min(90vw,1100px)] p-3 sm:max-w-[min(90vw,1100px)]">
          <DialogTitle className="truncate pr-6 font-mono text-[12px] font-normal">{open ?? ''}</DialogTitle>
          {open && <img src={agentFileUrl(open)} alt={basename(open)} className="max-h-[78vh] w-full object-contain" />}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

// The files on a user message that are not images, as chips.
export function FileChips({ attachments }: { attachments: AgentAttachment[] }) {
  const files = attachments.filter((item) => !isImageMime(item.mime))
  if (files.length === 0) return null
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {files.map((item) => (
        <span key={item.path} title={item.path} className="flex items-center gap-1 rounded-[5px] border border-pane-border px-1.5 font-mono text-[10.5px] leading-[18px] text-muted-foreground">
          <FileText aria-hidden className="size-3" />
          {item.name}
        </span>
      ))}
    </div>
  )
}
