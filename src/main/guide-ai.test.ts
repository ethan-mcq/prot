import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
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
    const prompts = new PromptStore(join(dir, 'prompts', 'prompts.json'), 'You write guided code reviews.')
    await prompts.setLive((await prompts.save('Review risk first.')).version.hash)
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
