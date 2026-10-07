import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui'
import { toast } from 'sonner'
import type { ReviewEvent } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useReview } from '@/lib/review-context'
import { cn, errorMessage } from '@/lib/utils'

const CHOICES: { event: ReviewEvent; label: string; hint: string; tone: string }[] = [
  { event: 'COMMENT', label: 'Comment', hint: 'General feedback without a verdict.', tone: 'data-[state=checked]:border-frame data-[state=checked]:bg-muted' },
  { event: 'APPROVE', label: 'Approve', hint: 'Ready to merge as it is.', tone: 'data-[state=checked]:border-added/50 data-[state=checked]:bg-added-line data-[state=checked]:text-added' },
  {
    event: 'REQUEST_CHANGES',
    label: 'Request changes',
    hint: 'Must be addressed before merging.',
    tone: 'data-[state=checked]:border-removed/50 data-[state=checked]:bg-removed-line data-[state=checked]:text-removed'
  }
]

export function ReviewDialog({
  open,
  onOpenChange,
  viewer,
  onSubmitted
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  viewer: string
  onSubmitted: () => void
}) {
  const { detail, session, dispatch } = useReview()
  const [event, setEvent] = useState<ReviewEvent>('COMMENT')
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const ownPull = detail.summary.author.login === viewer
  const drafts = session.drafts

  const missing =
    event === 'REQUEST_CHANGES' && !body.trim()
      ? 'Explain what needs to change.'
      : event === 'COMMENT' && !body.trim() && drafts.length === 0
        ? 'Write a summary or add an inline comment first.'
        : null

  async function submit() {
    setSubmitting(true)
    try {
      await window.prot.pulls.submitReview(detail.summary.ref, { commitId: detail.head.sha, event, body: body.trim(), comments: drafts })
      toast.success(event === 'APPROVE' ? 'Approved' : event === 'REQUEST_CHANGES' ? 'Changes requested' : 'Review submitted')
      dispatch({ type: 'drafts/clear' })
      setBody('')
      setEvent('COMMENT')
      onOpenChange(false)
      onSubmitted()
    } catch (error) {
      toast.error('Could not submit the review', { description: errorMessage(error) })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 p-5 sm:max-w-xl">
        <DialogHeader className="gap-1">
          <DialogTitle className="text-[15px] font-medium">Finish your review</DialogTitle>
          <DialogDescription className="font-mono text-[11.5px]">
            {detail.summary.ref.owner}/{detail.summary.ref.repo}#{detail.summary.ref.number}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="review-summary" className="font-mono text-[12px] font-bold">
            Summary
          </Label>
          <Textarea
            id="review-summary"
            placeholder="Overall thoughts on this change"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="min-h-28 font-mono text-[12.5px]"
          />
        </div>
        <RadioGroupPrimitive.Root
          aria-label="Review verdict"
          value={event}
          onValueChange={(value) => setEvent(value as ReviewEvent)}
          className="grid grid-cols-3 gap-2"
        >
          {CHOICES.map((choice) => {
            const blocked = ownPull && choice.event !== 'COMMENT'
            return (
              <RadioGroupPrimitive.Item
                key={choice.event}
                value={choice.event}
                aria-label={choice.label}
                disabled={blocked}
                title={blocked ? 'You cannot approve or request changes on your own pull request' : undefined}
                className={cn(
                  'flex flex-col items-start gap-1 rounded-[9px] border border-pane-border bg-card p-3 text-left transition-colors outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
                  choice.tone
                )}
              >
                <span className="text-[13px] font-medium">{choice.label}</span>
                <span className="font-mono text-[11px] leading-4 text-muted-foreground">{choice.hint}</span>
              </RadioGroupPrimitive.Item>
            )
          })}
        </RadioGroupPrimitive.Root>
        <div className="space-y-2">
          <p className="font-mono text-[12px] font-bold">
            ## Pending comments <span className="font-normal text-muted-foreground">{drafts.length}</span>
          </p>
          {drafts.length === 0 ? (
            <p className="font-mono text-[12px] text-muted-foreground">Hover a line in any diff and press + to add one.</p>
          ) : (
            <ul className="scroll-quiet max-h-32 space-y-1 overflow-y-auto font-mono text-[12px]">
              {drafts.map((draft) => (
                <li key={draft.id} className="flex gap-2">
                  <span aria-hidden className="text-muted-foreground">•</span>
                  <span className="shrink-0 text-path">
                    {draft.path.split('/').pop()}:{draft.line}
                  </span>
                  <span className="truncate">{draft.body}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <DialogFooter className="items-center">
          {missing && <span className="mr-auto font-mono text-[11.5px] text-muted-foreground">{missing}</span>}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={submitting || missing !== null} onClick={() => void submit()}>
            {submitting && <Loader2 className="animate-spin" />}
            Submit review
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
