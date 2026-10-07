import { useMemo, useState, type ReactNode } from 'react'
import { Loader2, Pencil, Plus, Trash2, UnfoldVertical } from 'lucide-react'
import { toast } from 'sonner'
import type { ChangedFile, DiffHunk, DiffLine, DraftComment, ReviewComment } from '@shared/types'
import { parsePatch } from '@shared/diff'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Markdown } from '@/components/markdown'
import { UserAvatar } from '@/components/user-avatar'
import type { Token } from '@/lib/highlight'
import { languageFor } from '@/lib/highlight'
import { useHighlighted } from '@/lib/hooks'
import { fileLines, relativeTime } from '@/lib/paths'
import { useReview } from '@/lib/review-context'
import { draftAnchor } from '@/lib/review-session'
import { cn, errorMessage } from '@/lib/utils'

type Gap = { id: string; from: number; to: number | null; oldMinusNew: number; section: string | null }

type Row =
  | { kind: 'line'; key: string; line: DiffLine; tokenSide: 'old' | 'new'; tokenIndex: number }
  | { kind: 'gap'; gap: Gap }

function buildRows(hunks: DiffHunk[], trailingGap: boolean): { rows: Row[]; oldSide: string[]; newSide: string[] } {
  const rows: Row[] = []
  const oldSide: string[] = []
  const newSide: string[] = []
  let nextNew = 1
  let oldMinusNew = 0
  hunks.forEach((hunk, h) => {
    // A zero-length side in a hunk header names the line *before* the change.
    const newStart = hunk.newLines === 0 ? hunk.newStart + 1 : hunk.newStart
    const oldStart = hunk.oldLines === 0 ? hunk.oldStart + 1 : hunk.oldStart
    if (newStart > nextNew) {
      rows.push({
        kind: 'gap',
        gap: { id: `gap-${h}`, from: nextNew, to: newStart - 1, oldMinusNew: oldStart - newStart, section: hunk.section }
      })
    }
    hunk.lines.forEach((line, i) => {
      const key = `${h}:${i}`
      if (line.kind === 'del') {
        rows.push({ kind: 'line', key, line, tokenSide: 'old', tokenIndex: oldSide.length })
        oldSide.push(line.text)
      } else {
        rows.push({ kind: 'line', key, line, tokenSide: 'new', tokenIndex: newSide.length })
        newSide.push(line.text)
        if (line.kind === 'context') oldSide.push(line.text)
      }
    })
    nextNew = newStart + hunk.newLines
    oldMinusNew = oldStart + hunk.oldLines - nextNew
  })
  if (trailingGap && hunks.length > 0) {
    rows.push({ kind: 'gap', gap: { id: 'gap-end', from: nextNew, to: null, oldMinusNew, section: null } })
  }
  return { rows, oldSide, newSide }
}

function threadKey(path: string, side: string, line: number): string {
  return `${path}:${side}:${line}`
}

