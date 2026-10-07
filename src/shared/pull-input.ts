import type { PullRef, PullSummary } from './types'

export type RepoRef = { owner: string; repo: string }

export type PullInput = { ref: PullRef } | { error: string }

const NAME = '[A-Za-z0-9._-]+'
const SHORT = new RegExp(`^(${NAME})/(${NAME})(?:#|/pull/)(\\d+)$`)
const SHORT_ISSUE = new RegExp(`^${NAME}/${NAME}/issues/\\d+$`)
const BARE = /^#?(\d+)$/
const SEGMENT = new RegExp(`^${NAME}$`)

const FORMS = 'Use a PR link, owner/repo#123 or #123'
const ISSUE = "That's an issue link, not a pull request"
const NOT_A_PULL = "That link doesn't point to a pull request"

function pullRef(owner: string, repo: string, digits: string): PullInput {
  const number = Number(digits)
  if (!Number.isSafeInteger(number) || number < 1) return { error: 'Pull request numbers start at 1' }
  return { ref: { owner, repo, number } }
}

function fromUrl(text: string): PullInput {
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return { error: FORMS }
  }
  const [owner = '', repo = '', kind = '', digits = ''] = url.pathname.split('/').filter((part) => part !== '')
  if (!SEGMENT.test(owner) || !SEGMENT.test(repo) || !/^\d+$/.test(digits)) return { error: NOT_A_PULL }
  if (kind === 'issues') return { error: ISSUE }
  if (kind !== 'pull') return { error: NOT_A_PULL }
  return pullRef(owner, repo, digits)
}

export function parsePullInput(text: string, fallbackRepo: RepoRef | null): PullInput {
  const input = text.trim()
  if (input === '') return { error: FORMS }
  if (/^https?:\/\//i.test(input)) return fromUrl(input)

  const short = SHORT.exec(input)
  if (short) return pullRef(short[1] as string, short[2] as string, short[3] as string)
  if (SHORT_ISSUE.test(input)) return { error: ISSUE }

  const bare = BARE.exec(input)
  if (!bare) return { error: FORMS }
  if (!fallbackRepo) return { error: 'Include the repo, e.g. owner/repo#123' }
  return pullRef(fallbackRepo.owner, fallbackRepo.repo, bare[1] as string)
}

// A bare #123 means the repo on screen, else the repo the user touched most recently.
export function fallbackRepo(open: PullRef | null, pulls: PullSummary[]): RepoRef | null {
  if (open) return { owner: open.owner, repo: open.repo }
  let latest: PullSummary | null = null
  for (const pull of pulls) {
    if (!latest || pull.updatedAt > latest.updatedAt) latest = pull
  }
  return latest && { owner: latest.ref.owner, repo: latest.ref.repo }
}
