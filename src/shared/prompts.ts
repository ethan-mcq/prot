export type PromptVersion = {
  hash: string
  name: string | null
  text: string
  createdAt: string
  builtIn: boolean
}

// retiredBuiltIns holds the hashes of deleted built-in versions so reconcile does not bring them back.
export type PromptLibrary = { versions: PromptVersion[]; liveHash: string; retiredBuiltIns: string[] }

export const PROMPT_HASH = /^[0-9a-f]{12}$/
export const PROMPT_NAME_MAX = 60
export const PROMPT_TEXT_MAX = 100_000
const BUILT_IN_NAME = 'built-in default'

export function normalizePrompt(text: string): string {
  const lines: string[] = []
  for (const line of text.split('\n')) lines.push(line.trimEnd())
  return lines.join('\n').trimEnd()
}

// Web Crypto, not node:crypto, because this module also runs in the renderer to preview the hash.
export async function promptHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalizePrompt(text)))
  let hex = ''
  for (const byte of new Uint8Array(digest)) hex += byte.toString(16).padStart(2, '0')
  return hex.slice(0, 12)
}

export function displayName(version: PromptVersion): string {
  return version.name ?? version.hash
}

export function findVersion(lib: PromptLibrary, hash: string): PromptVersion | undefined {
  return lib.versions.find((version) => version.hash === hash)
}

function mustFind(lib: PromptLibrary, hash: string): PromptVersion {
  const version = findVersion(lib, hash)
  if (version === undefined) throw new Error(`No prompt version ${hash}`)
  return version
}

async function newVersion(text: string, now: string, builtIn: boolean, name: string | null): Promise<PromptVersion> {
  const normalized = normalizePrompt(text)
  if (normalized === '') throw new Error('The prompt is empty')
  return { hash: await promptHash(normalized), name, text: normalized, createdAt: now, builtIn }
}

export async function saveVersion(
  lib: PromptLibrary,
  text: string,
  now: string
): Promise<{ library: PromptLibrary; version: PromptVersion }> {
  const version = await newVersion(text, now, false, null)
  const existing = findVersion(lib, version.hash)
  if (existing !== undefined) return { library: lib, version: existing }
  return { library: { ...lib, versions: [...lib.versions, version] }, version }
}

export function renameVersion(lib: PromptLibrary, hash: string, name: string): PromptLibrary {
  mustFind(lib, hash)
  const trimmed = name.trim()
  if (trimmed.length > PROMPT_NAME_MAX) throw new Error(`A prompt name is at most ${PROMPT_NAME_MAX} characters`)
  const versions = lib.versions.map((version) =>
    version.hash === hash ? { ...version, name: trimmed === '' ? null : trimmed } : version
  )
  return { ...lib, versions }
}

export function setLive(lib: PromptLibrary, hash: string): PromptLibrary {
  mustFind(lib, hash)
  return { ...lib, liveHash: hash }
}

export function removeVersion(lib: PromptLibrary, hash: string): PromptLibrary {
  const version = mustFind(lib, hash)
  if (hash === lib.liveHash) throw new Error('The live prompt cannot be deleted. Make another version live first.')
  const versions = lib.versions.filter((candidate) => candidate.hash !== hash)
  const retiredBuiltIns = version.builtIn ? [...lib.retiredBuiltIns, hash] : lib.retiredBuiltIns
  return { ...lib, versions, retiredBuiltIns }
}

export async function seedLibrary(builtInText: string, now: string): Promise<PromptLibrary> {
  const version = await newVersion(builtInText, now, true, BUILT_IN_NAME)
  return { versions: [version], liveHash: version.hash, retiredBuiltIns: [] }
}

export async function reconcile(lib: PromptLibrary, builtInText: string, now: string): Promise<PromptLibrary> {
  const version = await newVersion(builtInText, now, true, null)
  if (findVersion(lib, version.hash) !== undefined || lib.retiredBuiltIns.includes(version.hash)) return lib
  return { ...lib, versions: [...lib.versions, version] }
}

export function livePrompt(lib: PromptLibrary): PromptVersion {
  return mustFind(lib, lib.liveHash)
}
