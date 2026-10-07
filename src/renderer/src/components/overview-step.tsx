import { useState } from 'react'
import { toast } from 'sonner'
import type { ChangedFile, Guide } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { FileRow } from '@/components/file-row'
import { Markdown } from '@/components/markdown'
import { pad2 } from '@/lib/paths'
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

export function OverviewStep() {
  const { detail, session, dispatch } = useReview()
  const { overview } = session.guide
  const files = guideOrder(session.guide, detail.files)

  return (
    <div className="@container px-8 py-8">
      <div className="mx-auto grid max-w-[1400px] gap-10 @4xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-8">
          <section className="space-y-4">
            <p className="micro-label">Before you start</p>
            <h2 className="text-[28px] leading-tight font-semibold tracking-tight">Overview</h2>
            <Markdown className="text-[15px] leading-7 text-foreground/85">{overview.summary}</Markdown>
            {overview.points.length > 0 && (
              <ol className="space-y-3 pt-1">
                {overview.points.map((point, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="mt-0.5 flex h-5 shrink-0 items-center rounded-md border bg-card px-1.5 font-mono text-[11px] text-muted-foreground tabular-nums">
                      {pad2(i + 1)}
                    </span>
                    <Markdown className="text-[14px] leading-6">{point}</Markdown>
                  </li>
                ))}
              </ol>
            )}
          </section>
          <section className="space-y-3 border-t pt-6">
            <p className="micro-label">Description</p>
            {detail.body.trim() ? (
              <Markdown className="text-foreground/85">{detail.body}</Markdown>
            ) : (
              <p className="text-sm text-muted-foreground italic">No description provided.</p>
            )}
          </section>
          <ConversationComment />
        </div>
        <section className="min-w-0 space-y-3 self-start rounded-xl border bg-card p-4 shadow-soft">
          <div className="flex items-baseline justify-between px-1">
            <h3 className="text-sm font-medium">
              Files <span className="ml-1 font-mono text-xs text-muted-foreground">{files.length}</span>
            </h3>
            <span className="text-xs text-muted-foreground">in reading order</span>
          </div>
          <ul>
            {files.map((file) => (
              <FileRow key={file.path} file={file} onSelect={() => dispatch({ type: 'ide/open', path: file.path })} />
            ))}
          </ul>
        </section>
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
    <section className="space-y-3 border-t pt-6">
      <p className="micro-label">Conversation</p>
      <Textarea
        aria-label="Comment on the pull request"
        placeholder="Add a comment to the conversation"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        className="min-h-20 bg-card"
      />
      <div className="flex justify-end">
        <Button size="sm" variant="outline" disabled={!body.trim() || sending} onClick={() => void send()}>
          Comment
        </Button>
      </div>
    </section>
  )
}
