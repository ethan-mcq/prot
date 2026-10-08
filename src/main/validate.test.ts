import { describe, expect, it } from 'vitest'
import { parseChatRequest, parsePromptKind } from './validate'

const context = { pull: null, story: null, step: null, chapter: null, flow: null, file: null, section: null, selection: null }
const request = (extra: Record<string, unknown>) => ({ id: 'c1', messages: [{ role: 'user', content: 'Why?' }], context, ...extra })

describe('parseChatRequest promptHash', () => {
  it.each([
    ['absent', {}, undefined],
    ['12 hex characters', { promptHash: '18b4da50330c' }, '18b4da50330c']
  ])('accepts a hash that is %s', (_case, extra, hash) => {
    expect(parseChatRequest(request(extra)).promptHash).toBe(hash)
  })

  it.each([[{ promptHash: '18B4DA50330C' }], [{ promptHash: '18b4da' }], [{ promptHash: null }]])('rejects %j', (extra) => {
    expect(() => parseChatRequest(request(extra))).toThrow(/prompt hash/)
  })
})

describe('parsePromptKind', () => {
  it.each([
    ['guide', 'guide'],
    ['chat', 'chat']
  ])('accepts %s', (raw, kind) => {
    expect(parsePromptKind(raw)).toBe(kind)
  })

  it('rejects any other kind', () => {
    expect(() => parsePromptKind('review')).toThrow('Prompt kind must be one of guide, chat')
  })
})
