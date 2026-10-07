import { describe, expect, it } from 'vitest'
import {
  buildInboxView,
  changedFilterCount,
  DEFAULT_FILTERS,
  parseFilters,
  toggleAuthor,
  type InboxFilters,
  type InboxView
} from './inbox'
import type { PullBucket, PullSummary } from './types'

const NOW = Date.parse('2026-10-07T12:00:00Z')

function pr(
  number: number,
  bucket: PullBucket,
  fields: { author: string; draft?: boolean; created: string; updated: string; base: string; head: string | null }
): PullSummary {
  return {
    ref: { owner: 'acme', repo: 'prot', number },
    title: `PR ${number}`,
    author: { login: fields.author, avatarUrl: '' },
    url: '',
    draft: fields.draft ?? false,
    createdAt: `${fields.created}T09:00:00Z`,
    updatedAt: `${fields.updated}T09:00:00Z`,
    bucket,
    state: 'open',
    comments: 0,
    labels: [],
    baseRef: fields.base,
    headRef: fields.head
  }
}

const PULLS: PullSummary[] = [
  pr(12, 'review', { author: 'kai', created: '2026-10-05', updated: '2026-10-06', base: 'main', head: 'kai/fix' }),
  pr(13, 'review', { author: 'lin', draft: true, created: '2026-10-01', updated: '2026-10-03', base: 'main', head: 'lin/wip' }),
  pr(14, 'review', { author: 'kai', created: '2026-10-04', updated: '2026-10-05', base: 'me/c', head: 'kai/on-c' }),
  pr(20, 'mine', { author: 'me', created: '2026-09-29', updated: '2026-10-04', base: 'main', head: 'me/a' }),
  pr(21, 'mine', { author: 'me', created: '2026-10-01', updated: '2026-10-06', base: 'me/a', head: 'me/b' }),
  pr(22, 'mine', { author: 'me', draft: true, created: '2026-10-02', updated: '2026-10-02', base: 'me/b', head: 'me/c' }),
  pr(7, 'mine', { author: 'me', created: '2026-10-04', updated: '2026-10-05', base: 'main', head: 'me/dark' }),
  pr(3, 'mine', { author: 'me', created: '2026-07-01', updated: '2026-08-20', base: 'main', head: 'me/sign' }),
  pr(30, 'mine', { author: 'me', draft: true, created: '2026-08-15', updated: '2026-10-01', base: 'main', head: 'me/keys' }),
  pr(40, 'manual', { author: 'zed', created: '2026-09-20', updated: '2026-10-02', base: 'main', head: 'zed/x' }),
  pr(41, 'manual', { author: 'zed', draft: true, created: '2026-10-03', updated: '2026-10-03', base: 'zed/x', head: 'zed/y' }),
  // Checked out by hand, then requested for review: it belongs to review.
  pr(12, 'manual', { author: 'kai', created: '2026-10-05', updated: '2026-10-06', base: 'main', head: 'kai/fix' })
]

// One line per group. A stack is `stack #root >#child >>#grandchild`; `(on #n)` marks a parent not drawn above.
function outline(view: InboxView): string[] {
  const lines: string[] = []
  for (const bucket of ['review', 'mine', 'manual'] as const) {
    for (const group of view[bucket].groups) {
      const units: string[] = []
      for (const unit of group.units) {
        const members: string[] = []
        for (const member of unit.members) {
          const on = member.stackedOn === null ? '' : `(on #${member.stackedOn})`
          members.push(`${'>'.repeat(member.depth)}#${member.pull.ref.number}${on}`)
        }
        units.push(unit.members.length > 1 ? `stack ${members.join(' ')}` : members.join(' '))
      }
      lines.push(`${group.key}: ${units.join(', ')}`)
    }
  }
  return lines
}

