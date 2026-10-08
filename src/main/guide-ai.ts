import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { withOutputStyle } from '@shared/output-style'
import { livePrompt } from '@shared/prompts'
import { pullKey, type Guide, type PullDetail, type PullRef } from '@shared/types'
import { GUIDE_SCHEMA, buildGuidePrompt, buildStoryGuide, parseAiGuide } from '@shared/guide'
import { createClient, describeAiError, modelParams, refusalMessage } from './claude'
import type { CodeIndexService } from './code-index/service'
import type { PromptStore } from './prompt-store'
import { cacheName, parseCacheName } from './pull-cache'
import type { PullService } from './pulls'
import type { SecretsStore } from './secrets'
import type { SettingsStore } from './settings'

const GUIDE_MAX_TOKENS = 32_000

function cacheFileName(ref: PullRef): string {
  return `${cacheName(ref)}.json`
}

type CachedGuide = Omit<Extract<Guide, { source: 'ai' }>, 'questions' | 'promptHash'> & { questions?: unknown; promptHash?: unknown }

// The shape a cached guide needs to be reusable. Fields added since (questions, promptHash) are backfilled, not regenerated.
function isCachedGuide(value: unknown): value is CachedGuide {
  if (typeof value !== 'object' || value === null) return false
  const guide = value as Record<string, unknown>
  return (
    guide.source === 'ai' &&
    typeof guide.headSha === 'string' &&
    Array.isArray(guide.chapters) &&
    typeof guide.symbols === 'object' &&
    guide.symbols !== null &&
    typeof (guide.overview as { synopsis?: unknown } | undefined)?.synopsis === 'string' &&
    typeof guide.coverage === 'object' &&
    guide.coverage !== null
  )
}

export class GuideService {
  private readonly inFlight = new Map<string, Promise<Guide>>()
  // Bumped by forget, so a guide still generating when its PR was reviewed is not written back.
  private readonly generations = new Map<string, number>()

  constructor(
    private readonly secrets: SecretsStore,
    private readonly settings: SettingsStore,
    private readonly prompts: PromptStore,
    private readonly pulls: PullService,
    private readonly code: CodeIndexService,
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

  async forget(ref: PullRef): Promise<void> {
    const key = pullKey(ref)
    this.generations.set(key, this.generation(ref) + 1)
    this.inFlight.delete(`${key}:true`)
    this.inFlight.delete(`${key}:false`)
    await rm(join(this.cacheDir, cacheFileName(ref)), { force: true })
  }

  async cachedRefs(): Promise<PullRef[]> {
    let names: string[]
    try {
      names = await readdir(this.cacheDir)
    } catch {
      return []
    }
    const refs: PullRef[] = []
    for (const name of names) {
      const ref = name.endsWith('.json') ? parseCacheName(name.slice(0, -'.json'.length)) : null
      if (ref) refs.push(ref)
    }
    return refs
  }

  private generation(ref: PullRef): number {
    return this.generations.get(pullKey(ref)) ?? 0
  }

  private async load(ref: PullRef, refresh: boolean): Promise<Guide> {
    const file = join(this.cacheDir, cacheFileName(ref))
    const generation = this.generation(ref)
    if (!refresh) {
      const cached = await this.readCache(file)
      if (cached && Array.isArray(cached.questions) && typeof cached.promptHash === 'string') return cached as Guide
      if (cached) {
        const upgraded = await this.backfill(ref, cached)
        if (this.generation(ref) === generation) await this.writeCache(ref, file, upgraded)
        return upgraded
      }
    }
    const guide = await this.generate(ref, await this.pulls.cached(ref))
    if (this.generation(ref) === generation) await this.writeCache(ref, file, guide)
    return guide
  }

  // A guide cached before prompt versions existed was written with the prompt the library was seeded from.
  private async backfill(ref: PullRef, cached: CachedGuide): Promise<Guide> {
    let questions: string[]
    if (Array.isArray(cached.questions)) questions = cached.questions
    else {
      const detail = await this.pulls.cached(ref)
      const { index } = await this.code.index(ref, detail)
      questions = buildStoryGuide(detail, index).questions
    }
    const library = await this.prompts.get('guide')
    const seeded = library.versions.find((version) => version.builtIn) ?? livePrompt(library)
    const promptHash = typeof cached.promptHash === 'string' ? cached.promptHash : seeded.hash
    return { ...cached, questions, promptHash }
  }

  private async readCache(file: string): Promise<CachedGuide | null> {
    try {
      const parsed: unknown = JSON.parse(await readFile(file, 'utf8'))
      return isCachedGuide(parsed) ? parsed : null
    } catch {
      return null
    }
  }

  private async writeCache(ref: PullRef, file: string, guide: Guide): Promise<void> {
    await mkdir(this.cacheDir, { recursive: true })
    const tmp = `${file}.tmp`
    await writeFile(tmp, JSON.stringify(guide))
    await rename(tmp, file)
    await this.removeLegacyCache(ref)
  }

  // Guides were once cached per head sha; those files are never read again.
  private async removeLegacyCache(ref: PullRef): Promise<void> {
    const prefix = cacheFileName(ref).replace(/\.json$/, '__')
    for (const name of await readdir(this.cacheDir)) {
      if (name.startsWith(prefix) && name.endsWith('.json')) await rm(join(this.cacheDir, name), { force: true })
    }
  }

  private async generate(ref: PullRef, detail: PullDetail): Promise<Guide> {
    const client = await createClient(this.secrets)
    const { index, heads } = await this.code.index(ref, detail)
    const story = buildStoryGuide(detail, index)
    const live = livePrompt(await this.prompts.get('guide'))
    const prompt = buildGuidePrompt(detail, story, heads, withOutputStyle(live.text, this.settings.get().outputStyle))
    const model = this.settings.get().model
    let message
    try {
      message = await client.beta.messages
        .stream({
          model,
          max_tokens: GUIDE_MAX_TOKENS,
          system: prompt.system,
          messages: [{ role: 'user', content: prompt.user }],
          ...modelParams(model, 'medium', { type: 'json_schema', schema: GUIDE_SCHEMA })
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
    return parseAiGuide(raw, detail, story, live.hash)
  }
}
