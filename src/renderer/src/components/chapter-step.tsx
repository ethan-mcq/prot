import { BookOpen } from 'lucide-react'
import type { ChangedFile, Chapter } from '@shared/types'
import { Checkbox } from '@/components/ui/checkbox'
import { FileCard } from '@/components/file-card'
import { FileTree } from '@/components/file-tree'
import { Markdown } from '@/components/markdown'
import { PaneHeader } from '@/components/pane'
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

  const { ref } = detail.summary

  return (
    <div className="flex h-full gap-2">
      <aside className="pane flex w-[340px] shrink-0 flex-col">
        <PaneHeader
          icon={<BookOpen />}
          title="Chapter"
          detail={`${ref.repo}#${ref.number}`}
          actions={
            <span className="px-1.5 font-mono text-[11px] text-muted-foreground tabular-nums">
              {pad2(index + 1)} / {pad2(session.guide.chapters.length)}
            </span>
          }
        />
        <div className="scroll-quiet min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pt-2 pb-5 font-mono text-[12.5px] leading-[1.7]">
          <h2 className="text-[16px] font-semibold text-foreground break-words">{chapter.title}</h2>
          <label className="flex w-fit cursor-pointer items-center gap-2 rounded-[6px] border border-pane-border px-2 py-1 text-[12px] transition-colors hover:bg-accent has-[[data-state=checked]]:border-added/40 has-[[data-state=checked]]:text-added">
            <Checkbox
              checked={reviewed}
              aria-label="Chapter reviewed"
              onCheckedChange={(value) => dispatch({ type: 'reviewed/set', keys, reviewed: value === true })}
            />
            Reviewed
          </label>
          <Markdown className="font-copy text-[13px] leading-[1.75] text-foreground/85">{chapter.summary}</Markdown>
          {files.length > 0 && (
            <section className="space-y-1.5">
              <h3 className="font-semibold">
                Files <span className="font-normal text-muted-foreground">{files.length}</span>
              </h3>
              <FileTree
                files={files}
                onSelect={(file) =>
                  document.getElementById(`file-${file.path}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }
              />
            </section>
          )}
        </div>
      </aside>
      <div className="scroll-quiet min-w-0 flex-1 space-y-2 overflow-y-auto rounded-[12px]">
        {files.map((file) => (
          <FileCard key={file.path} file={file} />
        ))}
        {files.length === 0 && (
          <div className="pane px-6 py-10 text-center font-mono text-[12.5px] text-muted-foreground">
            This chapter has no file changes of its own.
          </div>
        )}
      </div>
    </div>
  )
}
