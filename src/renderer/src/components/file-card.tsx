import { useState } from 'react'
import { ChevronDown, ChevronUp, Maximize2 } from 'lucide-react'
import type { ChangedFile } from '@shared/types'
import { Checkbox } from '@/components/ui/checkbox'
import { DiffStat } from '@/components/diff-stat'
import { DiffView } from '@/components/diff-view'
import { FileIcon } from '@/components/file-icon'
import { PaneButton } from '@/components/pane'
import { SinceGuideTag } from '@/components/since-guide-tag'
import { splitPath } from '@/lib/paths'
import { useReview } from '@/lib/review-context'
import { isChangedSinceGuide, isReviewed } from '@/lib/review-session'
import { cn } from '@/lib/utils'

const STATUS_TAG: Record<ChangedFile['status'], { label: string; className: string }> = {
  added: { label: 'New', className: 'text-added' },
  removed: { label: 'Deleted', className: 'text-removed' },
  renamed: { label: 'Renamed', className: 'text-command' },
  modified: { label: 'Modified', className: 'text-modified' }
}

export function FileCard({ file }: { file: ChangedFile }) {
  const { session, dispatch } = useReview()
  const reviewed = isReviewed(session, [file.path])
  const [open, setOpen] = useState(!reviewed || session.focus?.path === file.path)
  const { name, dir } = splitPath(file.path)
  const tag = STATUS_TAG[file.status]

  function setReviewed(value: boolean) {
    dispatch({ type: 'reviewed/set', keys: [file.path], reviewed: value })
    setOpen(!value)
  }

  return (
    <section aria-label={file.path} className="pane overflow-clip" id={`file-${file.path}`}>
      <header className={cn('sticky top-0 z-10 flex h-10 items-center gap-2 bg-card pr-2 pl-3.5', open && 'border-b border-pane-border')}>
        <FileIcon path={file.path} className="size-3.5" />
        <span className="flex min-w-0 font-mono text-[12px]" title={file.path}>
          {dir && <span className="truncate text-muted-foreground">{dir}/</span>}
          <span className="shrink-0 font-medium">{name}</span>
        </span>
        <span className={cn('shrink-0 rounded-[4px] border border-current/25 px-1 font-mono text-[10px] leading-[15px]', tag.className)}>
          {tag.label}
        </span>
        {isChangedSinceGuide(session.drift, file.path) && <SinceGuideTag />}
        <DiffStat additions={file.additions} deletions={file.deletions} className="text-[11.5px]" />
        <span className="flex-1" />
        <label className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-[6px] px-1.5 py-1 font-mono text-[11.5px] text-muted-foreground transition-colors hover:bg-accent has-[[data-state=checked]]:text-added">
          <Checkbox
            checked={reviewed}
            onCheckedChange={(value) => setReviewed(value === true)}
            aria-label={`Reviewed ${file.path}`}
            className="size-3.5"
          />
          Reviewed
        </label>
        <PaneButton
          aria-expanded={open}
          aria-label={`${open ? 'Collapse' : 'Expand'} ${file.path}`}
          title={open ? 'Collapse' : 'Expand'}
          onClick={() => setOpen(!open)}
        >
          {open ? <ChevronUp /> : <ChevronDown />}
        </PaneButton>
        <PaneButton
          aria-label={`Open ${file.path} in IDE`}
          title="Open in IDE"
          onClick={() => dispatch({ type: 'ide/open', path: file.path })}
        >
          <Maximize2 />
        </PaneButton>
      </header>
      {open && <DiffView file={file} />}
    </section>
  )
}
