import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  PROMPT_HASH,
  PROMPT_KINDS,
  reconcileAll,
  removeVersion,
  renameVersion,
  saveVersion,
  setLive,
  type PromptKind,
  type PromptLibraries,
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

function parseStored(raw: string): Partial<PromptLibraries> | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  // Files written before the chat prompt was versioned hold one library, the guide's.
  if ('versions' in value) {
    const guide = parseLibrary(value)
    return guide === null ? null : { guide }
  }
  const stored: Partial<PromptLibraries> = {}
  for (const kind of PROMPT_KINDS) {
    const entry = (value as Record<string, unknown>)[kind]
    if (entry === undefined) continue
    const library = parseLibrary(entry)
    if (library === null) return null
    stored[kind] = library
  }
  return stored
}

export class PromptStore {
  private current: Promise<PromptLibraries>

  constructor(
    private readonly file: string,
    private readonly builtIns: Record<PromptKind, string>
  ) {
    this.current = this.load()
  }

  async get(kind: PromptKind): Promise<PromptLibrary> {
    return (await this.current)[kind]
  }

  save(kind: PromptKind, text: string): Promise<{ library: PromptLibrary; version: PromptVersion }> {
    return this.update(kind, (lib) => saveVersion(lib, text, new Date().toISOString()))
  }

  async rename(kind: PromptKind, hash: string, name: string): Promise<PromptLibrary> {
    return (await this.update(kind, async (lib) => ({ library: renameVersion(lib, hash, name) }))).library
  }

  async setLive(kind: PromptKind, hash: string): Promise<PromptLibrary> {
    return (await this.update(kind, async (lib) => ({ library: setLive(lib, hash) }))).library
  }

  async remove(kind: PromptKind, hash: string): Promise<PromptLibrary> {
    return (await this.update(kind, async (lib) => ({ library: removeVersion(lib, hash) }))).library
  }

  // Changes run one after another so two quick edits never write from the same stale libraries.
  private update<T extends { library: PromptLibrary }>(kind: PromptKind, change: (lib: PromptLibrary) => Promise<T>): Promise<T> {
    const previous = this.current
    const next = previous.then(async (all) => {
      const changed = await change(all[kind])
      if (changed.library === all[kind]) return { changed, all }
      const updated: PromptLibraries = { ...all, [kind]: changed.library }
      await this.write(updated)
      return { changed, all: updated }
    })
    this.current = next.then(
      ({ all }) => all,
      () => previous
    )
    return next.then(({ changed }) => changed)
  }

  private async load(): Promise<PromptLibraries> {
    const raw = await this.read()
    const stored = raw === null ? null : parseStored(raw)
    if (raw !== null && stored === null) await this.backUp(raw)
    const libraries = await reconcileAll(stored ?? {}, this.builtIns, new Date().toISOString())
    if (stored === null || PROMPT_KINDS.some((kind) => libraries[kind] !== stored[kind])) await this.write(libraries)
    return libraries
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

  private async write(libraries: PromptLibraries): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    await writeFile(tmp, JSON.stringify(libraries, null, 2))
    await rename(tmp, this.file)
  }
}
