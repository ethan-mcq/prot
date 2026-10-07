import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Folder, FolderOpen, Loader2, X } from 'lucide-react'
import type { ChangedFile, FileStatus } from '@shared/types'
import { Button } from '@/components/ui/button'
import { DiffStat } from '@/components/diff-stat'
import { DiffView } from '@/components/diff-view'
import { FileIcon } from '@/components/file-icon'
import { languageFor } from '@/lib/highlight'
import { useHighlighted, useHotkeys } from '@/lib/hooks'
import { fileLines, splitPath } from '@/lib/paths'
import { useReview } from '@/lib/review-context'
import type { TreeMode } from '@/lib/review-session'
import { cn, errorMessage } from '@/lib/utils'
import { useViewStore } from '@/lib/view-context'

type TreeFile = { kind: 'file'; name: string; path: string }
type TreeDir = { kind: 'dir'; name: string; path: string; children: TreeEntry[] }
type TreeEntry = TreeFile | TreeDir

function buildTree(paths: string[]): TreeEntry[] {
  const root: TreeDir = { kind: 'dir', name: '', path: '', children: [] }
  for (const path of paths) {
    const parts = path.split('/')
    let dir = root
    parts.forEach((part, i) => {
      if (i === parts.length - 1) {
        dir.children.push({ kind: 'file', name: part, path })
        return
      }
      const dirPath = parts.slice(0, i + 1).join('/')
      let child = dir.children.find((entry): entry is TreeDir => entry.kind === 'dir' && entry.path === dirPath)
      if (!child) {
        child = { kind: 'dir', name: part, path: dirPath, children: [] }
        dir.children.push(child)
      }
      dir = child
    })
  }
  return compact(root).children
}

// Single-child folder chains collapse into one row ("src/main/kotlin"), like VS Code.
function compact(dir: TreeDir): TreeDir {
  const children = dir.children
    .map((entry) => (entry.kind === 'dir' ? compact(entry) : entry))
    .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1))
  const only = children[0]
  if (dir.path !== '' && children.length === 1 && only?.kind === 'dir') {
    return { ...only, name: `${dir.name}/${only.name}` }
  }
  return { ...dir, children }
}

function filesInOrder(entries: TreeEntry[]): string[] {
  const out: string[] = []
  for (const entry of entries) {
    if (entry.kind === 'file') out.push(entry.path)
    else out.push(...filesInOrder(entry.children))
  }
  return out
}

function ancestors(path: string): string[] {
  const parts = path.split('/')
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'))
}

const STATUS_LETTER: Record<FileStatus, { letter: string; className: string }> = {
  added: { letter: 'A', className: 'text-added' },
  modified: { letter: 'M', className: 'text-modified' },
  removed: { letter: 'D', className: 'text-removed' },
  renamed: { letter: 'R', className: 'text-sky-600 dark:text-sky-400' }
}

