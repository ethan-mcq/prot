import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PullDetail, PullRef, PullState, ReviewEvent } from '@shared/types'
import { capyStoryPull } from '@shared/guide/fixtures'
import type { AttachmentLink } from './attachment-links'
import { AttachmentService } from './attachments'
import type { CodeIndexService } from './code-index/service'
import { GuideService } from './guide-ai'
import { PromptStore } from './prompt-store'
import { PullCache, type PullStateLookup } from './pull-cache'
import type { PullService } from './pulls'
import type { SecretsStore } from './secrets'
import type { SettingsStore } from './settings'

const name = (ref: PullRef) => `${ref.owner}__${ref.repo}__${ref.number}`

function cacheFor(refs: PullRef[], attachmentRefs: PullRef[] = refs) {
  const guides = mkdtempSync(join(tmpdir(), 'prot-guides-'))
  const attachments = mkdtempSync(join(tmpdir(), 'prot-attachments-'))
  for (const ref of refs) writeFileSync(join(guides, `${name(ref)}.json`), '{}')
  for (const ref of attachmentRefs) {
    mkdirSync(join(attachments, name(ref)))
    writeFileSync(join(attachments, name(ref), 'manifest.json'), '[]')
  }
  const prompts = new PromptStore(join(mkdtempSync(join(tmpdir(), 'prot-prompts-')), 'prompts.json'), 'You write guided code reviews.')
  const guide = new GuideService({} as SecretsStore, {} as SettingsStore, prompts, {} as PullService, {} as CodeIndexService, guides)
  const service = new AttachmentService(attachments, () => ({}), () => {})
  const cache = new PullCache(guide, service, 'https://github.com')
  const left = () => ({ guides: readdirSync(guides).sort(), attachments: readdirSync(attachments).sort() })
  return { cache, guides, left }
}

const review = (event: ReviewEvent) => ({ commitId: 'head1', event, body: '', comments: [] })

describe('PullCache lifecycle', () => {
  const approved = { owner: 'acme', repo: 'api', number: 1 }
  const commented = { owner: 'acme', repo: 'api', number: 2 }

  it('a finished review deletes the guide and the attachments, a comment keeps both, and forget deletes them', async () => {
    const { cache, left } = cacheFor([approved, commented])

    await cache.reviewed(approved, review('APPROVE'))
    await cache.reviewed(commented, review('COMMENT'))
    const afterReviews = left()
    await cache.forget(commented)

    expect({ afterReviews, afterForget: left() }).toEqual({
      afterReviews: { guides: ['acme__api__2.json'], attachments: ['acme__api__2'] },
      afterForget: { guides: [], attachments: [] }
    })
  })

  it('does not import attachments again for the head a finished review was submitted at, and does for a new head', async () => {
    const imported: string[] = []
    const attachments = { import: (_ref: PullRef, links: AttachmentLink[]) => imported.push(links.map((link) => link.url).join(',')) }
    const prompts = new PromptStore(join(mkdtempSync(join(tmpdir(), 'prot-prompts-')), 'prompts.json'), 'x')
    const guide = new GuideService({} as SecretsStore, {} as SettingsStore, prompts, {} as PullService, {} as CodeIndexService, mkdtempSync(join(tmpdir(), 'prot-guides-')))
    const cache = new PullCache(guide, { ...attachments, remove: async () => {} } as unknown as AttachmentService, 'https://github.com')
    const ref = capyStoryPull.summary.ref
    const documents = [{ source: 'description', html: '<img src="https://github.com/user-attachments/assets/a1" alt="shot">', markdown: '' }]
    const at = (sha: string): PullDetail => ({ ...capyStoryPull, head: { ...capyStoryPull.head, sha } })

    await cache.reviewed(ref, { ...review('APPROVE'), commitId: 'head1' })
    cache.fetched(ref, at('head1'), documents)
    cache.fetched(ref, at('head2'), documents)

    expect(imported).toEqual(['https://github.com/user-attachments/assets/a1'])
  })
})

describe('PullCache sweep', () => {
  const open = { owner: 'acme', repo: 'api', number: 1 }
  const merged = { owner: 'acme', repo: 'api', number: 2 }
  const gone = { owner: 'acme', repo: 'my__repo', number: 3 }
  const unseen = { owner: 'sso-org', repo: 'private', number: 4 }
  const attachmentsOnly = { owner: 'acme', repo: 'web', number: 5 }
  const lookup: PullStateLookup = async () =>
    new Map<string, PullState | null>([
      ['acme/api#1', 'open'],
      ['acme/api#2', 'merged'],
      ['acme/my__repo#3', null],
      ['acme/web#5', 'closed']
    ])

  it('deletes the guide and attachments of merged, closed and missing PRs and keeps open and unchecked ones', async () => {
    const { cache, guides, left } = cacheFor([open, merged, gone, unseen], [open, merged, attachmentsOnly])
    writeFileSync(join(guides, 'acme__api__1__4c5ea1e9.json'), '{}')
    let asked: string[] = []
    await cache.sweep(async (refs) => {
      asked = refs.map((ref) => `${ref.owner}/${ref.repo}#${ref.number}`).sort()
      return lookup(refs)
    })
    expect({ asked, left: left() }).toEqual({
      asked: ['acme/api#1', 'acme/api#2', 'acme/my__repo#3', 'acme/web#5', 'sso-org/private#4'],
      left: {
        guides: ['acme__api__1.json', 'acme__api__1__4c5ea1e9.json', 'sso-org__private__4.json'],
        attachments: ['acme__api__1']
      }
    })
  })

  it('a lookup that throws deletes nothing', async () => {
    const { cache, left } = cacheFor([open, merged, gone])
    const failed = cache.sweep(async () => {
      throw new Error('Could not reach GitHub')
    })
    await expect(failed).rejects.toThrow('Could not reach GitHub')
    expect(left()).toEqual({
      guides: ['acme__api__1.json', 'acme__api__2.json', 'acme__my__repo__3.json'],
      attachments: ['acme__api__1', 'acme__api__2', 'acme__my__repo__3']
    })
  })
})
