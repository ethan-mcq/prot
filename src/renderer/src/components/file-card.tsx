import { useState } from 'react'
import { ChevronRight, Maximize2 } from 'lucide-react'
import type { ChangedFile } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DiffStat } from '@/components/diff-stat'
import { DiffView } from '@/components/diff-view'
import { FileIcon } from '@/components/file-icon'
import { splitPath } from '@/lib/paths'
import { useReview } from '@/lib/review-context'
import { isReviewed } from '@/lib/review-session'
import { cn } from '@/lib/utils'

const STATUS_LABEL: Record<ChangedFile['status'], string | null> = {
  added: 'New',
  removed: 'Deleted',
  renamed: 'Renamed',
  modified: null
}

export function FileCard({ file }: { file: ChangedFile }) {
  const { session, dispatch } = useReview()
  const reviewed = isReviewed(session, [file.path])
  const [open, setOpen] = useState(!reviewed)
  const { name, dir } = splitPath(file.path)
  const status = STATUS_LABEL[file.status]

  function setReviewed(value: boolean) {
    dispatch({ type: 'reviewed/set', keys: [file.path], reviewed: value })
    setOpen(!value)
  }

  return (
    <section
      aria-label={file.path}
      className="overflow-hidden rounded-xl border bg-card shadow-soft"
      id={`file-${file.path}`}
    >
      <header className={cn('flex h-11 items-center gap-2 bg-card px-3', open && 'border-b')}>
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${open ? 'Collapse' : 'Expand'} ${file.path}`}
          onClick={() => setOpen(!open)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-1 text-left"
          title={file.path}
        >
          <ChevronRight
            className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')}
          />
          <FileIcon path={file.path} />
          <span className="truncate text-[13px] font-medium">{name}</span>
          {dir && <span className="min-w-0 truncate text-xs text-muted-foreground">{dir}</span>}
          {status && (
            <span className="shrink-0 rounded-full border px-1.5 py-px text-[10.5px] font-medium text-muted-foreground">
              {status}
            </span>
          )}
          <DiffStat additions={file.additions} deletions={file.deletions} className="ml-1" />
        </button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Open ${file.path} in IDE`}
          title="Open in IDE"
          onClick={() => dispatch({ type: 'ide/open', path: file.path })}
        >
          <Maximize2 className="size-3.5" />
        </Button>
        <label className="flex shrink-0 cursor-pointer items-center gap-2 rounded-md border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent has-[[data-state=checked]]:border-added/40 has-[[data-state=checked]]:text-added">
          <Checkbox
            checked={reviewed}
            onCheckedChange={(value) => setReviewed(value === true)}
            aria-label={`Reviewed ${file.path}`}
          />
          Reviewed
        </label>
      </header>
      {open && <DiffView file={file} />}
    </section>
  )
}
