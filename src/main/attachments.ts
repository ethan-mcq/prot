import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import type { Attachment, AttachmentKind, PullRef } from '@shared/types'
import { attachmentKey, type AttachmentLink } from './attachment-links'
import { cacheName, parseCacheName } from './pull-cache'

export const ATTACHMENT_SCHEME = 'prot-attachment'
export const FILE_LIMIT = 50 * 1024 * 1024
export const PULL_LIMIT = 300 * 1024 * 1024
const MAX_REDIRECTS = 5
const DOWNLOAD_TIMEOUT_MS = 120_000
const MANIFEST = 'manifest.json'

type StoredStatus = 'ready' | 'link-only' | 'failed'

export type ManifestEntry = {
  url: string
  name: string
  contentType: string | null
  size: number | null
  status: StoredStatus
  file: string | null
}

// The only extensions a stored file keeps. Anything else is saved as .bin, so opening it never runs it.
const EXTENSIONS: Record<string, { kind: AttachmentKind; type: string }> = {
  '.png': { kind: 'image', type: 'image/png' },
  '.jpg': { kind: 'image', type: 'image/jpeg' },
  '.jpeg': { kind: 'image', type: 'image/jpeg' },
  '.gif': { kind: 'image', type: 'image/gif' },
  '.webp': { kind: 'image', type: 'image/webp' },
  '.mp4': { kind: 'video', type: 'video/mp4' },
  '.mov': { kind: 'video', type: 'video/quicktime' },
  '.webm': { kind: 'video', type: 'video/webm' },
  '.txt': { kind: 'file', type: 'text/plain' },
  '.log': { kind: 'file', type: 'text/plain' },
  '.md': { kind: 'file', type: 'text/markdown' },
  '.csv': { kind: 'file', type: 'text/csv' },
  '.json': { kind: 'file', type: 'application/json' },
  '.patch': { kind: 'file', type: 'text/x-diff' },
  '.diff': { kind: 'file', type: 'text/x-diff' },
  '.pdf': { kind: 'file', type: 'application/pdf' },
  '.zip': { kind: 'file', type: 'application/zip' }
}

const DIR_NAME = /^[A-Za-z0-9._-]+__[A-Za-z0-9._-]+__\d+$/
const FILE_NAME = /^[0-9a-f]{40}\.[a-z0-9]{1,8}$/

function extensionFor(name: string, url: string, contentType: string | null): string {
  for (const candidate of [extname(name), extname(new URL(url).pathname)]) {
    const ext = candidate.toLowerCase()
    if (ext in EXTENSIONS) return ext
  }
  const type = contentType?.split(';')[0]?.trim().toLowerCase()
  for (const [ext, info] of Object.entries(EXTENSIONS)) {
    if (info.type === type) return ext
  }
  return '.bin'
}

function kindOf(file: string | null): AttachmentKind {
  return (file && EXTENSIONS[extname(file)]?.kind) || 'file'
}

export function storedPath(root: string, dir: string, file: string): string | null {
  if (!DIR_NAME.test(dir) || !FILE_NAME.test(file)) return null
  const base = resolve(root)
  const path = resolve(base, dir, file)
  return path.startsWith(base + sep) ? path : null
}

// prot-attachment://pr/<owner>__<repo>__<n>/<sha1>.<ext>, served only for stored images and videos.
export function protocolPath(root: string, url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== `${ATTACHMENT_SCHEME}:` || parsed.hostname !== 'pr') return null
  const parts = parsed.pathname.split('/').slice(1)
  if (parts.length !== 2) return null
  let dir: string
  let file: string
  try {
    dir = decodeURIComponent(parts[0] as string)
    file = decodeURIComponent(parts[1] as string)
  } catch {
    return null
  }
  const path = storedPath(root, dir, file)
  return path !== null && kindOf(path) !== 'file' ? path : null
}

export async function serveAttachment(root: string, url: string): Promise<Response> {
  const path = protocolPath(root, url)
  const type = path === null ? undefined : EXTENSIONS[extname(path)]?.type
  if (path === null || type === undefined) return new Response('Not found', { status: 404 })
  try {
    return new Response(await readFile(path), { headers: { 'content-type': type, 'x-content-type-options': 'nosniff' } })
  } catch {
    return new Response('Not found', { status: 404 })
  }
}

