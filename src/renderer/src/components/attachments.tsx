import { useEffect, useState } from 'react'
import { ExternalLink, FileText, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { pullKey, type Attachment } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useReview } from '@/lib/review-context'
import { errorMessage } from '@/lib/utils'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const CHIP_TITLE: Record<Attachment['status'], string> = {
  importing: 'Importing',
  ready: 'Open with the default app',
  'link-only': 'Too large to import, opens on GitHub',
  failed: 'Could not import, opens on GitHub'
}

export function AttachmentsRow() {
  const { detail } = useReview()
  const ref = detail.summary.ref
  const key = pullKey(ref)
  const [items, setItems] = useState<Attachment[]>([])
  const [viewing, setViewing] = useState<Attachment | null>(null)

  useEffect(() => {
    let live = true
    const load = () =>
      window.prot.pulls
        .attachments(ref)
        .then((next) => live && setItems(next))
        .catch(() => {})
    const off = window.prot.pulls.onAttachments((changed) => pullKey(changed) === key && void load())
    void load()
    return () => {
      live = false
      off()
    }
  }, [ref, key])

  if (items.length === 0) return null
  const importing = items.filter((item) => item.status === 'importing').length

  function open(item: Attachment) {
    const opening = item.status === 'ready' ? window.prot.pulls.openAttachment(ref, item.url) : window.prot.openExternal(item.url)
    opening.catch((error: unknown) => toast.error(`Could not open ${item.name}`, { description: errorMessage(error) }))
  }

  return (
    <section aria-label="Attachments" className="space-y-2.5">
      <h3 className="flex items-baseline gap-2 font-semibold">
        Attachments <span className="font-mono text-[11px] font-normal text-muted-foreground tabular-nums">{items.length}</span>
      </h3>
      {importing > 0 && (
        <p role="status" className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
          <Loader2 aria-hidden className="size-3 animate-spin" />
          importing {importing} of {items.length}
        </p>
      )}
      <ul className="flex flex-wrap items-start gap-3">
        {items.map((item) => (
          <li key={item.url} className="min-w-0">
            {item.src !== null && item.kind === 'image' ? (
              <figure className="w-[176px] space-y-1">
                <button
                  type="button"
                  aria-label={`View ${item.name}`}
                  onClick={() => setViewing(item)}
                  className="block h-[110px] w-full overflow-hidden rounded-[8px] border border-pane-border bg-muted/40 transition-colors outline-none hover:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <img src={item.src} alt={item.name} className="size-full object-cover" />
                </button>
                <Caption item={item} />
              </figure>
            ) : item.src !== null && item.kind === 'video' ? (
              <figure className="w-[300px] space-y-1">
                <video src={item.src} controls preload="metadata" aria-label={item.name} className="w-full rounded-[8px] border border-pane-border bg-black" />
                <Caption item={item} />
              </figure>
            ) : (
              <button
                type="button"
                title={CHIP_TITLE[item.status]}
                disabled={item.status === 'importing'}
                onClick={() => open(item)}
                className="flex max-w-[320px] items-center gap-2 rounded-[8px] border border-pane-border bg-card px-2.5 py-1.5 text-left transition-colors outline-none hover:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60"
              >
                {item.status === 'importing' ? (
                  <Loader2 aria-hidden className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
                ) : item.status === 'ready' ? (
                  <FileText aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <ExternalLink aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0">
                  <span className="block truncate text-[12px] text-foreground/90">{item.name}</span>
                  <span className="block truncate text-[10.5px] text-muted-foreground">
                    {item.size !== null && `${formatSize(item.size)} · `}
                    {item.status === 'link-only' ? 'link only · ' : item.status === 'failed' ? 'not imported · ' : ''}
                    {item.source}
                  </span>
                </span>
              </button>
            )}
          </li>
        ))}
      </ul>
      <Lightbox item={viewing} onClose={() => setViewing(null)} />
    </section>
  )
}

function Caption({ item }: { item: Attachment }) {
  return (
    <figcaption className="leading-4" title={`${item.name} · ${item.source}`}>
      <span className="block truncate text-[11.5px] text-foreground/85">{item.name}</span>
      <span className="block truncate text-[10.5px] text-muted-foreground">{item.source}</span>
    </figcaption>
  )
}

function Lightbox({ item, onClose }: { item: Attachment | null; onClose: () => void }) {
  return (
    <Dialog open={item !== null} onOpenChange={(next) => !next && onClose()}>
      {item !== null && (
        <DialogContent className="flex max-h-[calc(100vh-4rem)] w-auto max-w-[calc(100vw-4rem)] flex-col gap-3 p-3 sm:max-w-[calc(100vw-4rem)]">
          <img src={item.src ?? undefined} alt={item.name} className="max-h-[calc(100vh-10rem)] min-h-0 w-auto max-w-full rounded-[6px] object-contain" />
          <div className="flex items-center gap-3 px-1 font-mono text-[11.5px]">
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate text-[12.5px] font-medium">{item.name}</DialogTitle>
              <DialogDescription className="truncate text-[11px]">{item.source}</DialogDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void window.prot.openExternal(item.url).catch((error: unknown) => toast.error('Could not open the original', { description: errorMessage(error) }))
              }
            >
              <ExternalLink /> Open original
            </Button>
          </div>
        </DialogContent>
      )}
    </Dialog>
  )
}
