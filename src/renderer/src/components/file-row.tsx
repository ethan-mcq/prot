import { Check, Maximize2 } from 'lucide-react'
import type { ChangedFile } from '@shared/types'
import { DiffStat } from '@/components/diff-stat'
import { FileIcon } from '@/components/file-icon'
import { splitPath } from '@/lib/paths'
import { useReview } from '@/lib/review-context'
import { isReviewed } from '@/lib/review-session'

export function FileRow({ file, onSelect }: { file: ChangedFile; onSelect: () => void }) {
  const { session, dispatch } = useReview()
  const { name, dir } = splitPath(file.path)
  const reviewed = isReviewed(session, [file.path])
  return (
    <li className="group/file relative flex items-center rounded-md transition-colors hover:bg-accent">
      <button
        type="button"
        onClick={onSelect}
        title={file.path}
        aria-label={file.path}
        className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-10 pl-2 text-left"
      >
        <FileIcon path={file.path} />
        <span className="shrink-0 text-[13px] font-medium">{name}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{dir}</span>
        {reviewed && <Check aria-label="Reviewed" className="size-3.5 shrink-0 text-added" strokeWidth={2.5} />}
        <DiffStat additions={file.additions} deletions={file.deletions} />
      </button>
      <button
        type="button"
        aria-label={`Open ${file.path} in IDE`}
        title="Open in IDE"
        onClick={() => dispatch({ type: 'ide/open', path: file.path })}
        className="absolute right-1 flex size-7 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover/file:opacity-100 hover:bg-background hover:text-foreground focus-visible:opacity-100"
      >
        <Maximize2 className="size-3.5" />
      </button>
    </li>
  )
}
