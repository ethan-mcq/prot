import { describe, expect, it } from 'vitest'
import {
  displayName,
  livePrompt,
  promptHash,
  reconcile,
  renameVersion,
  saveVersion,
  seedLibrary,
  setLive,
  type PromptLibrary
} from './prompts'

const BUILT_IN = 'You write guided code reviews.'
const SEEDED = '2026-10-01T00:00:00.000Z'
const LATER = '2026-10-07T12:00:00.000Z'

const seeded: PromptLibrary = {
  versions: [{ hash: 'd1a090fa9228', name: 'built-in default', text: BUILT_IN, createdAt: SEEDED, builtIn: true }],
  liveHash: 'd1a090fa9228'
}

describe('seedLibrary and livePrompt', () => {
  it('starts with one live built-in version named built-in default', async () => {
    const lib = await seedLibrary(BUILT_IN, SEEDED)
    expect({ lib, live: livePrompt(lib).text }).toEqual({ lib: seeded, live: BUILT_IN })
  })
})

describe('saveVersion', () => {
  it.each([
    ['new text appends a version', 'Review risk first.', 'e40065d9dff0', 'Review risk first.', ['d1a090fa9228', 'e40065d9dff0']],
    ['trailing whitespace per line and at the end is normalised away', 'Line one   \nLine two\t\r\n\n  ', '6991ce0a6fcd', 'Line one\nLine two', ['d1a090fa9228', '6991ce0a6fcd']],
    ['the built-in text with trailing blank lines is the built-in version', `${BUILT_IN}  \n\n`, 'd1a090fa9228', BUILT_IN, ['d1a090fa9228']]
  ])('%s, and live stays on the built-in', async (_case, text, hash, stored, hashes) => {
    const { library, version } = await saveVersion(seeded, text, LATER)
    expect({
      hash: version.hash,
      text: version.text,
      builtIn: version.builtIn,
      hashes: library.versions.map((v) => v.hash),
      liveHash: library.liveHash
    }).toEqual({ hash, text: stored, builtIn: hash === 'd1a090fa9228', hashes, liveHash: 'd1a090fa9228' })
  })

  it('returns the same library and the first version when the text is already saved', async () => {
    const first = await saveVersion(seeded, 'Review risk first.', LATER)
    const named = renameVersion(first.library, 'e40065d9dff0', 'terse')
    const again = await saveVersion(named, 'Review risk first.\n', '2026-10-08T00:00:00.000Z')
    expect({ same: again.library === named, version: again.version }).toEqual({
      same: true,
      version: { hash: 'e40065d9dff0', name: 'terse', text: 'Review risk first.', createdAt: LATER, builtIn: false }
    })
  })

  it.each([[''], ['  \n\t\n']])('rejects empty text %j', async (text) => {
    await expect(saveVersion(seeded, text, LATER)).rejects.toThrow('The prompt is empty')
  })
})

describe('renameVersion', () => {
  it.each([
    ['trims the name', '  terse risk-first  ', 'terse risk-first', 'terse risk-first'],
    ['an empty name shows the hash again', '   ', null, 'd1a090fa9228'],
    ['sixty characters fit', 'x'.repeat(60), 'x'.repeat(60), 'x'.repeat(60)]
  ])('%s', (_case, name, stored, shown) => {
    const renamed = renameVersion(seeded, 'd1a090fa9228', name)
    const version = renamed.versions[0]
    expect(version && { name: version.name, shown: displayName(version) }).toEqual({ name: stored, shown })
  })

  it('rejects a name over sixty characters', () => {
    expect(() => renameVersion(seeded, 'd1a090fa9228', 'x'.repeat(61))).toThrow('A prompt name is at most 60 characters')
  })
})

describe('unknown hashes', () => {
  it.each([
    ['renameVersion', () => renameVersion(seeded, 'aaaaaaaaaaaa', 'x')],
    ['setLive', () => setLive(seeded, 'aaaaaaaaaaaa')],
    ['livePrompt', () => livePrompt({ ...seeded, liveHash: 'aaaaaaaaaaaa' })]
  ])('%s rejects a hash that is not in the library', (_case, call) => {
    expect(call).toThrow('No prompt version aaaaaaaaaaaa')
  })
})

describe('setLive', () => {
  it('makes a saved version live and serves its text', async () => {
    const { library } = await saveVersion(seeded, 'Review risk first.', LATER)
    const live = setLive(library, 'e40065d9dff0')
    expect({ liveHash: live.liveHash, text: livePrompt(live).text, versions: live.versions.length }).toEqual({
      liveHash: 'e40065d9dff0',
      text: 'Review risk first.',
      versions: 2
    })
  })
})

describe('reconcile', () => {
  it('adds a changed shipped prompt as a built-in version without moving live, and converges when run again', async () => {
    const custom = setLive((await saveVersion(seeded, 'Review risk first.', LATER)).library, 'e40065d9dff0')
    const shipped = 'You write guided code reviews, risk first.'
    const once = await reconcile(custom, shipped, LATER)
    const twice = await reconcile(once, shipped, '2026-10-09T00:00:00.000Z')
    expect({
      liveHash: once.liveHash,
      added: once.versions.at(-1),
      hashes: once.versions.map((v) => v.hash),
      converged: twice === once
    }).toEqual({
      liveHash: 'e40065d9dff0',
      added: { hash: 'e6945cfbcd0b', name: null, text: shipped, createdAt: LATER, builtIn: true },
      hashes: ['d1a090fa9228', 'e40065d9dff0', 'e6945cfbcd0b'],
      converged: true
    })
  })

  it('leaves the library alone when the shipped prompt is unchanged', async () => {
    expect(await reconcile(seeded, `${BUILT_IN}\n`, LATER)).toBe(seeded)
  })
})

describe('promptHash', () => {
  it('hashes the normalised text to the first 12 hex characters of its sha256', async () => {
    expect([await promptHash('Review risk first.'), await promptHash('Review risk first. \n\n')]).toEqual(['e40065d9dff0', 'e40065d9dff0'])
  })
})
