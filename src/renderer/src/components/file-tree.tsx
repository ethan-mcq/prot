import { Check, Maximize2 } from 'lucide-react'
import type { ChangedFile, FileStatus } from '@shared/types'
import { DiffStat } from '@/components/diff-stat'
import { splitPath } from '@/lib/paths'
import { useReview } from '@/lib/review-context'
import { isReviewed } from '@/lib/review-session'
import { cn } from '@/lib/utils'

export const STATUS_LETTER: Record<FileStatus, { letter: string; className: string }> = {
  added: { letter: 'A', className: 'text-added' },
  modified: { letter: 'M', className: 'text-modified' },
  removed: { letter: 'D', className: 'text-removed' },
  renamed: { letter: 'R', className: 'text-command' }
}

function groupByDir(files: ChangedFile[]): { dir: string; files: ChangedFile[] }[] {
  const groups = new Map<string, ChangedFile[]>()
  for (const file of files) {
    const { dir } = splitPath(file.path)
    groups.set(dir, [...(groups.get(dir) ?? []), file])
  }
  return [...groups].map(([dir, grouped]) => ({ dir, files: grouped }))
}

export function FileTree({ files, onSelect }: { files: ChangedFile[]; onSelect: (file: ChangedFile) => void }) {
  return (
    <ul className="font-mono text-[12px] leading-6">
      {groupByDir(files).map((group) => (
        <li key={group.dir}>
          {group.dir && (
            <p className="truncate font-medium" title={group.dir}>
              <span className="mr-1.5 text-muted-foreground">▼</span>
              {group.dir}
            </p>
          )}
          <ul className={cn(group.dir && 'pl-4')}>
            {group.files.map((file) => (
              <FileLine key={file.path} file={file} onSelect={() => onSelect(file)} />
            ))}
          </ul>
        </li>
      ))}
    </ul>
  )
}

function FileLine({ file, onSelect }: { file: ChangedFile; onSelect: () => void }) {
  const { session, dispatch } = useReview()
  const status = STATUS_LETTER[file.status]
  const reviewed = isReviewed(session, [file.path])
  return (
    <li className="group/file relative flex items-center rounded-[5px] transition-colors hover:bg-accent">
      <button
        type="button"
        onClick={onSelect}
        title={file.path}
        aria-label={file.path}
        className="flex min-w-0 flex-1 items-center gap-2 pr-8 pl-1 text-left"
      >
        <span className={cn('w-2.5 shrink-0 text-center font-semibold', status.className)}>{status.letter}</span>
        <span className={cn('min-w-0 flex-1 truncate', file.status === 'removed' && 'line-through opacity-70')}>
          {splitPath(file.path).name}
        </span>
        {reviewed && <Check aria-label="Reviewed" className="size-3 shrink-0 text-added" strokeWidth={3} />}
        <DiffStat additions={file.additions} deletions={file.deletions} className="text-[11px]" />
      </button>
      <button
        type="button"
        aria-label={`Open ${file.path} in IDE`}
        title="Open in IDE"
        onClick={() => dispatch({ type: 'ide/open', path: file.path })}
        className="absolute right-0.5 flex size-5 items-center justify-center rounded-[4px] text-muted-foreground opacity-0 transition-opacity group-hover/file:opacity-100 hover:bg-card hover:text-foreground focus-visible:opacity-100"
      >
        <Maximize2 className="size-3" />
      </button>
    </li>
  )
}
