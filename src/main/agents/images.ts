import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { extname, isAbsolute, join, normalize } from 'node:path'
import { IMAGE_MIMES, type AgentEvent } from '@shared/agents'
import type { SaveImage } from './claude-events'

const IMAGES_PER_EVENT = 12
const EXT_FOR_MIME: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' }

const MARKDOWN_IMAGE = /!\[[^\]]*\]\(\s*<?((?:file:\/\/)?\/[^)>\n]+?)>?\s*(?:"[^"]*")?\s*\)/g
const BARE_PATH = /(?:^|[\s"'`([<])((?:file:\/\/)?\/[^\s"'`()<>[\]]+?\.(?:png|jpe?g|gif|webp))(?=$|[\s"'`)\]>.,;:!?])/gi

export function isImagePath(path: string): boolean {
  return extname(path).toLowerCase() in IMAGE_MIMES
}

function clean(raw: string): string | null {
  let path = raw.trim().replace(/^file:\/\//, '')
  try {
    path = decodeURI(path)
  } catch {
    return null
  }
  if (!isAbsolute(path) || path.includes('\0') || !isImagePath(path)) return null
  return normalize(path)
}

// Absolute image paths in markdown images or bare in the text, in order, once each.
export function extractImagePaths(text: string): string[] {
  const found: string[] = []
  const add = (raw: string | undefined) => {
    const path = raw === undefined ? null : clean(raw)
    if (path !== null && !found.includes(path)) found.push(path)
  }
  for (const match of text.matchAll(MARKDOWN_IMAGE)) add(match[1])
  for (const match of text.matchAll(BARE_PATH)) add(match[1])
  return found
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

// Adds image files the event's text points at to its images; only files that exist.
export function withImages(event: AgentEvent, exists: (path: string) => boolean = isFile): AgentEvent {
  let text = ''
  if (event.kind === 'assistant') text = event.text
  else if (event.kind === 'tool') text = `${event.summary}\n${event.output ?? ''}`
  else return event
  const images = [...(event.images ?? [])]
  for (const path of extractImagePaths(text)) {
    if (images.length >= IMAGES_PER_EVENT) break
    if (!images.includes(path) && exists(path)) images.push(path)
  }
  if (images.length === (event.images?.length ?? 0)) return event
  return { ...event, images }
}

// Tool-result images land in dir as <sha256>.<ext>, written once.
export function imageSaver(dir: string): SaveImage {
  return (mime, base64) => {
    const ext = EXT_FOR_MIME[mime]
    if (ext === undefined) return null
    const data = Buffer.from(base64, 'base64')
    if (data.length === 0) return null
    const path = join(dir, `${createHash('sha256').update(data).digest('hex')}${ext}`)
    try {
      if (!existsSync(path)) {
        mkdirSync(dir, { recursive: true })
        writeFileSync(path, data)
      }
      return path
    } catch {
      return null
    }
  }
}

export function eventImages(event: AgentEvent): string[] {
  if (event.kind === 'user') return (event.attachments ?? []).map((attachment) => attachment.path)
  if (event.kind === 'assistant' || event.kind === 'tool') return event.images ?? []
  return []
}
