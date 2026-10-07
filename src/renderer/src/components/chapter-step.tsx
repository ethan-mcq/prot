import type { ChangedFile, Chapter } from '@shared/types'
import { Checkbox } from '@/components/ui/checkbox'
import { FileCard } from '@/components/file-card'
import { FileRow } from '@/components/file-row'
import { Markdown } from '@/components/markdown'
import { pad2 } from '@/lib/paths'
import { useReview } from '@/lib/review-context'
import { chapterReviewKeys, isReviewed } from '@/lib/review-session'

export function chapterFiles(chapter: Chapter, files: ChangedFile[]): ChangedFile[] {
  const byPath = new Map(files.map((file) => [file.path, file]))
  const result: ChangedFile[] = []
  for (const path of chapter.files) {
    const file = byPath.get(path)
    if (file) result.push(file)
  }
  return result
}

export function ChapterStep({ index }: { index: number }) {
  const { detail, session, dispatch } = useReview()
  const chapter = session.guide.chapters[index]
  if (!chapter) return null
  const files = chapterFiles(chapter, detail.files)
  const keys = chapterReviewKeys(chapter)
  const reviewed = isReviewed(session, keys)

  return (
    <div className="@container px-8 py-8">
      <div className="mx-auto grid max-w-[1400px] gap-8 @5xl:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <aside className="scroll-quiet space-y-5 self-start @5xl:sticky @5xl:top-8 @5xl:max-h-[calc(100vh-14rem)] @5xl:overflow-y-auto @5xl:pr-2">
          <div className="flex items-center justify-between">
            <span className="micro-label">Chapter</span>
            <span className="font-mono text-xs text-muted-foreground tabular-nums">
              {pad2(index + 1)} / {pad2(session.guide.chapters.length)}
            </span>
          </div>
          <h2 className="font-serif text-[26px] leading-tight font-semibold tracking-tight">{chapter.title}</h2>
          <label className="flex w-fit cursor-pointer items-center gap-2 rounded-md border bg-card px-2.5 py-1.5 text-sm shadow-xs transition-colors hover:bg-accent has-[[data-state=checked]]:border-added/40 has-[[data-state=checked]]:text-added">
            <Checkbox
              checked={reviewed}
              aria-label="Chapter reviewed"
              onCheckedChange={(value) => dispatch({ type: 'reviewed/set', keys, reviewed: value === true })}
            />
            Reviewed
          </label>
          <Markdown className="text-[15px] leading-7 text-foreground/85">{chapter.summary}</Markdown>
          {files.length > 0 && (
            <div className="space-y-2">
              <p className="micro-label">Files {files.length}</p>
              <ul className="-mx-2">
                {files.map((file) => (
                  <FileRow
                    key={file.path}
                    file={file}
                    onSelect={() =>
                      document.getElementById(`file-${file.path}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                    }
                  />
                ))}
              </ul>
            </div>
          )}
        </aside>
        <div className="min-w-0 space-y-4">
          {files.map((file) => (
            <FileCard key={file.path} file={file} />
          ))}
          {files.length === 0 && (
            <p className="rounded-xl border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
              This chapter has no file changes of its own.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
