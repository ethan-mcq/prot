import type { FileRole, Guide, PullDetail } from '../types'

export function classifyFile(path: string): FileRole {
  throw new Error(`classifyFile not implemented: ${path}`)
}

export function buildHeuristicGuide(detail: PullDetail): Guide {
  throw new Error(`buildHeuristicGuide not implemented: ${detail.head.sha}`)
}

export function buildGuidePrompt(detail: PullDetail): { system: string; user: string } {
  throw new Error(`buildGuidePrompt not implemented: ${detail.head.sha}`)
}

export const GUIDE_SCHEMA: Record<string, unknown> = {}

export function parseAiGuide(raw: unknown, detail: PullDetail): Guide {
  throw new Error(`parseAiGuide not implemented: ${String(raw)} ${detail.head.sha}`)
}
