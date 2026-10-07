import { readFile, mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import type { AuthSource, GitHubUser } from '@shared/types'

export type Secrets = {
  githubToken: string | null
  githubSource: AuthSource | null
  // Cached so a restart while offline can stay signed in.
  githubUser: GitHubUser | null
  anthropicKey: string | null
}

const EMPTY: Secrets = {
  githubToken: null,
  githubSource: null,
  githubUser: null,
  anthropicKey: null
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

function parseSecrets(raw: unknown): Secrets {
  if (typeof raw !== 'object' || raw === null) return { ...EMPTY }
  const record = raw as Record<string, unknown>
  const user = record.githubUser as Partial<GitHubUser> | null | undefined
  return {
    githubToken: isString(record.githubToken) ? record.githubToken : null,
    githubSource:
      record.githubSource === 'gh' || record.githubSource === 'token' ? record.githubSource : null,
    githubUser:
      user && typeof user.login === 'string' && typeof user.avatarUrl === 'string'
        ? { login: user.login, avatarUrl: user.avatarUrl }
        : null,
    anthropicKey: isString(record.anthropicKey) ? record.anthropicKey : null
  }
}

export class SecretsStore {
  private cache: Secrets | null = null
  private readonly file = join(app.getPath('userData'), 'secrets.bin')

  async get(): Promise<Secrets> {
    if (this.cache) return this.cache
    this.cache = await this.load()
    return this.cache
  }

  async update(patch: Partial<Secrets>): Promise<Secrets> {
    const next = { ...(await this.get()), ...patch }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Secure storage is not available on this system, so secrets cannot be saved.')
    }
    await mkdir(app.getPath('userData'), { recursive: true })
    const tmp = `${this.file}.tmp`
    await writeFile(tmp, safeStorage.encryptString(JSON.stringify(next)), { mode: 0o600 })
    await rename(tmp, this.file)
    this.cache = next
    return next
  }

  async anthropicKey(): Promise<string | null> {
    const stored = (await this.get()).anthropicKey
    if (stored) return stored
    return process.env.ANTHROPIC_API_KEY?.trim() || null
  }

  // Either a stored key or the environment variable counts as "set".
  async hasAnthropicKey(): Promise<boolean> {
    return (await this.anthropicKey()) !== null
  }

  private async load(): Promise<Secrets> {
    let encrypted: Buffer
    try {
      encrypted = await readFile(this.file)
    } catch {
      return { ...EMPTY }
    }
    try {
      return parseSecrets(JSON.parse(safeStorage.decryptString(encrypted)))
    } catch {
      // A keychain reset makes the old blob undecryptable. Starting empty means signing in again.
      return { ...EMPTY }
    }
  }
}
