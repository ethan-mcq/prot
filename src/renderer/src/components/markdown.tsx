import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'

const PATH_LIKE = /[\w-]\/[\w-]|\.\w{1,5}$/

const components: Components = {
  a: ({ href, children }) => (
    <a
      href={href}
      onClick={(event) => {
        event.preventDefault()
        if (href) void window.prot.openExternal(href)
      }}
      className="font-medium text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground"
    >
      {children}
    </a>
  ),
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
  h1: ({ children }) => <h3 className="mt-4 mb-2 font-bold first:mt-0">{children}</h3>,
  h2: ({ children }) => <h3 className="mt-4 mb-2 font-bold first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 className="mt-3 mb-1.5 font-bold first:mt-0">{children}</h4>,
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
  img: ({ alt }) => <span className="text-muted-foreground italic">[image{alt ? `: ${alt}` : ''}]</span>,
  hr: () => <hr className="my-4" />
}

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn('text-sm leading-6 [overflow-wrap:anywhere]', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  )
}
