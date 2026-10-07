import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildStoryGuide } from '@shared/guide'
import { capyStoryIndex, capyStoryPull } from '@shared/guide/fixtures'
import type { CodeIndexService } from './code-index/service'
import { GuideService } from './guide-ai'
import type { PullService } from './pulls'
import type { SecretsStore } from './secrets'
import type { SettingsStore } from './settings'

describe('GuideService cache', () => {
  it('backfills questions into a guide cached before they existed instead of calling Claude again', async () => {
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
    const service = new GuideService(secrets, {} as SettingsStore, pulls, code, dir)

    const guide = await service.get(ref, false)

    const expected = [
      'What else calls normalizeText, and does the change to it break them?',
      'Who can call MainActivity.onNewIntent, and does CapyShareModule.takeShare change what it returns or who is allowed?',
      'What covers normalizeText now that it has no tests in this PR?',
      'Who can call appendMessage, and does normalizeText change what it returns or who is allowed?'
    ]
    expect({ source: guide.source, questions: guide.questions }).toEqual({ source: 'ai', questions: expected })
    expect(JSON.parse(readFileSync(join(dir, `${base}.json`), 'utf8')).questions).toEqual(expected)
    expect(readdirSync(dir)).toEqual([`${base}.json`])
  })
})