describe('buildInboxView', () => {
  it.each<[string, Partial<InboxFilters>, string[]]>([
    [
      'defaults show everything: open before drafts, stacks root first and placed by their root, a PR once in its first section',
      {},
      [
        'review/open: #12, #14(on #22)',
        'review/drafts: #13',
        'mine/open: stack #20 >#21 >>#22, #7, #3',
        'mine/drafts: #30',
        'manual/open: stack #40 >#41'
      ]
    ],
    [
      'an explicit author list hides authors not on it',
      { authors: ['kai', 'me'] },
      ['review/open: #12, #14(on #22)', 'mine/open: stack #20 >#21 >>#22, #7, #3', 'mine/drafts: #30']
    ],
    [
      'opened within 7 days hides older PRs and marks the hidden stack parent',
      { opened: '7d' },
      ['review/open: #12, #14(on #22)', 'review/drafts: #13', 'mine/open: stack #21(on #20) >#22, #7', 'manual/drafts: #41(on #40)']
    ],
    [
      'opened within 30 days',
      { opened: '30d' },
      ['review/open: #12, #14(on #22)', 'review/drafts: #13', 'mine/open: stack #20 >#21 >>#22, #7', 'manual/open: stack #40 >#41']
    ],
    [
      'opened within 90 days',
      { opened: '90d' },
      [
        'review/open: #12, #14(on #22)',
        'review/drafts: #13',
        'mine/open: stack #20 >#21 >>#22, #7',
        'mine/drafts: #30',
        'manual/open: stack #40 >#41'
      ]
    ],
    [
      'hiding drafts drops drafts groups and draft stack members',
      { showDrafts: false },
      ['review/open: #12, #14(on #22)', 'mine/open: stack #20 >#21, #7, #3', 'manual/open: #40']
    ],
    [
      'ungrouped stacks are flat and each PR sits in its own state group',
      { groupStacks: false },
      [
        'review/open: #12, #14(on #22)',
        'review/drafts: #13',
        'mine/open: #21(on #20), #7, #20, #3',
        'mine/drafts: #22(on #21), #30',
        'manual/open: #40',
        'manual/drafts: #41(on #40)'
      ]
    ]
  ])('%s', (_name, filters, expected) => {
    expect(outline(buildInboxView(PULLS, { ...DEFAULT_FILTERS, ...filters }, NOW))).toEqual(expected)
  })

  it('counts filtered PRs against the unfiltered total per section', () => {
    const view = buildInboxView(PULLS, { ...DEFAULT_FILTERS, opened: '7d' }, NOW)
    expect({
      review: [view.review.shown, view.review.total],
      mine: [view.mine.shown, view.mine.total],
      manual: [view.manual.shown, view.manual.total]
    }).toEqual({
      review: [3, 3],
      mine: [3, 6],
      manual: [1, 2]
    })
  })

  it('places a stack whose root is a draft in the drafts group', () => {
    const pulls = [
      pr(40, 'mine', { author: 'me', draft: true, created: '2026-10-01', updated: '2026-10-01', base: 'main', head: 'me/x' }),
      pr(41, 'mine', { author: 'me', created: '2026-10-01', updated: '2026-10-02', base: 'me/x', head: 'me/y' })
    ]
    expect(outline(buildInboxView(pulls, DEFAULT_FILTERS, NOW))).toEqual(['mine/drafts: stack #40 >#41'])
  })

  it('nests a branching stack by depth and never links through a head that cannot carry a stack', () => {
    const pulls = [
      pr(50, 'mine', { author: 'me', created: '2026-10-01', updated: '2026-10-01', base: 'main', head: 'me/root' }),
      pr(52, 'mine', { author: 'me', created: '2026-10-01', updated: '2026-10-01', base: 'me/root', head: 'me/right' }),
      pr(51, 'mine', { author: 'me', created: '2026-10-01', updated: '2026-10-01', base: 'me/root', head: 'me/left' }),
      pr(53, 'mine', { author: 'me', created: '2026-10-01', updated: '2026-10-01', base: 'me/left', head: 'me/top' }),
      pr(60, 'mine', { author: 'me', created: '2026-10-01', updated: '2026-10-01', base: 'release', head: null }),
      pr(61, 'mine', { author: 'me', created: '2026-10-01', updated: '2026-10-01', base: 'main', head: 'me/other' })
    ]
    expect(outline(buildInboxView(pulls, DEFAULT_FILTERS, NOW))).toEqual(['mine/open: stack #50 >#51 >>#53 >#52, #60, #61'])
  })

  it('terminates on a cycle and shows each PR once', () => {
    const pulls = [
      pr(1, 'mine', { author: 'me', created: '2026-10-01', updated: '2026-10-01', base: 'me/b', head: 'me/a' }),
      pr(2, 'mine', { author: 'me', created: '2026-10-01', updated: '2026-10-01', base: 'me/a', head: 'me/b' })
    ]
    expect(outline(buildInboxView(pulls, DEFAULT_FILTERS, NOW))).toEqual(['mine/open: stack #1(on #2) >#2'])
  })
})

describe('author filter', () => {
  it('unticking from all keeps every other current author and hides a newly appearing one', () => {
    const filters = toggleAuthor(DEFAULT_FILTERS, 'lin', ['kai', 'lin', 'me'])
    const withNewcomer = [
      ...PULLS,
      pr(15, 'review', { author: 'zoe', created: '2026-10-06', updated: '2026-10-07', base: 'main', head: 'zoe/x' })
    ]
    expect({
      authors: filters.authors,
      changed: changedFilterCount(filters),
      review: outline(buildInboxView(withNewcomer, filters, NOW)).filter((line) => line.startsWith('review'))
    }).toEqual({ authors: ['kai', 'me'], changed: 1, review: ['review/open: #12, #14(on #22)'] })
  })

  it('ticking an author back adds them to the explicit list', () => {
    expect(toggleAuthor({ ...DEFAULT_FILTERS, authors: ['kai'] }, 'zoe', ['kai', 'zoe']).authors).toEqual(['kai', 'zoe'])
  })
})

describe('parseFilters', () => {
  it.each<[string, unknown, InboxFilters]>([
    ['garbage falls back to defaults', 'nope', DEFAULT_FILTERS],
    [
      'valid fields survive and invalid ones reset',
      { authors: ['kai'], opened: '30d', showDrafts: 'no', groupStacks: false },
      { authors: ['kai'], opened: '30d', showDrafts: true, groupStacks: false }
    ],
    ['a non-string author list resets to all', { authors: [1], opened: '1y' }, DEFAULT_FILTERS]
  ])('%s', (_name, raw, expected) => {
    expect(parseFilters(raw)).toEqual(expected)
  })
})