export function DiffView({ file }: { file: ChangedFile }) {
  const { detail, session, dispatch, loadFile } = useReview()
  const lang = languageFor(file.path)
  const hasGaps = file.status === 'modified' || file.status === 'renamed'
  const { rows, oldSide, newSide } = useMemo(
    () => buildRows(file.patch ? parsePatch(file.patch) : [], hasGaps),
    [file.patch, hasGaps]
  )
  const oldTokens = useHighlighted(oldSide, lang)
  const newTokens = useHighlighted(newSide, lang)

  const [content, setContent] = useState<string[] | null>(null)
  const [loadingGap, setLoadingGap] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string[]>([])
  const contentTokens = useHighlighted(expanded.length > 0 && content ? content : [], lang)
  const [composerAt, setComposerAt] = useState<string | null>(null)

  const comments = useMemo(() => {
    const byLine = new Map<string, ReviewComment[]>()
    const roots = new Map<number, string>()
    const outdated: ReviewComment[] = []
    for (const comment of detail.reviewComments) {
      if (comment.path !== file.path) continue
      const parentKey = comment.inReplyToId === null ? undefined : roots.get(comment.inReplyToId)
      const key = parentKey ?? (comment.line === null ? null : threadKey(comment.path, comment.side, comment.line))
      if (key === null) {
        outdated.push(comment)
        continue
      }
      roots.set(comment.id, key)
      byLine.set(key, [...(byLine.get(key) ?? []), comment])
    }
    return { byLine, outdated }
  }, [detail.reviewComments, file.path])

  const drafts = session.drafts.filter((d) => d.path === file.path)

  async function expand(gap: Gap) {
    if (content) {
      setExpanded((prev) => [...prev, gap.id])
      return
    }
    setLoadingGap(gap.id)
    try {
      const text = await loadFile(file.path)
      setContent(fileLines(text))
      setExpanded((prev) => [...prev, gap.id])
    } catch (error) {
      toast.error(`Could not load ${file.path}`, { description: errorMessage(error) })
    } finally {
      setLoadingGap(null)
    }
  }

  if (!file.patch) {
    return (
      <p className="px-4 py-6 text-center text-sm text-muted-foreground">
        No textual diff for this file. It may be binary, renamed without changes, or too large for GitHub to show.
      </p>
    )
  }

  function tokensFor(row: Extract<Row, { kind: 'line' }>): Token[] | undefined {
    const side = row.tokenSide === 'old' ? oldTokens : newTokens
    return side?.[row.tokenIndex]
  }

  return (
    <div className="font-mono text-[12px] leading-5">
      {rows.map((row) => {
        if (row.kind === 'gap') {
          const gap = row.gap
          const to = gap.to ?? content?.length ?? null
          if (to !== null && to < gap.from) return null
          if (expanded.includes(gap.id) && content) {
            const lines: ReactNode[] = []
            for (let n = gap.from; n <= (to ?? content.length); n++) {
              const line: DiffLine = { kind: 'context', oldLine: n + gap.oldMinusNew, newLine: n, text: content[n - 1] ?? '' }
              lines.push(<LineRow key={`${gap.id}-${n}`} line={line} tokens={contentTokens?.[n - 1]} />)
            }
            return lines
          }
          return (
            <GapButton
              key={gap.id}
              count={to === null ? null : to - gap.from + 1}
              section={gap.section}
              loading={loadingGap === gap.id}
              onClick={() => void expand(gap)}
            />
          )
        }
        const anchor = draftAnchor(row.line)
        const key = anchor ? threadKey(file.path, anchor.side, anchor.line) : null
        const thread = key ? comments.byLine.get(key) : undefined
        const lineDrafts = anchor
          ? drafts.filter((d) => d.side === anchor.side && d.line === anchor.line)
          : []
        return (
          <div key={row.key}>
            <LineRow
              line={row.line}
              tokens={tokensFor(row)}
              onComment={anchor ? () => setComposerAt(row.key) : undefined}
            />
            {thread && <CommentThread comments={thread} />}
            {lineDrafts.map((draft) => (
              <DraftCard key={draft.id} draft={draft} />
            ))}
            {composerAt === row.key && (
              <Composer
                label={`Comment on line ${anchor?.line}`}
                onCancel={() => setComposerAt(null)}
                onSave={(body) => {
                  dispatch({ type: 'draft/add', path: file.path, line: row.line, body })
                  setComposerAt(null)
                }}
              />
            )}
          </div>
        )
      })}
      {comments.outdated.length > 0 && (
        <div className="border-t">
          <p className="micro-label px-4 pt-3">Outdated comments</p>
          <CommentThread comments={comments.outdated} />
        </div>
      )}
    </div>
  )
}

const ROW_TONE = {
  add: { row: 'bg-added-line', marker: 'text-added', sign: '+' },
  del: { row: 'bg-removed-line', marker: 'text-removed', sign: '-' },
  context: { row: '', marker: 'text-muted-foreground', sign: ' ' }
} as const

function LineRow({ line, tokens, onComment }: { line: DiffLine; tokens: Token[] | undefined; onComment?: () => void }) {
  const tone = ROW_TONE[line.kind]
  const label = line.kind === 'del' ? `Comment on removed line ${line.oldLine}` : `Comment on line ${line.newLine}`
  return (
    <div className={cn('group/row relative flex min-w-0', tone.row)} data-new-line={line.newLine ?? undefined}>
      <span className="w-12 shrink-0 pr-2 text-right text-muted-foreground/60 select-none tabular-nums">
        {line.oldLine ?? ''}
      </span>
      <span className="w-12 shrink-0 pr-2 text-right text-muted-foreground/60 select-none tabular-nums">
        {line.newLine ?? ''}
      </span>
      {onComment && (
        <button
          type="button"
          tabIndex={-1}
          aria-label={label}
          onClick={onComment}
          className="absolute top-0.5 left-1 flex size-4 items-center justify-center rounded-sm bg-sky-600 text-white opacity-0 shadow-sm transition-opacity group-hover/row:opacity-100 hover:bg-sky-700 focus-visible:opacity-100"
        >
          <Plus className="size-3" strokeWidth={3} />
        </button>
      )}
      <span className={cn('w-5 shrink-0 text-center select-none', tone.marker)}>{tone.sign}</span>
      <span className="min-w-0 flex-1 pr-4 whitespace-pre-wrap [overflow-wrap:anywhere]">
        {tokens
          ? tokens.map((token, i) => (
              <span key={i} className="tok" style={token.style}>
                {token.content}
              </span>
            ))
          : line.text || ' '}
      </span>
    </div>
  )
}