function parseEntry(raw: unknown): ManifestEntry | null {
  if (typeof raw !== 'object' || raw === null) return null
  const value = raw as Record<string, unknown>
  const status = (['ready', 'link-only', 'failed'] as const).find((candidate) => candidate === value.status)
  if (typeof value.url !== 'string' || typeof value.name !== 'string' || status === undefined) return null
  const file = typeof value.file === 'string' && FILE_NAME.test(value.file) ? value.file : null
  return {
    url: value.url,
    name: value.name,
    contentType: typeof value.contentType === 'string' ? value.contentType : null,
    size: typeof value.size === 'number' ? value.size : null,
    status: status === 'ready' && file === null ? 'failed' : status,
    file
  }
}

type Download = { status: 'ready'; file: string; size: number; contentType: string | null } | { status: 'link-only'; size: number | null; contentType: string | null } | { status: 'failed' }

type Job = { links: AttachmentLink[]; controller: AbortController; done: Promise<void> }

export class AttachmentService {
  private readonly jobs = new Map<string, Job>()

  constructor(
    private readonly root: string,
    private readonly headersFor: (url: URL) => Record<string, string>,
    private readonly changed: (ref: PullRef) => void
  ) {}

  // Runs in the background, one import per PR at a time; a later call waits for the earlier one and wins.
  import(ref: PullRef, links: AttachmentLink[]): void {
    const name = cacheName(ref)
    const previous = this.jobs.get(name)
    const controller = previous?.controller ?? new AbortController()
    const job: Job = { links, controller, done: Promise.resolve() }
    job.done = (previous?.done ?? Promise.resolve())
      .then(() => this.sync(name, links, controller.signal))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) console.error('Could not import PR attachments', error)
      })
      .finally(() => {
        if (this.jobs.get(name) !== job) return
        this.jobs.delete(name)
        if (!controller.signal.aborted) this.changed(ref)
      })
    this.jobs.set(name, job)
  }

  async list(ref: PullRef): Promise<Attachment[]> {
    const name = cacheName(ref)
    const entries = await this.readManifest(name)
    const job = this.jobs.get(name)
    if (job === undefined) return entries.map((entry) => this.toAttachment(name, entry))
    const done = new Map<string, ManifestEntry>()
    for (const entry of entries) done.set(attachmentKey(entry.url), entry)
    return job.links.map((link) => {
      const entry = done.get(attachmentKey(link.url))
      if (entry !== undefined) return this.toAttachment(name, { ...entry, name: link.name })
      return { url: link.url, name: link.name, size: null, kind: 'file', status: 'importing', src: null }
    })
  }

  // A stored file opens with the system default app; anything else opens its GitHub URL.
  async openTarget(ref: PullRef, url: string): Promise<{ path: string } | { url: string }> {
    const name = cacheName(ref)
    const key = attachmentKey(url)
    const entry = (await this.readManifest(name)).find((candidate) => attachmentKey(candidate.url) === key)
    if (entry === undefined) throw new Error('No such attachment on this pull request')
    const path = entry.status === 'ready' && entry.file !== null && !entry.file.endsWith('.bin') ? storedPath(this.root, name, entry.file) : null
    return path === null ? { url: entry.url } : { path }
  }

  async remove(ref: PullRef): Promise<void> {
    const name = cacheName(ref)
    const job = this.jobs.get(name)
    if (job !== undefined) {
      job.controller.abort()
      await job.done
    }
    await rm(join(this.root, name), { recursive: true, force: true })
  }

  async cachedRefs(): Promise<PullRef[]> {
    let names: string[]
    try {
      names = await readdir(this.root)
    } catch {
      return []
    }
    const refs: PullRef[] = []
    for (const name of names) {
      const ref = DIR_NAME.test(name) ? parseCacheName(name) : null
      if (ref !== null) refs.push(ref)
    }
    return refs
  }

  private toAttachment(name: string, entry: ManifestEntry): Attachment {
    const kind = kindOf(entry.file)
    const src = entry.status === 'ready' && entry.file !== null && kind !== 'file' ? `${ATTACHMENT_SCHEME}://pr/${name}/${entry.file}` : null
    return { url: entry.url, name: entry.name, size: entry.size, kind, status: entry.status, src }
  }

  // Converges the PR's folder on the current links: ready and link-only entries are kept, failed ones retried, dropped ones deleted.
  private async sync(name: string, links: AttachmentLink[], signal: AbortSignal): Promise<void> {
    const dir = join(this.root, name)
    if (links.length === 0) {
      await rm(dir, { recursive: true, force: true })
      return
    }
    const previous = new Map<string, ManifestEntry>()
    for (const entry of await this.readManifest(name)) previous.set(attachmentKey(entry.url), entry)

    const kept = new Map<string, ManifestEntry>()
    let used = 0
    for (const link of links) {
      const old = previous.get(attachmentKey(link.url))
      if (old === undefined || old.status === 'failed') continue
      if (old.status === 'ready' && !(await this.exists(dir, old.file))) continue
      kept.set(link.url, { ...old, url: link.url, name: link.name })
      if (old.status === 'ready') used += old.size ?? 0
    }

    await mkdir(dir, { recursive: true })
    const entries: ManifestEntry[] = []
    for (const link of links) {
      let entry = kept.get(link.url)
      if (entry === undefined) {
        const download = await this.download(dir, link, Math.min(FILE_LIMIT, PULL_LIMIT - used), signal)
        if (download.status === 'ready') used += download.size
        entry = {
          url: link.url,
          name: link.name,
          status: download.status,
          contentType: download.status === 'failed' ? null : download.contentType,
          size: download.status === 'failed' ? null : download.size,
          file: download.status === 'ready' ? download.file : null
        }
      }
      entries.push(entry)
    }

    if (signal.aborted) return
    const tmp = join(dir, `${MANIFEST}.tmp`)
    await writeFile(tmp, JSON.stringify(entries, null, 2))
    await rename(tmp, join(dir, MANIFEST))
    const files = new Set(entries.map((entry) => entry.file))
    for (const file of await readdir(dir)) {
      if (file !== MANIFEST && !files.has(file)) await rm(join(dir, file), { force: true })
    }
  }

  private async download(dir: string, link: AttachmentLink, limit: number, signal: AbortSignal): Promise<Download> {
    let res: Response
    try {
      res = await this.fetchFollowing(link.source ?? link.url, AbortSignal.any([signal, AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)]))
    } catch (error) {
      if (signal.aborted) throw error
      return { status: 'failed' }
    }
    if (!res.ok || res.body === null) {
      await res.body?.cancel()
      return { status: 'failed' }
    }
    const contentType = res.headers.get('content-type')
    // No attachment is a web page; GitHub answers an asset it won't serve with its sign-in page.
    if (contentType?.split(';')[0]?.trim().toLowerCase() === 'text/html') {
      await res.body.cancel()
      return { status: 'failed' }
    }
    const declared = Number(res.headers.get('content-length') ?? '')
    if (Number.isFinite(declared) && declared > limit) {
      await res.body.cancel()
      return { status: 'link-only', size: declared, contentType }
    }
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      for await (const chunk of res.body) {
        size += chunk.byteLength
        if (size > limit) return { status: 'link-only', size: null, contentType }
        chunks.push(chunk)
      }
    } catch (error) {
      if (signal.aborted) throw error
      return { status: 'failed' }
    }
    if (signal.aborted) throw new Error('Attachment import was cancelled')
    const file = `${createHash('sha1').update(attachmentKey(link.url)).digest('hex')}${extensionFor(link.name, link.url, contentType)}`
    const tmp = join(dir, `${file}.tmp`)
    await writeFile(tmp, Buffer.concat(chunks))
    await rename(tmp, join(dir, file))
    return { status: 'ready', file, size, contentType }
  }

  // Redirects are followed by hand so the token is chosen per hop and never follows a redirect off GitHub.
  private async fetchFollowing(url: string, signal: AbortSignal): Promise<Response> {
    let current = new URL(url)
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (current.protocol !== 'https:' && current.protocol !== 'http:') throw new Error(`Refusing ${current.protocol} attachment URL`)
      const res = await fetch(current, { headers: this.headersFor(current), redirect: 'manual', signal })
      const location = res.headers.get('location')
      if (res.status < 300 || res.status >= 400 || location === null) return res
      await res.body?.cancel()
      current = new URL(location, current)
    }
    throw new Error('Too many redirects')
  }

  private async exists(dir: string, file: string | null): Promise<boolean> {
    if (file === null) return false
    try {
      return (await stat(join(dir, file))).isFile()
    } catch {
      return false
    }
  }

  private async readManifest(name: string): Promise<ManifestEntry[]> {
    let raw: unknown
    try {
      raw = JSON.parse(await readFile(join(this.root, name, MANIFEST), 'utf8'))
    } catch {
      return []
    }
    if (!Array.isArray(raw)) return []
    const entries: ManifestEntry[] = []
    for (const item of raw) {
      const entry = parseEntry(item)
      if (entry !== null) entries.push(entry)
    }
    return entries
  }
}