export function IdeView({ path }: { path: string }) {
  const { detail, session, dispatch, loadTree } = useReview()
  const mode = session.ide.mode
  const changed = useMemo(() => new Map(detail.files.map((file) => [file.path, file])), [detail.files])
  const [allPaths, setAllPaths] = useState<string[] | null>(null)
  const [treeError, setTreeError] = useState<string | null>(null)
  const [toggled, setToggled] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (mode !== 'all' || allPaths) return
    loadTree()
      .then((paths) => {
        const extra = detail.files.filter((file) => file.status === 'removed').map((file) => file.path)
        setAllPaths([...new Set([...paths, ...extra])])
      })
      .catch((error: unknown) => setTreeError(errorMessage(error)))
  }, [mode, allPaths, loadTree, detail.files])

  const paths = mode === 'all' ? allPaths : detail.files.map((file) => file.path)
  const tree = useMemo(() => (paths ? buildTree(paths) : []), [paths])
  const order = useMemo(() => filesInOrder(tree), [tree])

  const changedDirs = useMemo(() => new Set(detail.files.flatMap((file) => ancestors(file.path))), [detail.files])
  const isOpen = (dir: string) => {
    const byDefault = mode === 'changed' || changedDirs.has(dir) || path.startsWith(`${dir}/`)
    return byDefault !== toggled.has(`${mode}:${dir}`)
  }

  function select(next: string) {
    setToggled((prev) => {
      const copy = new Set(prev)
      for (const dir of ancestors(next)) copy.delete(`${mode}:${dir}`)
      return copy
    })
    dispatch({ type: 'ide/open', path: next })
  }

  function move(delta: 1 | -1) {
    if (order.length === 0) return
    const index = order.indexOf(path)
    const next = order[index === -1 ? 0 : (index + delta + order.length) % order.length]
    if (next) select(next)
  }

  useHotkeys({
    Escape: () => dispatch({ type: 'ide/close' }),
    j: () => move(1),
    k: () => move(-1)
  })

  const file = changed.get(path)

  return (
    <div
      role="region"
      aria-label="IDE"
      className="absolute inset-0 z-30 flex bg-background animate-in fade-in-0 duration-150"
    >
      <aside className="flex w-72 shrink-0 flex-col border-r bg-sidebar">
        <div className="drag-region flex h-12 shrink-0 items-center gap-2 border-b px-3">
          <div role="radiogroup" aria-label="Tree" className="no-drag flex rounded-md border bg-background p-0.5 text-xs">
            {(['changed', 'all'] as TreeMode[]).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={mode === value}
                onClick={() => dispatch({ type: 'ide/mode', mode: value })}
                className={cn(
                  'rounded-[5px] px-2.5 py-1 transition-colors',
                  mode === value ? 'bg-accent font-medium text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {value === 'changed' ? 'Changed' : 'All files'}
              </button>
            ))}
          </div>
          <span className="ml-auto font-mono text-[11px] text-muted-foreground tabular-nums">
            {mode === 'changed' ? detail.files.length : (allPaths?.length ?? '')}
          </span>
        </div>
        <div role="tree" aria-label="Files" className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-1.5 py-2 text-[13px]">
          {mode === 'all' && !allPaths && !treeError && (
            <p className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Loading repository tree
            </p>
          )}
          {mode === 'all' && treeError && <p className="px-2 py-2 text-xs text-destructive">{treeError}</p>}
          <TreeLevel
            entries={tree}
            depth={0}
            selected={path}
            changed={changed}
            isOpen={isOpen}
            onToggle={(dir) =>
              setToggled((prev) => {
                const key = `${mode}:${dir}`
                const copy = new Set(prev)
                if (copy.has(key)) copy.delete(key)
                else copy.add(key)
                return copy
              })
            }
            onSelect={select}
          />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="drag-region flex h-12 shrink-0 items-center gap-3 border-b px-4">
          <Breadcrumb path={path} />
          {file && <DiffStat additions={file.additions} deletions={file.deletions} />}
          <span className="flex-1" />
          <div className="no-drag flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => move(-1)} aria-label="Previous file" title="Previous file (k)">
              <ChevronLeft />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => move(1)} aria-label="Next file" title="Next file (j)">
              <ChevronRight />
            </Button>
            <Button variant="outline" size="sm" onClick={() => dispatch({ type: 'ide/close' })} aria-label="Close IDE">
              <X /> <kbd className="font-mono text-[10px] text-muted-foreground">Esc</kbd>
            </Button>
          </div>
        </header>
        <FilePane key={path} path={path} file={file} />
      </div>
    </div>
  )
}

function TreeLevel({
  entries,
  depth,
  selected,
  changed,
  isOpen,
  onToggle,
  onSelect
}: {
  entries: TreeEntry[]
  depth: number
  selected: string
  changed: Map<string, ChangedFile>
  isOpen: (dir: string) => boolean
  onToggle: (dir: string) => void
  onSelect: (path: string) => void
}) {
  const indent = { paddingLeft: 8 + depth * 12 }
  return entries.map((entry) => {
    if (entry.kind === 'dir') {
      const open = isOpen(entry.path)
      const Icon = open ? FolderOpen : Folder
      return (
        <div key={entry.path} role="none">
          <button
            type="button"
            role="treeitem"
            aria-expanded={open}
            aria-label={entry.path}
            onClick={() => onToggle(entry.path)}
            style={indent}
            className="flex h-7 w-full items-center gap-1.5 rounded-md pr-2 text-left text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
          >
            <ChevronRight className={cn('size-3 shrink-0 transition-transform', open && 'rotate-90')} />
            <Icon className="size-4 shrink-0" strokeWidth={1.75} />
            <span className="truncate" title={entry.path}>
              {entry.name}
            </span>
          </button>
          {open && (
            <div role="group">
              <TreeLevel
                entries={entry.children}
                depth={depth + 1}
                selected={selected}
                changed={changed}
                isOpen={isOpen}
                onToggle={onToggle}
                onSelect={onSelect}
              />
            </div>
          )}
        </div>
      )
    }
    const file = changed.get(entry.path)
    const status = file ? STATUS_LETTER[file.status] : null
    const active = entry.path === selected
    return (
      <button
        key={entry.path}
        type="button"
        role="treeitem"
        aria-selected={active}
        aria-label={entry.path}
        title={entry.path}
        onClick={() => onSelect(entry.path)}
        style={{ paddingLeft: 8 + depth * 12 + 16 }}
        className={cn(
          'flex h-7 w-full items-center gap-1.5 rounded-md pr-2 text-left',
          active ? 'bg-background font-medium shadow-xs ring-1 ring-border' : 'hover:bg-sidebar-accent',
          !file && !active && 'text-muted-foreground'
        )}
      >
        <FileIcon path={entry.path} className="size-3.5" />
        <span className={cn('min-w-0 flex-1 truncate', file?.status === 'removed' && 'line-through opacity-70')}>
          {entry.name}
        </span>
        {file && <DiffStat additions={file.additions} deletions={file.deletions} className="text-[10.5px]" />}
        {status && <span className={cn('w-3 shrink-0 text-center font-mono text-[11px] font-semibold', status.className)}>{status.letter}</span>}
      </button>
    )
  })
}

