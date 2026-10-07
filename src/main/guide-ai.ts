import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pullKey, type Guide, type PullDetail, type PullRef } from '@shared/types'
import { GUIDE_SCHEMA, buildGuidePrompt, parseAiGuide } from '@shared/guide'
import { createClient, describeAiError, modelParams, refusalMessage } from './claude'
import type { PullService } from './pulls'
import type { SecretsStore } from './secrets'
import type { SettingsStore } from './settings'

const GUIDE_MAX_TOKENS = 32_000

function cacheFileName(ref: PullRef): string {
  return `${ref.owner}__${ref.repo}__${ref.number}.json`
}

function isCachedGuide(value: unknown): value is Guide {
  if (typeof value !== 'object' || value === null) return false
  const guide = value as Record<string, unknown>
  return (
    guide.source === 'ai' &&
    typeof guide.headSha === 'string' &&
    Array.isArray(guide.chapters) &&
    typeof guide.coverage === 'object' &&
    guide.coverage !== null
  )
}

export class GuideService {
  private readonly inFlight = new Map<string, Promise<Guide>>()

  constructor(
    private readonly secrets: SecretsStore,
    private readonly settings: SettingsStore,
    private readonly pulls: PullService,
    private readonly cacheDir: string
  ) {}

  get(ref: PullRef, refresh: boolean): Promise<Guide> {
    const key = `${pullKey(ref)}:${refresh}`
    const running = this.inFlight.get(key)
    if (running) return running
    const next = this.load(ref, refresh).finally(() => this.inFlight.delete(key))
    this.inFlight.set(key, next)
    return next
  }

  private async load(ref: PullRef, refresh: boolean): Promise<Guide> {
    const file = join(this.cacheDir, cacheFileName(ref))
    if (!refresh) {
      const cached = await this.readCache(file)
      if (cached) return cached
    }
    const guide = await this.generate(await this.pulls.cached(ref))
    await this.writeCache(file, guide)
    return guide
  }

  private async readCache(file: string): Promise<Guide | null> {
    try {
      const parsed: unknown = JSON.parse(await readFile(file, 'utf8'))
      return isCachedGuide(parsed) ? parsed : null
    } catch {
      return null
    }
  }

  private async writeCache(file: string, guide: Guide): Promise<void> {
    await mkdir(this.cacheDir, { recursive: true })
    const tmp = `${file}.tmp`
    await writeFile(tmp, JSON.stringify(guide))
    await rename(tmp, file)
  }

  private async generate(detail: PullDetail): Promise<Guide> {
    const client = await createClient(this.secrets)
    const prompt = buildGuidePrompt(detail)
    const model = this.settings.get().model
    let message
    try {
      message = await client.beta.messages
        .stream({
          model,
          max_tokens: GUIDE_MAX_TOKENS,
          system: prompt.system,
          messages: [{ role: 'user', content: prompt.user }],
          ...modelParams(model, 'high', { type: 'json_schema', schema: GUIDE_SCHEMA })
        })
        .finalMessage()
    } catch (error) {
      throw new Error(describeAiError(error))
    }
    if (message.stop_reason === 'refusal') throw new Error(refusalMessage(message.stop_details))
    if (message.stop_reason === 'max_tokens') {
      throw new Error('The AI guide was cut off before it finished. Try again or use a smaller pull request.')
    }
    const text = message.content.find((block) => block.type === 'text')
    if (!text) throw new Error('Claude returned no guide.')
    let raw: unknown
    try {
      raw = JSON.parse(text.text)
    } catch {
      throw new Error('Claude returned a guide that was not valid JSON. Try again.')
    }
    return parseAiGuide(raw, detail)
  }
}
