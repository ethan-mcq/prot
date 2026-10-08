import { describe, expect, it } from 'vitest'
import type { ChangedFile, Guide } from '../types'
import { capyStoryIndex, capyStoryPull, changed, pullWith, STORY } from './fixtures'
import { firstSentence } from './ai'
import { buildGuidePrompt, buildStoryGuide, GUIDE_SCHEMA, parseAiGuide } from './index'

const story = buildStoryGuide(capyStoryPull, capyStoryIndex)
const PROMPT_HASH = 'd1a090fa9228'
const sym = (path: string, name: string) => `${path}#${name}`

function outline(guide: Guide): string[] {
  return guide.chapters.map((chapter) => {
    const cards = chapter.cards.map((card) => `${card.role} ${guide.symbols[card.symbolId]?.qualifiedName}`)
    return [chapter.title, ...(cards.length > 0 ? cards : chapter.files)].join(' | ')
  })
}

describe('firstSentence', () => {
  it.each([
    ['Adds retries to the uploader. It also logs failures.', 'Adds retries to the uploader.'],
    ['Moves parsing into parse.ts so the CLI and MainActivity.onNewIntent share it.', 'Moves parsing into parse.ts so the CLI and MainActivity.onNewIntent share it.'],
    ['Bumps v1.2 to v1.3. Nothing else changes!', 'Bumps v1.2 to v1.3.'],
    ['Does this break callers? "Yes" if they pass null.', 'Does this break callers?'],
    ['One clause and no stop', 'One clause and no stop']
  ])('%j keeps %j', (text, first) => {
    expect(firstSentence(text)).toBe(first)
  })
})

describe('parseAiGuide', () => {
  const raw = {
    overview: { risk: { level: 'severe', reason: 'Made up.' }, synopsis: '  Shares items from other apps into a thread. It adds a native module. ' },
    caption: 'How a shared item reaches a thread',
    sections: [
      {
        title: 'Native share intake',
        summary: 'The activity hands the intent to the module.',
        symbols: [
          sym(STORY.activity, 'MainActivity.onNewIntent'),
          sym(STORY.module, 'CapyShareModule.takeShare'),
          'ghost.kt#Nope',
          sym(STORY.module, 'CapyShareModule.takeShare')
        ]
      },
      {
        title: 'Message cleanup',
        summary: 'Whitespace collapses before sending.',
        symbols: [sym(STORY.store, 'normalizeText'), sym(STORY.module, 'CapyShareModule.takeShare')]
      },
      { title: 'Invented', summary: '', symbols: ['nope.ts#nothing'] }
    ],
    files: [{ title: 'App config', summary: 'Registers the share plugin.', files: [STORY.config, 'ghost.json'] }]
  }

  it('drops unknown ids, keeps each changed symbol once, brings entries along, and re-appends missed symbols where the story put them', () => {
    const guide = parseAiGuide(raw, capyStoryPull, story, PROMPT_HASH)
    expect({ source: guide.source, headSha: guide.headSha, outline: outline(guide) }).toEqual({
      source: 'ai',
      headSha: 'head123',
      outline: [
        [
          'Native share intake',
          'entry MainActivity.onNewIntent',
          'step CapyShareModule.takeShare',
          'step CapyShareModule',
          'helper CapyShareModule.stageItems',
          'helper CapyShareModule.readUris',
          'helper SharedItem',
          'helper CapyShareModule.mimeOf',
          'helper ShareInbox',
          'helper ShareInbox.push',
          'data MAX_SHARE_ITEMS',
          'data (module)',
          'data (module)',
          'data (module)',
          'test CapyShareModuleTest',
          'test CapyShareModuleTest › stagesEveryUri',
          'test (module)'
        ].join(' | '),
        'Message cleanup | entry appendMessage | step normalizeText | data MAX_MESSAGE_LENGTH',
        [
          'New ShareInbox and what it calls',
          'entry ShareInbox',
          'step useSharedItems',
          'step ShareSheet',
          'helper useShareSend',
          'data CapyShare',
          'data NativeSharedItem',
          'data CapyShareModule',
          'data (module)',
          'data (module)',
          'data (module)',
          'data (module)',
          'test uploads every shared item',
          'test (module)'
        ].join(' | '),
        'Other tests | test formats today | test (module)',
        `App config | ${STORY.config}`
      ]
    })
    const shown = guide.chapters.flatMap((chapter) => chapter.cards).filter((card) => guide.symbols[card.symbolId]?.change !== 'context')
    expect({ shown: shown.length, distinct: new Set(shown.map((card) => card.symbolId)).size }).toEqual({ shown: 33, distinct: 33 })
  })

  it('keeps a known risk level and falls back to the estimated risk for an unknown one', () => {
    const unknown = parseAiGuide(raw, capyStoryPull, story, PROMPT_HASH).overview
    const known = parseAiGuide(
      { ...raw, overview: { ...raw.overview, risk: { level: 'high', reason: 'Every share now goes through takeShare.' } } },
      capyStoryPull,
      story,
      PROMPT_HASH
    ).overview
    expect({ unknown, known: known.risk }).toEqual({
      unknown: { risk: story.overview.risk, synopsis: 'Shares items from other apps into a thread.' },
      known: { level: 'high', reason: 'Every share now goes through takeShare.' }
    })
  })

  it('keeps up to 5 unique questions under 160 characters and falls back to the story questions when fewer than 3 survive', () => {
    const asked = [
      '  Can any app send an ACTION_SEND intent that CapyShareModule.takeShare stages?  ',
      '',
      42,
      'Can any app send an ACTION_SEND intent that CapyShareModule.takeShare stages?',
      `Does ShareInbox.push ${'really '.repeat(30)}hold up?`,
      'What happens when ShareInbox.push runs from two intents at once?',
      'Which test covers normalizeText cutting at MAX_MESSAGE_LENGTH?',
      'Does appendMessage still send text longer than MAX_MESSAGE_LENGTH?',
      'Who reads CapyShare.takeShare when the native module is missing?',
      'Is a sixth question ever kept?'
    ]
    const kept = parseAiGuide({ ...raw, questions: asked }, capyStoryPull, story, PROMPT_HASH).questions
    const fallback = parseAiGuide({ ...raw, questions: ['What is this PR about?', 'What is this PR about?', ''] }, capyStoryPull, story, PROMPT_HASH).questions
    expect({ kept, fallback }).toEqual({
      kept: [
        'Can any app send an ACTION_SEND intent that CapyShareModule.takeShare stages?',
        'What happens when ShareInbox.push runs from two intents at once?',
        'Which test covers normalizeText cutting at MAX_MESSAGE_LENGTH?',
        'Does appendMessage still send text longer than MAX_MESSAGE_LENGTH?',
        'Who reads CapyShare.takeShare when the native module is missing?'
      ],
      fallback: [
        'What else calls normalizeText, and does the change to it break them?',
        'Who can call MainActivity.onNewIntent, and does CapyShareModule.takeShare change what it returns or who is allowed?',
        'What covers normalizeText now that it has no tests in this PR?',
        'Who can call appendMessage, and does normalizeText change what it returns or who is allowed?'
      ]
    })
  })

  it.each([
    [null, /not a JSON object/],
    ['{"overview": ', /not valid JSON/],
    [{ sections: [] }, /missing the overview/],
    [{ overview: { synopsis: 'x' }, sections: 'all of them' }, /sections array/],
    [{ overview: { risk: { level: 'low', reason: 'r' } }, sections: [] }, /overview\.synopsis/],
    [{ overview: { synopsis: 'x' }, sections: [{ title: 'Made up', symbols: ['nope.ts#x'] }] }, /none of the changed symbols/]
  ])('rejects unusable output %#', (input, message) => {
    expect(() => parseAiGuide(input, capyStoryPull, story, PROMPT_HASH)).toThrow(message)
  })
})

