import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

const SKIP = new Set(['node_modules', '.git', 'dist', 'out', 'build', '.venv', 'vendor'])
const MAX_DEPTH = 4

// The shallowest AGENTS.md in the repo, breadth first; null when there is none.
export async function findAgentsMd(repo: string): Promise<string | null> {
  let level = [repo]
  for (let depth = 0; depth <= MAX_DEPTH && level.length > 0; depth++) {
    const next: string[] = []
    for (const dir of level) {
      let entries
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        continue
      }
      entries.sort((a, b) => a.name.localeCompare(b.name))
      for (const entry of entries) {
        if (entry.isFile() && entry.name.toLowerCase() === 'agents.md') return join(dir, entry.name)
      }
      for (const entry of entries) {
        if (entry.isDirectory() && !SKIP.has(entry.name)) next.push(join(dir, entry.name))
      }
    }
    level = next
  }
  return null
}
