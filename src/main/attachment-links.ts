export type AttachmentLink = { url: string; name: string }

const SIGNED_HOSTS = new Set(['user-images.githubusercontent.com', 'private-user-images.githubusercontent.com', 'camo.githubusercontent.com'])
const WEB_ATTACHMENT_PATHS = [/^\/user-attachments\/(assets|files)\//, /^\/[^/]+\/[^/]+\/(files|assets)\//]

// api.github.com serves github.com; a GitHub Enterprise or fixture API at <host>/api/v3 serves <host>.
export function webOrigin(apiUrl: string): string {
  const url = new URL(apiUrl)
  const host = url.hostname.startsWith('api.') ? url.hostname.slice('api.'.length) : url.hostname
  return `${url.protocol}//${host}${url.port === '' ? '' : `:${url.port}`}`
}

export function isAttachmentUrl(url: URL, web: string): boolean {
  if (url.origin === web) return WEB_ATTACHMENT_PATHS.some((pattern) => pattern.test(url.pathname))
  return url.protocol === 'https:' && SIGNED_HOSTS.has(url.hostname)
}

// Private image URLs carry a jwt that changes on every fetch, so the same image keys on its path.
export function attachmentKey(url: string): string {
  const parsed = new URL(url)
  if (parsed.hostname === 'private-user-images.githubusercontent.com') return parsed.origin + parsed.pathname
  return parsed.href
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (code.startsWith('#x') || code.startsWith('#X')) return String.fromCodePoint(parseInt(code.slice(2), 16))
    if (code.startsWith('#')) return String.fromCodePoint(Number(code.slice(1)))
    return ENTITIES[code.toLowerCase()] ?? entity
  })
}

function attributes(tag: string): Record<string, string> {
  const found: Record<string, string> = {}
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    const name = (match[1] as string).toLowerCase()
    found[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '')
  }
  return found
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, '')).trim()
}

type Found = { index: number; url: string; name: string }

function fromHtml(html: string): Found[] {
  const found: Found[] = []
  for (const match of html.matchAll(/<(img|video|source)\b([^>]*)>/gi)) {
    const attrs = attributes(match[2] as string)
    if (attrs.src) found.push({ index: match.index, url: attrs.src, name: attrs.alt ?? attrs.title ?? '' })
  }
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const inner = match[2] as string
    // GitHub wraps every image in a link to itself; the image is already counted.
    if (/<(img|video)\b/i.test(inner)) continue
    const attrs = attributes(match[1] as string)
    if (attrs.href) found.push({ index: match.index, url: attrs.href, name: stripTags(inner) })
  }
  return found
}

function fromMarkdown(markdown: string): Found[] {
  const found = fromHtml(markdown)
  for (const match of markdown.matchAll(/!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
    found.push({ index: match.index, url: match[2] as string, name: match[1] as string })
  }
  return found
}

function fallbackName(url: URL): string {
  const last = url.pathname.split('/').filter((part) => part !== '').at(-1) ?? url.hostname
  try {
    return decodeURIComponent(last)
  } catch {
    return last
  }
}

// html is GitHub's body_html, whose image URLs are signed and fetchable; the raw markdown is read only when no rendering came back.
export function attachmentLinks(html: string | null, markdown: string, web: string): AttachmentLink[] {
  const found = html === null ? fromMarkdown(markdown) : fromHtml(html)
  found.sort((a, b) => a.index - b.index)
  const links: AttachmentLink[] = []
  const seen = new Set<string>()
  for (const candidate of found) {
    let url: URL
    try {
      url = new URL(candidate.url, web)
    } catch {
      continue
    }
    if (!isAttachmentUrl(url, web)) continue
    const key = attachmentKey(url.href)
    if (seen.has(key)) continue
    seen.add(key)
    const name = candidate.name.trim()
    links.push({ url: url.href, name: name === '' ? fallbackName(url) : name })
  }
  return links
}
