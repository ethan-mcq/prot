import { randomBytes } from 'node:crypto'
import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join, resolve, sep } from 'node:path'
import { ATTACHMENT_MAX_BYTES, IMAGE_MIMES, type AgentAttachment } from '@shared/agents'

const NAME_MAX = 100
const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.log', '.csv', '.json', '.yaml', '.yml', '.toml', '.diff', '.patch', '.ts', '.tsx', '.js', '.py', '.sh', '.html', '.css'])

export function sanitizeName(name: string): string {
  const base = basename(name.replace(/\\/g, '/'))
  let clean = base.replace(/[^A-Za-z0-9._ ()-]/g, '_').replace(/^[.\s]+/, '').trim()
  if (clean.length > NAME_MAX) {
    const ext = extname(clean).slice(0, 12)
    clean = `${clean.slice(0, NAME_MAX - ext.length)}${ext}`
  }
  return clean === '' ? 'attachment' : clean
}

export function mimeFor(name: string): string {
  const ext = extname(name).toLowerCase()
  const image = IMAGE_MIMES[ext]
  if (image !== undefined) return image
  if (ext === '.pdf') return 'application/pdf'
  if (TEXT_EXTENSIONS.has(ext)) return 'text/plain'
  return 'application/octet-stream'
}

// Copies of files the user attaches, each in its own random folder under root.
export class AgentAttachments {
  readonly root: string

  constructor(root: string) {
    this.root = resolve(root)
  }

  async save(name: string, data: Uint8Array): Promise<AgentAttachment> {
    if (data.byteLength > ATTACHMENT_MAX_BYTES) throw new Error(`${name} is larger than ${ATTACHMENT_MAX_BYTES / (1024 * 1024)} MB`)
    const path = await this.target(name)
    await writeFile(path, data)
    return { path, name: basename(path), mime: mimeFor(path), size: data.byteLength }
  }

  async copy(source: string): Promise<AgentAttachment> {
    const info = await stat(source)
    if (!info.isFile()) throw new Error(`${basename(source)} is not a file`)
    if (info.size > ATTACHMENT_MAX_BYTES) throw new Error(`${basename(source)} is larger than ${ATTACHMENT_MAX_BYTES / (1024 * 1024)} MB`)
    const path = await this.target(source)
    await copyFile(source, path)
    return { path, name: basename(path), mime: mimeFor(path), size: info.size }
  }

  // Rebuilds each attachment from disk; anything outside root or missing is refused.
  async resolve(list: AgentAttachment[]): Promise<AgentAttachment[]> {
    const out: AgentAttachment[] = []
    for (const item of list) {
      const path = resolve(item.path)
      if (!path.startsWith(this.root + sep) || path !== item.path) throw new Error('Attachments must come from prot')
      let size: number
      try {
        const info = await stat(path)
        if (!info.isFile()) throw new Error('not a file')
        size = info.size
      } catch {
        throw new Error(`${item.name} is no longer available. Attach it again.`)
      }
      out.push({ path, name: basename(path), mime: mimeFor(path), size })
    }
    return out
  }

  private async target(name: string): Promise<string> {
    const dir = join(this.root, randomBytes(8).toString('hex'))
    await mkdir(dir, { recursive: true })
    return join(dir, sanitizeName(name))
  }
}
