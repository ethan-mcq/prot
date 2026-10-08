import { describe, expect, it } from 'vitest'
import type { Guide, PullDetail, RiskLevel } from '../types'
import { added, capySharePull, capyStoryIndex, capyStoryPull, changed, codeSymbol, pullWith } from './fixtures'
import { buildHeuristicGuide, buildStoryGuide } from './index'
import { assessRisk } from './overview'
import { reviewFiles } from './files'

const core = (n: number) => Array.from({ length: n }, (_, i) => `export const v${i} = ${i}`)

// The guide keeps only the level; the reason names the rule that set it.
function risk(detail: PullDetail, guide: Guide): { level: RiskLevel; reason: string; shown: RiskLevel } {
  return { ...assessRisk({ files: reviewFiles(detail.files), chapters: guide.chapters, symbols: guide.symbols }), shown: guide.overview.risk }
}

function heuristic(detail: PullDetail) {
  return risk(detail, buildHeuristicGuide(detail))
}

describe('estimated risk', () => {
  it.each<{ name: string; risk: () => ReturnType<typeof risk>; expected: { level: RiskLevel; reason: string } }>([
    {
      name: 'high when a migration changes stored data',
      risk: () => heuristic(pullWith([added('db/migrations/0042_shares.sql', ['create table shares (id int);']), added('src/a.test.ts', ['test'])])),
      expected: { level: 'high', reason: 'Changes stored data through 0042_shares.sql, so check it is safe to run and to roll back.' }
    },
    {
      name: 'high when a changed symbol has callers in several sections',
      risk: () => {
        const shared = codeSymbol('src/text.ts', 'clean', { kind: 'function', change: 'modified', head: [1, 3], base: [1, 3] })
        const a = codeSymbol('src/a.ts', 'sendA', { kind: 'function', change: 'added', head: [1, 3], calls: [shared.id] })
        const b = codeSymbol('src/b.ts', 'sendB', { kind: 'function', change: 'added', head: [1, 3], calls: [shared.id] })
        const detail = pullWith(['src/text.ts', 'src/a.ts', 'src/b.ts'].map((path) => changed(path, 'modified', ['@@ -1 +1 @@', '-a', '+b'])))
        return risk(detail, buildStoryGuide(detail, { headSha: 'head123', symbols: [shared, a, b], skipped: [] }))
      },
      expected: { level: 'high', reason: 'Changes clean, which callers in 2 sections depend on (New sendA and what it calls and New sendB).' }
    },
    {
      name: 'high past 800 changed lines of core code',
      risk: () => heuristic(pullWith([added('src/big.ts', core(801)), added('src/big.test.ts', ['test'])])),
      expected: { level: 'high', reason: 'Changes 801 lines of core code in one pull request.' }
    },
    {
      name: 'medium when a story section changes core code with no tests attached',
      risk: () => risk(capyStoryPull, buildStoryGuide(capyStoryPull, capyStoryIndex)),
      expected: { level: 'medium', reason: 'No tests cover the section "normalizeText enters through appendMessage", which changes core code.' }
    },
    {
      name: 'medium past 300 changed lines',
      risk: () => heuristic(pullWith([added('src/mid.ts', core(301)), added('src/mid.test.ts', ['test'])])),
      expected: { level: 'medium', reason: 'Changes 302 lines, which is a lot to hold in one review.' }
    },
    {
      name: 'low for a small change with tests beside the core code',
      risk: () => heuristic(pullWith([added('src/send.ts', core(3)), added('src/send.test.ts', ['test'])])),
      expected: { level: 'low', reason: '4 changed lines, no schema change, and tests sit beside the core code.' }
    }
  ])('$name', ({ risk, expected }) => {
    expect(risk()).toEqual({ ...expected, shown: expected.level })
  })
})

describe('goal', () => {
  it('is one sentence that describes the code, never the PR description', () => {
    const story = buildStoryGuide(capyStoryPull, capyStoryIndex).overview.goal
    const quick = buildHeuristicGuide(capySharePull).overview.goal
    expect({ story, quick }).toEqual({
      story: 'It adds 18 symbols and changes 2 across 4 sections, entered through MainActivity.onNewIntent.',
      quick: 'It changes 13 files (+165 -2) in 8 chapters, mostly capy share module in modules/capy-share.'
    })
  })
})
