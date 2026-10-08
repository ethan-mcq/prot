import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PromptLibrary } from '@shared/prompts'
import { PromptStore } from './prompt-store'

const SHIPPED = 'You write guided code reviews.'

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
    const store = new PromptStore(file, SHIPPED)
    const seeded = summary(await store.get())
    const { version } = await store.save('Review risk first.')
    await store.rename(version.hash, 'terse risk-first')
    await store.setLive(version.hash)

    const reopened = summary(await new PromptStore(file, SHIPPED).get())
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
    const first = new PromptStore(file, SHIPPED)
    const { version } = await first.save('Review risk first.')
    await first.setLive(version.hash)

    const upgraded = await new PromptStore(file, 'You write guided code reviews, risk first.').get()
    expect(summary(upgraded)).toEqual({
      liveHash: 'e40065d9dff0',
      versions: ['d1a090fa9228 built-in default built-in', 'e40065d9dff0 - saved', 'e6945cfbcd0b - built-in']
    })
    expect(summary(JSON.parse(readFileSync(file, 'utf8')))).toEqual(summary(upgraded))
  })

  it('keeps a deleted version deleted across a restart, including a built-in the shipped prompt still matches', async () => {
    const file = tempFile()
    const store = new PromptStore(file, SHIPPED)
    const { version } = await store.save('Review risk first.')
    await store.setLive(version.hash)
    const removed = await store.remove('d1a090fa9228')

    const reopened = await new PromptStore(file, SHIPPED).get()
    expect({ removed: summary(removed), reopened: summary(reopened), retired: reopened.retiredBuiltIns }).toEqual({
      removed: { liveHash: 'e40065d9dff0', versions: ['e40065d9dff0 - saved'] },
      reopened: { liveHash: 'e40065d9dff0', versions: ['e40065d9dff0 - saved'] },
      retired: ['d1a090fa9228']
    })
  })

  it.each([
    ['unparseable JSON', '{"versions": ['],
    ['a live hash with no version', JSON.stringify({ versions: [], liveHash: 'd1a090fa9228' })]
  ])('reseeds a corrupt file (%s) and keeps a backup of it', async (_case, contents) => {
    const file = tempFile(contents)
    const library = await new PromptStore(file, SHIPPED).get()
    expect({
      library: summary(library),
      backup: readFileSync(join(file, '..', 'prompts.corrupt.json'), 'utf8')
    }).toEqual({
      library: { liveHash: 'd1a090fa9228', versions: ['d1a090fa9228 built-in default built-in'] },
      backup: contents
    })
  })
})
