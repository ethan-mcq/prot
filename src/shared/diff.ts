import type { DiffHunk } from './types'

export function parsePatch(patch: string): DiffHunk[] {
  throw new Error(`parsePatch not implemented: ${patch.length}`)
}
