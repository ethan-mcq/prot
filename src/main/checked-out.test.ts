import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CheckedOutStore } from './checked-out'

const tools = { owner: 'octo-labs', repo: 'tools', number: 42 }
const capy = { owner: 'capy-ai', repo: 'capy', number: 5251 }

afterEach(() => {
  vi.useRealTimers()
})

describe('CheckedOutStore', () => {
  it('starts empty from a corrupt file, adds each pull once, removes, and reloads what it wrote', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-07T12:00:00Z'))
    const file = join(mkdtempSync(join(tmpdir(), 'prot-checked-out-')), 'checked-out.json')
    writeFileSync(file, '{not json')

    const store = new CheckedOutStore(file)
    const empty = store.list()
    await Promise.all([store.add(tools), store.add(capy), store.add(tools)])
    await store.remove(capy)
    await store.remove(capy)

    expect({ empty, onDisk: JSON.parse(readFileSync(file, 'utf8')), reloaded: new CheckedOutStore(file).list() }).toEqual({
      empty: [],
      onDisk: [{ owner: 'octo-labs', repo: 'tools', number: 42, addedAt: '2026-10-07T12:00:00.000Z' }],
      reloaded: [tools]
    })
  })

  it('drops entries that fail validation and keeps the rest', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'prot-checked-out-')), 'checked-out.json')
    writeFileSync(
      file,
      JSON.stringify([
        { ...tools, addedAt: '2026-10-07T12:00:00Z' },
        { owner: 'a/b', repo: 'x', number: 1, addedAt: '2026-10-07T12:00:00Z' },
        { owner: '..', repo: 'x', number: 1, addedAt: '2026-10-07T12:00:00Z' },
        { ...capy, number: 0, addedAt: '2026-10-07T12:00:00Z' },
        { ...capy }
      ])
    )
    expect(new CheckedOutStore(file).list()).toEqual([tools])
  })
})
