import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PromptLibrary } from '@shared/prompts'
import { PromptStore } from './prompt-store'

const SHIPPED = 'You write guided code reviews.'
const CHAT = 'You answer review questions.'
const BUILT_INS = { guide: SHIPPED, chat: CHAT, agent: 'You run agents.' }

function summary(lib: PromptLibrary) {
  return {
    liveHash: lib.liveHash,
    versions: lib.versions.map((v) => `${v.hash} ${v.name ?? '-'} ${v.builtIn ? 'built-in' : 'saved'}`)
  }
}

function tempFile(contents?: string): string {
  const file = join(mkdtempSync(join(tmpdir(), 'prot-prompts-')), 'prompts.json')
  if (contents !== undefined) writeFileSync(file, contents)
  return file
}

describe('PromptStore', () => {
  it('seeds the shipped prompt when there is no file, and keeps saved, renamed and live changes across a restart', async () => {
    const file = tempFile()
    const store = new PromptStore(file, BUILT_INS)
    const seeded = summary(await store.get('guide'))
    const { version } = await store.save('guide', 'Review risk first.')
    await store.rename('guide', version.hash, 'terse risk-first')
    await store.setLive('guide', version.hash)

    const reopened = summary(await new PromptStore(file, BUILT_INS).get('guide'))
    expect({ seeded, reopened }).toEqual({
      seeded: { liveHash: 'd1a090fa9228', versions: ['d1a090fa9228 built-in default built-in'] },
      reopened: {
        liveHash: 'e40065d9dff0',
        versions: ['d1a090fa9228 built-in default built-in', 'e40065d9dff0 terse risk-first saved']
      }
    })
  })

  it('adds a changed shipped prompt as a built-in version and keeps the live one', async () => {
    const file = tempFile()
    const first = new PromptStore(file, BUILT_INS)
    const { version } = await first.save('guide', 'Review risk first.')
    await first.setLive('guide', version.hash)

    const upgraded = await new PromptStore(file, { guide: 'You write guided code reviews, risk first.', chat: CHAT, agent: 'You run agents.' }).get('guide')
    expect(summary(upgraded)).toEqual({
      liveHash: 'e40065d9dff0',
      versions: ['d1a090fa9228 built-in default built-in', 'e40065d9dff0 - saved', 'e6945cfbcd0b - built-in']
    })
    expect(summary(JSON.parse(readFileSync(file, 'utf8')).guide)).toEqual(summary(upgraded))
  })

  it('keeps a deleted version deleted across a restart, including a built-in the shipped prompt still matches', async () => {
    const file = tempFile()
    const store = new PromptStore(file, BUILT_INS)
    const { version } = await store.save('guide', 'Review risk first.')
    await store.setLive('guide', version.hash)
    const removed = await store.remove('guide', 'd1a090fa9228')

    const reopened = await new PromptStore(file, BUILT_INS).get('guide')
    expect({ removed: summary(removed), reopened: summary(reopened), retired: reopened.retiredBuiltIns }).toEqual({
      removed: { liveHash: 'e40065d9dff0', versions: ['e40065d9dff0 - saved'] },
      reopened: { liveHash: 'e40065d9dff0', versions: ['e40065d9dff0 - saved'] },
      retired: ['d1a090fa9228']
    })
  })

  it.each([
    ['unparseable JSON', '{"versions": ['],
    ['a live hash with no version', JSON.stringify({ versions: [], liveHash: 'd1a090fa9228' })],
    ['a chat library with no versions', JSON.stringify({ chat: { versions: [], liveHash: '18b4da50330c' } })]
  ])('reseeds a corrupt file (%s) and keeps a backup of it', async (_case, contents) => {
    const file = tempFile(contents)
    const store = new PromptStore(file, BUILT_INS)
    expect({
      guide: summary(await store.get('guide')),
      chat: summary(await store.get('chat')),
      backup: readFileSync(join(file, '..', 'prompts.corrupt.json'), 'utf8')
    }).toEqual({
      guide: { liveHash: 'd1a090fa9228', versions: ['d1a090fa9228 built-in default built-in'] },
      chat: { liveHash: '18b4da50330c', versions: ['18b4da50330c built-in default built-in'] },
      backup: contents
    })
  })

  it('moves a file written before chat prompts into the guide kind, keeping names, live and retired, and seeds chat', async () => {
    const old = {
      versions: [
        { hash: 'e40065d9dff0', name: 'terse risk-first', text: 'Review risk first.', createdAt: '2026-10-02T00:00:00.000Z', builtIn: false }
      ],
      liveHash: 'e40065d9dff0',
      retiredBuiltIns: ['d1a090fa9228']
    }
    const file = tempFile(JSON.stringify(old))
    const store = new PromptStore(file, BUILT_INS)
    const migrated = { guide: await store.get('guide'), chat: summary(await store.get('chat')) }
    const onDisk = JSON.parse(readFileSync(file, 'utf8'))

    expect({ migrated, onDisk: { guide: onDisk.guide, chat: summary(onDisk.chat) } }).toEqual({
      migrated: { guide: old, chat: { liveHash: '18b4da50330c', versions: ['18b4da50330c built-in default built-in'] } },
      onDisk: { guide: old, chat: { liveHash: '18b4da50330c', versions: ['18b4da50330c built-in default built-in'] } }
    })
  })

  it('saves and makes live per kind, so a chat change leaves the guide library alone across a restart', async () => {
    const file = tempFile()
    const store = new PromptStore(file, BUILT_INS)
    const { version } = await store.save('chat', 'Answer in one paragraph.')
    await store.setLive('chat', version.hash)

    const reopened = new PromptStore(file, BUILT_INS)
    expect({ guide: summary(await reopened.get('guide')), chat: summary(await reopened.get('chat')) }).toEqual({
      guide: { liveHash: 'd1a090fa9228', versions: ['d1a090fa9228 built-in default built-in'] },
      chat: { liveHash: '3ad61afefe65', versions: ['18b4da50330c built-in default built-in', '3ad61afefe65 - saved'] }
    })
  })
})
