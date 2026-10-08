import ReactMarkdown, { type Components } from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'

const PATH_LIKE = /[\w-]\/[\w-]|\.\w{1,5}$/

const FENCE = /^ {0,3}(`{3,}|~{3,})/
const PROSE_HTML = /(`+)[^\n]*?\1|<!--[\s\S]*?-->|<summary\b[^>]*>[\s\S]*?<\/summary>|<\/?(?:details|div)\b[^>]*>/gi

// Bot comments put HTML blocks and markdown on shared lines. CommonMark then keeps the
// markdown inside the HTML block as raw text, so give block tags their own paragraphs.
function separateHtmlBlocks(prose: string): string {
  return prose.replace(PROSE_HTML, (match: string, code: string | undefined) => {
    if (code !== undefined) return match
    if (match.startsWith('<!--')) return ''
    return `\n\n${match}\n\n`
  })
}

function normalizeGithubHtml(body: string): string {
  const out: string[] = []
  let prose: string[] = []
  let fence: string | null = null
  for (const line of body.split('\n')) {
    const marker = FENCE.exec(line)?.[1]
    if (fence === null && marker === undefined) {
      prose.push(line)
      continue
    }
    if (fence === null && marker !== undefined) {
      out.push(separateHtmlBlocks(prose.join('\n')))
      prose = []
      fence = marker
    } else if (fence !== null && marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length) {
      fence = null
    }
    out.push(line)
  }
  out.push(separateHtmlBlocks(prose.join('\n')))
  return out.join('\n')
}

// The renderer CSP only allows images from GitHub's content hosts.
function imageHost(src: string | undefined): { host: string | null; allowed: boolean } {
  try {
    const host = new URL(src ?? '').hostname
    return { host, allowed: host === 'githubusercontent.com' || host.endsWith('.githubusercontent.com') }
  } catch {
    return { host: null, allowed: false }
  }
}

function MarkdownImage({ src, alt }: { src: string | undefined; alt: string | undefined }) {
  const { host, allowed } = imageHost(src)
  if (allowed) return <img src={src} alt={alt ?? ''} className="my-1 inline-block max-w-full rounded-[6px]" />
  return (
      <span
        data-image-chip
        title={typeof src === 'string' ? src : undefined}
        className="inline-flex items-center rounded-[5px] border border-pane-border bg-muted px-1.5 align-middle font-mono text-[11px] leading-[18px] font-normal text-muted-foreground in-[a]:bg-card in-[a]:text-foreground in-[a]:hover:border-frame in-[a]:hover:bg-accent"
      >
        {alt || host || 'image'}
      </span>
    )
}

const components: Components = {
  a: ({ href, children }) => (
    <a
      href={href}
      onClick={(event) => {
        event.preventDefault()
        if (href) void window.prot.openExternal(href)
      }}
      className="font-medium text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground has-[[data-image-chip]]:no-underline"
    >
      {children}
    </a>
  ),
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
  h1: ({ children }) => <h3 className="mt-4 mb-2 font-semibold first:mt-0">{children}</h3>,
  h2: ({ children }) => <h3 className="mt-4 mb-2 font-semibold first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 className="mt-3 mb-1.5 font-semibold first:mt-0">{children}</h4>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 pl-3 text-muted-foreground">{children}</blockquote>
  ),
  pre: ({ children }) => (
    <pre className="scroll-quiet my-2 overflow-x-auto rounded-[8px] border border-pane-border bg-muted px-3 py-2 font-mono text-[12px] leading-5 tracking-normal">
      {children}
    </pre>
  ),
  code: ({ className, children }) => {
    const block = typeof className === 'string' && className.startsWith('language-')
    if (block) return <code className="font-mono">{children}</code>
    const path = typeof children === 'string' && PATH_LIKE.test(children)
    return <code className={cn('font-mono text-[0.95em]', path ? 'text-path' : 'text-command')}>{children}</code>
  },
  table: ({ children }) => (
    <div className="scroll-quiet my-2 overflow-x-auto">
      <table className="w-full border-collapse text-left text-[0.9em]">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border-b px-2 py-1 font-medium">{children}</th>,
  td: ({ children }) => <td className="border-b px-2 py-1 align-top">{children}</td>,
  img: ({ src, alt }) => <MarkdownImage src={typeof src === 'string' ? src : undefined} alt={alt} />,
  source: () => null,
  sup: ({ children }) => <sup className="text-[11px] text-muted-foreground">{children}</sup>,
  details: ({ children }) => (
    <details className="my-2 rounded-[6px] border border-pane-border px-2.5 py-1 open:pb-2">{children}</details>
  ),
  summary: ({ children }) => <summary className="cursor-pointer text-muted-foreground select-none">{children}</summary>,
  hr: () => <hr className="my-4" />
}

// GitHub renders a single newline in comments and descriptions as a line break; our own prose does not.
// image maps a markdown image src to a URL prot may load (agent images); null keeps the chip.
export function Markdown({
  children,
  className,
  github = false,
  image
}: {
  children: string
  className?: string
  github?: boolean
  image?: (src: string) => string | null
}) {
  const resolved: Components = image
    ? {
        ...components,
        img: ({ src, alt }) => {
          const url = typeof src === 'string' ? image(src) : null
          if (url) return <img src={url} alt={alt ?? ''} className="my-1 inline-block max-h-80 max-w-full rounded-[6px]" />
          return <MarkdownImage src={typeof src === 'string' ? src : undefined} alt={alt} />
        }
      }
    : components
  return (
    <div className={cn('text-sm leading-6 [overflow-wrap:anywhere]', className)}>
      <ReactMarkdown remarkPlugins={github ? [remarkGfm, remarkBreaks] : [remarkGfm]} rehypePlugins={[rehypeRaw, rehypeSanitize]} components={resolved}>
        {normalizeGithubHtml(children)}
      </ReactMarkdown>
    </div>
  )
}