function GapButton({
  count,
  section,
  loading,
  onClick
}: {
  count: number | null
  section: string | null
  loading: boolean
  onClick: () => void
}) {
  const label = count === null ? 'Show the rest of the file' : `${count} unmodified ${count === 1 ? 'line' : 'lines'}`
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="flex w-full items-center gap-2 border-y border-dashed bg-muted/60 px-3 py-1 text-left font-sans text-xs text-muted-foreground transition-colors first:border-t-0 last:border-b-0 hover:bg-accent hover:text-foreground"
    >
      {loading ? <Loader2 className="size-3.5 animate-spin" /> : <UnfoldVertical className="size-3.5" />}
      <span className="shrink-0 whitespace-nowrap">{label}</span>
      {section && <span className="truncate font-mono text-[11px] opacity-70">{section}</span>}
    </button>
  )
}

function CommentThread({ comments }: { comments: ReviewComment[] }) {
  return (
    <div className="border-y bg-card px-4 py-3 font-sans">
      <div className="max-w-2xl space-y-3 rounded-lg border bg-background p-3 shadow-soft">
        {comments.map((comment) => (
          <div key={comment.id} className="flex gap-2.5">
            <UserAvatar user={comment.author} className="mt-0.5" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2 text-xs">
                <span className="font-medium">{comment.author.login}</span>
                <span className="text-muted-foreground">{relativeTime(comment.createdAt)}</span>
              </div>
              <Markdown className="text-[13px] leading-5">{comment.body}</Markdown>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function DraftCard({ draft }: { draft: DraftComment }) {
  const { dispatch } = useReview()
  const [editing, setEditing] = useState(false)
  if (editing) {
    return (
      <Composer
        label={`Edit comment on line ${draft.line}`}
        initial={draft.body}
        onCancel={() => setEditing(false)}
        onSave={(body) => {
          dispatch({ type: 'draft/edit', id: draft.id, body })
          setEditing(false)
        }}
      />
    )
  }
  return (
    <div className="border-y bg-card px-4 py-3 font-sans">
      <div className="max-w-2xl rounded-lg border border-l-2 border-l-modified bg-background p-3 shadow-soft">
        <div className="mb-1 flex items-center gap-2">
          <span className="rounded-full bg-modified-bg px-2 py-px text-[11px] font-medium text-modified">Pending</span>
          <span className="flex-1" />
          <Button variant="ghost" size="icon-xs" aria-label="Edit pending comment" onClick={() => setEditing(true)}>
            <Pencil />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Delete pending comment"
            onClick={() => dispatch({ type: 'draft/remove', id: draft.id })}
          >
            <Trash2 />
          </Button>
        </div>
        <Markdown className="text-[13px] leading-5">{draft.body}</Markdown>
      </div>
    </div>
  )
}

function Composer({
  label,
  initial = '',
  onSave,
  onCancel
}: {
  label: string
  initial?: string
  onSave: (body: string) => void
  onCancel: () => void
}) {
  const [body, setBody] = useState(initial)
  const ready = body.trim().length > 0
  return (
    <div className="border-y bg-card px-4 py-3 font-sans">
      <div className="max-w-2xl space-y-2">
        <Textarea
          autoFocus
          aria-label={label}
          placeholder="Leave a comment. It stays pending until you submit your review."
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onCancel()
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && ready) onSave(body.trim())
          }}
          className="min-h-20 bg-background text-[13px]"
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" disabled={!ready} onClick={() => onSave(body.trim())}>
            {initial ? 'Save comment' : 'Add comment'}
          </Button>
        </div>
      </div>
    </div>
  )
}