function Breadcrumb({ path }: { path: string }) {
  const { name, dir } = splitPath(path)
  return (
    <nav aria-label="Breadcrumb" className="no-drag flex min-w-0 items-center gap-1 text-[13px]" title={path}>
      <FileIcon path={path} />
      {dir && <span className="min-w-0 truncate text-muted-foreground">{dir.split('/').join(' / ')} /</span>}
      <span className="shrink-0 font-medium">{name}</span>
    </nav>
  )
}

// Coarse visible-range tracking for the chat context: binary search the rendered
// rows by their position instead of observing every row.
function useVisibleLines(path: string, patch: string | null) {
  const ref = useRef<HTMLDivElement>(null)
  const { updateView } = useViewStore()
  useEffect(() => {
    const container = ref.current
    if (!container) return
    let frame = 0
    let last = ''
    const measure = () => {
      frame = 0
      const rows = container.querySelectorAll<HTMLElement>('[data-new-line]')
      const box = container.getBoundingClientRect()
      const firstBelow = (y: number) => {
        let lo = 0
        let hi = rows.length
        while (lo < hi) {
          const mid = (lo + hi) >> 1
          const row = rows[mid]
          if (row && row.getBoundingClientRect().bottom <= y) lo = mid + 1
          else hi = mid
        }
        return lo
      }
      const start = rows[firstBelow(box.top)]
      const end = rows[Math.max(0, firstBelow(box.bottom) - 1)]
      const visibleLines: [number, number] | null =
        start && end ? [Number(start.dataset.newLine), Number(end.dataset.newLine)] : null
      const signature = `${path}:${visibleLines?.join('-')}`
      if (signature === last) return
      last = signature
      updateView({ file: { path, patch, visibleLines } })
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    const observer = new MutationObserver(schedule)
    observer.observe(container, { childList: true, subtree: true })
    container.addEventListener('scroll', schedule, { passive: true })
    schedule()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      container.removeEventListener('scroll', schedule)
    }
  }, [path, patch, updateView])
  useEffect(() => () => updateView({ file: null }), [updateView])
  return ref
}

function FilePane({ path, file }: { path: string; file: ChangedFile | undefined }) {
  const ref = useVisibleLines(path, file?.patch ?? null)
  return (
    <div ref={ref} className="scroll-quiet min-h-0 flex-1 overflow-y-auto">
      {file ? <DiffView file={file} /> : <FullFile path={path} />}
    </div>
  )
}

const FULL_FILE_LIMIT = 5000

function FullFile({ path }: { path: string }) {
  const { loadFile } = useReview()
  const [state, setState] = useState<{ lines: string[] } | { error: string } | null>(null)
  useEffect(() => {
    let live = true
    loadFile(path)
      .then((text) => live && setState({ lines: fileLines(text).slice(0, FULL_FILE_LIMIT) }))
      .catch((error: unknown) => live && setState({ error: errorMessage(error) }))
    return () => {
      live = false
    }
  }, [path, loadFile])
  const lines = state && 'lines' in state ? state.lines : []
  const tokens = useHighlighted(lines, languageFor(path))

  if (!state) {
    return (
      <p className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading {splitPath(path).name}
      </p>
    )
  }
  if ('error' in state) return <p className="p-6 text-sm text-destructive">{state.error}</p>
  return (
    <div className="py-2 font-mono text-[12px] leading-5">
      <p className="micro-label px-4 pb-2">Unchanged in this pull request · read only</p>
      {lines.map((text, i) => {
        const lineTokens = tokens?.[i]
        return (
          <div key={i} className="flex" data-new-line={i + 1}>
            <span className="w-14 shrink-0 pr-3 text-right text-muted-foreground/60 select-none tabular-nums">{i + 1}</span>
            <span className="min-w-0 flex-1 pr-4 whitespace-pre-wrap [overflow-wrap:anywhere]">
              {lineTokens
                ? lineTokens.map((token, t) => (
                    <span key={t} className="tok" style={token.style}>
                      {token.content}
                    </span>
                  ))
                : text || ' '}
            </span>
          </div>
        )
      })}
    </div>
  )
}
