import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PullRef } from '@shared/types'
import { buildStoryGuide } from '@shared/guide'
import { capyStoryIndex, capyStoryPull } from '@shared/guide/fixtures'
import type { CodeIndexService } from './code-index/service'
import { GuideService } from './guide-ai'
import { PromptStore } from './prompt-store'
import type { PullService } from './pulls'
import type { SecretsStore } from './secrets'
import type { SettingsStore } from './settings'

describe('GuideService cache', () => {
  it('backfills questions and the built-in prompt hash into a guide cached before they existed instead of calling Claude again', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'prot-guides-'))
    const ref = capyStoryPull.summary.ref
    const base = `${ref.owner}__${ref.repo}__${ref.number}`
    const { questions: _dropped, ...story } = buildStoryGuide(capyStoryPull, capyStoryIndex)
    writeFileSync(join(dir, `${base}.json`), JSON.stringify({ ...story, source: 'ai', coverage: {} }))
    writeFileSync(join(dir, `${base}__4c5ea1e9.json`), '{}')

    const secrets = {
      anthropicKey: async () => {
        throw new Error('generated a new guide')
      }
    } as unknown as SecretsStore
    const pulls = { cached: async () => capyStoryPull } as unknown as PullService
    const code = { index: async () => ({ index: capyStoryIndex, heads: {} }) } as unknown as CodeIndexService
    const prompts = new PromptStore(join(dir, 'prompts', 'prompts.json'), { guide: 'You write guided code reviews.', chat: 'You answer review questions.', agent: 'You run agents.' })
    await prompts.setLive('guide', (await prompts.save('guide', 'Review risk first.')).version.hash)
    const service = new GuideService(secrets, {} as SettingsStore, prompts, pulls, code, dir)

    const guide = await service.get(ref, false)

    const expected = [
      'What else calls normalizeText, and does the change to it break them?',
      'Who can call MainActivity.onNewIntent, and does CapyShareModule.takeShare change what it returns or who is allowed?',
      'What covers normalizeText now that it has no tests in this PR?',
      'Who can call appendMessage, and does normalizeText change what it returns or who is allowed?'
    ]
    expect({ source: guide.source, questions: guide.questions, promptHash: guide.source === 'ai' && guide.promptHash }).toEqual({
      source: 'ai',
      questions: expected,
      promptHash: 'd1a090fa9228'
    })
    const stored = JSON.parse(readFileSync(join(dir, `${base}.json`), 'utf8'))
    expect({ questions: stored.questions, promptHash: stored.promptHash }).toEqual({ questions: expected, promptHash: 'd1a090fa9228' })
    expect(readdirSync(dir).sort()).toEqual([`${base}.json`, 'prompts'])
  })
})

describe('GuideService cached overview', () => {
  it('reads the risk level and synopsis of a guide cached before the overview became one goal sentence', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'prot-guides-'))
    const ref = capyStoryPull.summary.ref
    const story = buildStoryGuide(capyStoryPull, capyStoryIndex)
    const overview = { risk: { level: 'high', reason: 'Every share goes through takeShare.' }, synopsis: 'Routes Android shares into a thread.' }
    writeFileSync(join(dir, cacheName(ref)), JSON.stringify({ ...story, overview, source: 'ai', coverage: {}, promptHash: 'd1a090fa9228' }))

    const guide = await serviceFor(dir).get(ref, false)

    expect(guide.overview).toEqual({ risk: 'high', goal: 'Routes Android shares into a thread.' })
  })
})

function cacheName(ref: PullRef): string {
  return `${ref.owner}__${ref.repo}__${ref.number}.json`
}

function serviceFor(dir: string, pulls: Partial<PullService> = {}): GuideService {
  const code = { index: async () => ({ index: capyStoryIndex, heads: {} }) } as unknown as CodeIndexService
  const prompts = new PromptStore(join(mkdtempSync(join(tmpdir(), 'prot-prompts-')), 'prompts.json'), { guide: 'You write guided code reviews.', chat: 'You answer review questions.', agent: 'You run agents.' })
  return new GuideService({} as SecretsStore, {} as SettingsStore, prompts, pulls as PullService, code, dir)
}

describe('GuideService forget', () => {
  it('a guide still loading when it is forgotten reaches the caller but is not written back', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'prot-guides-'))
    const ref = capyStoryPull.summary.ref
    const { questions: _dropped, ...story } = buildStoryGuide(capyStoryPull, capyStoryIndex)
    writeFileSync(join(dir, cacheName(ref)), JSON.stringify({ ...story, source: 'ai', coverage: {} }))
    let release = () => {}
    let reading = () => {}
    const detail = new Promise<typeof capyStoryPull>((resolve) => (release = () => resolve(capyStoryPull)))
    const backfilling = new Promise<void>((resolve) => (reading = resolve))
    const service = serviceFor(dir, {
      cached: () => {
        reading()
        return detail
      }
    })

    const loading = service.get(ref, false)
    await backfilling
    await service.forget(ref)
    release()
    const guide = await loading

    expect({ goal: guide.overview.goal === story.overview.goal, files: readdirSync(dir).sort() }).toEqual({
      goal: true,
      files: []
    })
  })
})
