import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  PROMPT_HASH,
  reconcile,
  removeVersion,
  renameVersion,
  saveVersion,
  seedLibrary,
  setLive,
  type PromptLibrary,
  type PromptVersion
} from '@shared/prompts'

function parseVersion(raw: unknown): PromptVersion | null {
  if (typeof raw !== 'object' || raw === null) return null
  const value = raw as Record<string, unknown>
  if (typeof value.hash !== 'string' || !PROMPT_HASH.test(value.hash)) return null
  if (value.name !== null && typeof value.name !== 'string') return null
  if (typeof value.text !== 'string' || typeof value.createdAt !== 'string' || typeof value.builtIn !== 'boolean') return null
  return { hash: value.hash, name: value.name, text: value.text, createdAt: value.createdAt, builtIn: value.builtIn }
}

function parseLibrary(raw: unknown): PromptLibrary | null {
  if (typeof raw !== 'object' || raw === null) return null
  const value = raw as Record<string, unknown>
  if (!Array.isArray(value.versions) || typeof value.liveHash !== 'string') return null
  const versions: PromptVersion[] = []
  for (const entry of value.versions) {
    const version = parseVersion(entry)
    if (version === null) return null
    versions.push(version)
  }
  if (!versions.some((version) => version.hash === value.liveHash)) return null
  // Files written before versions could be deleted have no retiredBuiltIns.
  const retired = value.retiredBuiltIns ?? []
  if (!Array.isArray(retired)) return null
  const retiredBuiltIns: string[] = []
  for (const hash of retired) {
    if (typeof hash !== 'string' || !PROMPT_HASH.test(hash)) return null
    retiredBuiltIns.push(hash)
  }
  return { versions, liveHash: value.liveHash, retiredBuiltIns }
}

function parseStored(raw: string): PromptLibrary | null {
  try {
    return parseLibrary(JSON.parse(raw))
  } catch {
    return null
  }
}

export class PromptStore {
  private current: Promise<PromptLibrary>

  constructor(
    private readonly file: string,
    private readonly builtInText: string
  ) {
    this.current = this.load()
  }

  get(): Promise<PromptLibrary> {
    return this.current
  }

  save(text: string): Promise<{ library: PromptLibrary; version: PromptVersion }> {
    return this.update((lib) => saveVersion(lib, text, new Date().toISOString()))
  }

  async rename(hash: string, name: string): Promise<PromptLibrary> {
    return (await this.update(async (lib) => ({ library: renameVersion(lib, hash, name) }))).library
  }

  async setLive(hash: string): Promise<PromptLibrary> {
    return (await this.update(async (lib) => ({ library: setLive(lib, hash) }))).library
  }

  async remove(hash: string): Promise<PromptLibrary> {
    return (await this.update(async (lib) => ({ library: removeVersion(lib, hash) }))).library
  }

  // Changes run one after another so two quick edits never write from the same stale library.
  private update<T extends { library: PromptLibrary }>(change: (lib: PromptLibrary) => Promise<T>): Promise<T> {
    const previous = this.current
    const next = previous.then(async (lib) => {
      const changed = await change(lib)
      if (changed.library !== lib) await this.write(changed.library)
      return changed
    })
    this.current = next.then(
      (changed) => changed.library,
      () => previous
    )
    return next
  }

  private async load(): Promise<PromptLibrary> {
    const raw = await this.read()
    const stored = raw === null ? null : parseStored(raw)
    if (raw !== null && stored === null) await this.backUp(raw)
    const now = new Date().toISOString()
    const library = stored === null ? await seedLibrary(this.builtInText, now) : await reconcile(stored, this.builtInText, now)
    if (library !== stored) await this.write(library)
    return library
  }

  private async read(): Promise<string | null> {
    try {
      return await readFile(this.file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  private async backUp(raw: string): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true })
    await writeFile(join(dirname(this.file), 'prompts.corrupt.json'), raw)
  }

  private async write(library: PromptLibrary): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    await writeFile(tmp, JSON.stringify(library, null, 2))
    await rename(tmp, this.file)
  }
}
