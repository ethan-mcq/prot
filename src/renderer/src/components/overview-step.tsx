import { useState } from 'react'
import { GitCompare, ScrollText } from 'lucide-react'
import { toast } from 'sonner'
import type { ChangedFile, Guide } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { FileTree } from '@/components/file-tree'
import { Markdown } from '@/components/markdown'
import { PaneHeader } from '@/components/pane'
import { errorMessage } from '@/lib/utils'
import { useReview } from '@/lib/review-context'

export function guideOrder(guide: Guide, files: ChangedFile[]): ChangedFile[] {
  const rank = new Map<string, number>()
  guide.chapters.forEach((chapter) => {
    for (const path of chapter.files) {
      if (!rank.has(path)) rank.set(path, rank.size)
    }
  })
  return [...files].sort((a, b) => (rank.get(a.path) ?? Infinity) - (rank.get(b.path) ?? Infinity))
}

const FILE_COUNT = /^(.*?)\s*\((\d+ files?)\)$/

export function OverviewStep() {
  const { detail, session, dispatch } = useReview()
  const { overview } = session.guide
  const files = guideOrder(session.guide, detail.files)
  const { ref } = detail.summary

  return (
    <div className="flex h-full gap-2">
      <div className="pane flex min-w-0 flex-1 flex-col">
        <PaneHeader icon={<ScrollText />} title="Overview" detail={`${ref.repo}#${ref.number}`} />
        <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-5 pt-2 pb-6 font-mono text-[12.5px] leading-[1.7]">
          <div className="max-w-[720px] space-y-6">
            <h2 className="text-[16px] font-semibold text-foreground">Overview</h2>
            <section className="space-y-2">
              <h3 className="font-semibold">Summary</h3>
              <Markdown className="font-copy text-[13px] leading-[1.75] text-foreground/85">{overview.summary}</Markdown>
            </section>
            {overview.points.length > 0 && (
              <ul className="space-y-1.5">
                {overview.points.map((point, i) => {
                  const [, text, count] = FILE_COUNT.exec(point) ?? [point, point, null]
                  return (
                    <li key={i} className="flex gap-2.5">
                      <span aria-hidden className="text-muted-foreground">•</span>
                      <div className="min-w-0">
                        <Markdown className="text-[12.5px] leading-[1.7]">{text ?? point}</Markdown>
                        {count && <p className="text-muted-foreground">└ {count}</p>}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
            <section className="space-y-2">
              <h3 className="font-semibold">Description</h3>
              {detail.body.trim() ? (
                <Markdown className="font-copy text-[13px] leading-[1.75] text-foreground/85">{detail.body}</Markdown>
              ) : (
                <p className="text-muted-foreground">No description provided.</p>
              )}
            </section>
            <ConversationComment />
          </div>
        </div>
      </div>
      <div className="pane flex w-[380px] shrink-0 flex-col">
        <PaneHeader
          icon={<GitCompare />}
          title="Changed files"
          detail="in reading order"
          actions={<span className="px-1.5 font-mono text-[11px] text-muted-foreground tabular-nums">{files.length}</span>}
        />
        <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          <FileTree files={files} onSelect={(file) => dispatch({ type: 'ide/open', path: file.path })} />
        </div>
      </div>
    </div>
  )
}

function ConversationComment() {
  const { detail } = useReview()
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)

  async function send() {
    setSending(true)
    try {
      await window.prot.pulls.comment(detail.summary.ref, body.trim())
      setBody('')
      toast.success('Comment posted')
    } catch (error) {
      toast.error('Could not post the comment', { description: errorMessage(error) })
    } finally {
      setSending(false)
    }
  }

  return (
    <section className="space-y-2">
      <h3 className="font-semibold">Conversation</h3>
      <Textarea
        aria-label="Comment on the pull request"
        placeholder="Add a comment to the conversation"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        className="min-h-20 bg-card font-mono text-[12.5px]"
      />
      <div className="flex justify-end">
        <Button size="sm" variant="outline" disabled={!body.trim() || sending} onClick={() => void send()}>
          Comment
        </Button>
      </div>
    </section>
  )
}