describe('GUIDE_SCHEMA', () => {
  it('closes every object and requires all of its properties, as structured outputs demand', () => {
    const problems: string[] = []
    const visit = (schema: unknown, at: string): void => {
      if (typeof schema !== 'object' || schema === null) return
      const node = schema as Record<string, unknown>
      if (node.type === 'object') {
        const keys = Object.keys((node.properties ?? {}) as Record<string, unknown>).sort()
        const required = [...((node.required ?? []) as string[])].sort()
        if (node.additionalProperties !== false) problems.push(`${at} allows extra properties`)
        if (JSON.stringify(keys) !== JSON.stringify(required)) problems.push(`${at} does not require every property`)
      }
      for (const [key, value] of Object.entries(node)) {
        if (Array.isArray(value)) value.forEach((item, index) => visit(item, `${at}.${key}[${index}]`))
        else visit(value, `${at}.${key}`)
      }
    }
    visit(GUIDE_SCHEMA, 'schema')

    expect(problems).toEqual([])
  })
})

describe('buildGuidePrompt', () => {
  it('sends the story and its code with diff markers, and never the PR title or description', () => {
    const { system, user } = buildGuidePrompt(capyStoryPull, story, {}, 'You write guided code reviews.')
    const sent = `${system}\n${user}`
    expect({
      title: sent.includes('Share to Capy from other apps'),
      body: sent.includes('straight into a Capy thread'),
      card: user.includes(`- ${sym(STORY.store, 'normalizeText')} (function, modified, step, lines 9-11)`),
      code: user.includes('-  return text.trim();\n+  return text.replace(')
    }).toEqual({ title: false, body: false, card: true, code: true })
  })

  it('fits code into the budget core-first and still lists every file', () => {
    const files: ChangedFile[] = []
    for (let n = 0; n < 10; n++) {
      const lines = ['@@ -0,0 +1,2000 @@']
      for (let line = 0; line < 2000; line++) lines.push(`+export const value${n}_${line} = ${line}`)
      files.push(changed(`src/core${n}.ts`, 'added', lines))
    }
    files.push(changed('package-lock.json', 'modified', ['@@ -1,1 +1,1 @@', '-"a": 1', '+"a": 2']))
    files.push({ ...changed('assets/logo.png', 'added', []), patch: null })
    const detail = pullWith(files)
    const { user } = buildGuidePrompt(detail, buildStoryGuide(detail, { headSha: 'head123', symbols: [], skipped: [] }), {}, 'You write guided code reviews.')

    expect(user.length).toBeLessThan(185_000)
    for (const file of files) expect(user).toContain(file.path)
    expect(user).toContain('<patch path="src/core0.ts">')
    expect(user).toContain('[truncated, ')
    expect(user).not.toContain('<patch path="package-lock.json">')
    expect(user).not.toContain('<patch path="assets/logo.png">')
  })
})
