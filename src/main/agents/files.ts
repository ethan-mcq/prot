import { open } from 'node:fs/promises'
import { extname, isAbsolute, normalize } from 'node:path'
import { AGENT_FILE_SCHEME, IMAGE_MIMES } from '@shared/agents'

const SERVE_MAX_BYTES = 50 * 1024 * 1024

// prot-agent-file://f/<encoded absolute path> back to the path; null for anything else.
export function agentFilePath(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== `${AGENT_FILE_SCHEME}:` || parsed.hostname !== 'f' || parsed.search !== '' || parsed.hash !== '') return null
  let path: string
  try {
    path = decodeURIComponent(parsed.pathname.slice(1))
  } catch {
    return null
  }
  if (!isAbsolute(path) || path.includes('\0') || normalize(path) !== path) return null
  return path
}

function looksLikeImage(head: Buffer, mime: string): boolean {
  if (mime === 'image/png') return head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  if (mime === 'image/jpeg') return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff
  if (mime === 'image/gif') return head.subarray(0, 4).toString('latin1') === 'GIF8'
  if (mime === 'image/webp') return head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP'
  return false
}

// Paths main has seen in a loaded agent's events or attachments; the protocol serves nothing else.
export class AgentFileAllowlist {
  private readonly paths = new Set<string>()

  allow(paths: Iterable<string>): void {
    for (const path of paths) {
      if (isAbsolute(path) && extname(path).toLowerCase() in IMAGE_MIMES) this.paths.add(normalize(path))
    }
  }

  has(path: string): boolean {
    return this.paths.has(path)
  }
}

// Allowlisted image files only, with their image MIME, and only when the bytes are that image type.
export async function serveAgentFile(url: string, allowed: (path: string) => boolean): Promise<Response> {
  const path = agentFilePath(url)
  const type = path === null ? undefined : IMAGE_MIMES[extname(path).toLowerCase()]
  if (path === null || type === undefined || !allowed(path)) return new Response('Not found', { status: 404 })
  try {
    const handle = await open(path, 'r')
    try {
      const info = await handle.stat()
      if (!info.isFile() || info.size > SERVE_MAX_BYTES) return new Response('Not found', { status: 404 })
      const data = await handle.readFile()
      if (!looksLikeImage(data, type)) return new Response('Not found', { status: 404 })
      return new Response(data, { headers: { 'content-type': type, 'x-content-type-options': 'nosniff' } })
    } finally {
      await handle.close()
    }
  } catch {
    return new Response('Not found', { status: 404 })
  }
}
