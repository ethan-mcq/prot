import { readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { pullKey, type PullRef } from '@shared/types'
import { parsePullRef } from './validate'

type Entry = PullRef & { addedAt: string }

function parseEntries(raw: unknown): Entry[] {
  if (!Array.isArray(raw)) return []
  const entries: Entry[] = []
  for (const item of raw) {
    try {
      const addedAt = (item as { addedAt?: unknown }).addedAt
      if (typeof addedAt !== 'string') continue
      entries.push({ ...parsePullRef(item), addedAt })
    } catch {
      continue
    }
  }
  return entries
}

// Pull requests the user opened by link or number, persisted as [{ owner, repo, number, addedAt }].
export class CheckedOutStore {
  private entries: Entry[]
  private saving: Promise<void> = Promise.resolve()

  constructor(private readonly file: string) {
    try {
      this.entries = parseEntries(JSON.parse(readFileSync(file, 'utf8')))
    } catch {
      this.entries = []
    }
  }

  list(): PullRef[] {
    const refs: PullRef[] = []
    for (const { owner, repo, number } of this.entries) refs.push({ owner, repo, number })
    return refs
  }

  has(ref: PullRef): boolean {
    return this.entries.some((entry) => pullKey(entry) === pullKey(ref))
  }

  async add(ref: PullRef): Promise<void> {
    if (this.has(ref)) return
    this.entries = [...this.entries, { owner: ref.owner, repo: ref.repo, number: ref.number, addedAt: new Date().toISOString() }]
    await this.save()
  }

  async remove(ref: PullRef): Promise<void> {
    if (!this.has(ref)) return
    this.entries = this.entries.filter((entry) => pullKey(entry) !== pullKey(ref))
    await this.save()
  }

  // Writes queue so two quick changes cannot interleave on the shared tmp file.
  private save(): Promise<void> {
    const entries = this.entries
    const write = this.saving
      .catch(() => {})
      .then(async () => {
        await mkdir(dirname(this.file), { recursive: true })
        const tmp = `${this.file}.tmp`
        await writeFile(tmp, JSON.stringify(entries, null, 2))
        await rename(tmp, this.file)
      })
    this.saving = write
    return write
  }
}
