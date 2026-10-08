// source is where the bytes download from when that isn't url, e.g. the contents API for a file committed to a repo.
export type AttachmentLink = { url: string; name: string; source?: string }

const SIGNED_HOSTS = new Set(['user-images.githubusercontent.com', 'private-user-images.githubusercontent.com', 'camo.githubusercontent.com'])
const WEB_ATTACHMENT_PATHS = [/^\/user-attachments\/(assets|files)\//, /^\/[^/]+\/[^/]+\/(files|assets)\//]
const UNSIGNED_ASSET = /^\/(user-attachments|[^/]+\/[^/]+)\/assets\//

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

type Found = { index: number; url: string; name: string; embedded: boolean }

function fromHtml(html: string): Found[] {
  const found: Found[] = []
  for (const match of html.matchAll(/<(img|video|source)\b([^>]*)>/gi)) {
    const attrs = attributes(match[2] as string)
    if (attrs.src) found.push({ index: match.index, url: attrs.src, name: attrs.alt ?? attrs.title ?? '', embedded: true })
  }
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const inner = match[2] as string
    // GitHub wraps every image in a link to itself; the image is already counted.
    if (/<(img|video)\b/i.test(inner)) continue
    const attrs = attributes(match[1] as string)
    if (attrs.href) found.push({ index: match.index, url: attrs.href, name: stripTags(inner), embedded: false })
  }
  return found
}

function fromMarkdown(markdown: string): Found[] {
  const found = fromHtml(markdown)
  for (const match of markdown.matchAll(/!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
    found.push({ index: match.index, url: match[2] as string, name: match[1] as string, embedded: true })
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

// An image committed to a repo (github.com/<o>/<r>/blob|raw/<ref>/<path>, or raw.githubusercontent.com) downloads through the contents API, which takes the token.
function repoFileSource(url: URL, web: string, api: string): string | null {
  let match: RegExpExecArray | null = null
  if (url.origin === web) match = /^\/([^/]+)\/([^/]+)\/(?:blob|raw)\/([^/]+)\/(.+)$/.exec(url.pathname)
  else if (web === 'https://github.com' && url.origin === 'https://raw.githubusercontent.com') match = /^\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/.exec(url.pathname)
  if (match === null) return null
  const [, owner, repo, ref, path] = match as unknown as [string, string, string, string, string]
  try {
    const prefix = `${api}/repos/${owner}/${repo}/contents/`
    const source = new URL(prefix + path)
    source.searchParams.set('ref', decodeURIComponent(ref))
    // Dot segments must not walk the token-carrying request out of the repo's contents.
    return source.href.startsWith(prefix) ? source.href : null
  } catch {
    return null
  }
}

// html is GitHub's body_html, whose image URLs are signed and fetchable; the raw markdown is read only when no rendering came back.
export function attachmentLinks(html: string | null, markdown: string, web: string, api: string): AttachmentLink[] {
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
    const source = candidate.embedded ? repoFileSource(url, web, api) : null
    if (source === null && !isAttachmentUrl(url, web)) continue
    const key = attachmentKey(url.href)
    if (seen.has(key)) continue
    seen.add(key)
    const name = candidate.name.trim()
    const link: AttachmentLink = { url: url.href, name: name === '' ? fallbackName(url) : name }
    if (source !== null) link.source = source
    links.push(link)
  }
  return links
}

// GitHub signs an asset only where the description embeds it; one that is just linked, or a bare URL inside a list, stays a github.com URL that answers with a sign-in page.
export function needsSigning(link: AttachmentLink, web: string): boolean {
  const url = new URL(link.url)
  return url.origin === web && UNSIGNED_ASSET.test(url.pathname)
}

// Markdown that embeds each asset as an image, for GitHub's renderer to sign.
export function signingMarkdown(links: AttachmentLink[]): string {
  return links.map((link) => `![](${link.url})`).join('\n\n')
}

// Swaps each unsigned asset for the signed URL in html, matched on the asset id that ends both paths.
export function applySigned(links: AttachmentLink[], html: string, web: string): AttachmentLink[] {
  const signed: URL[] = []
  for (const candidate of fromHtml(html)) {
    if (!URL.canParse(candidate.url)) continue
    const url = new URL(candidate.url)
    if (url.protocol === 'https:' && url.hostname === 'private-user-images.githubusercontent.com') signed.push(url)
  }
  const result: AttachmentLink[] = []
  const seen = new Set<string>()
  for (const link of links) {
    let next = link
    if (needsSigning(link, web)) {
      const unsigned = new URL(link.url)
      const id = fallbackName(unsigned)
      const match = id.length >= 8 ? signed.find((url) => fallbackName(url).includes(`-${id}`)) : undefined
      if (match !== undefined) {
        const unnamed = link.name === link.url || link.name === id
        next = { url: match.href, name: unnamed ? fallbackName(match) : link.name }
      }
    }
    const key = attachmentKey(next.url)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(next)
  }
  return result
}
