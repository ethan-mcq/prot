// Pull requests in a repo the viewer is not asked to review, reachable only by checking them out.
const OWNER = 'octo-labs'
const REPO = 'tools'
const BASE_SHA = '5e1d0c9b8a7f6e5d4c3b2a190807f6e5d4c3b2a1'
const PATH = 'tools/fetch.py'

const mira = { login: 'mira', avatar_url: 'https://avatars.githubusercontent.com/u/4?v=4' }

const base = `import time

import requests


def fetch(url: str, timeout: float = 10.0) -> bytes:
    response = requests.get(url, timeout=timeout)
    response.raise_for_status()
    return response.content
`

const head = `import time

import requests

RETRYABLE = {502, 503, 504}


def fetch(url: str, timeout: float = 10.0, attempts: int = 3) -> bytes:
    for attempt in range(1, attempts + 1):
        response = requests.get(url, timeout=timeout)
        if response.status_code not in RETRYABLE or attempt == attempts:
            response.raise_for_status()
            return response.content
        time.sleep(2 ** attempt)
    raise RuntimeError("unreachable")
`

const patch = [
  '@@ -2,8 +2,14 @@',
  ' ',
  ' import requests',
  ' ',
  '+RETRYABLE = {502, 503, 504}',
  ' ',
  '-def fetch(url: str, timeout: float = 10.0) -> bytes:',
  '-    response = requests.get(url, timeout=timeout)',
  '-    response.raise_for_status()',
  '-    return response.content',
  '+',
  '+def fetch(url: str, timeout: float = 10.0, attempts: int = 3) -> bytes:',
  '+    for attempt in range(1, attempts + 1):',
  '+        response = requests.get(url, timeout=timeout)',
  '+        if response.status_code not in RETRYABLE or attempt == attempts:',
  '+            response.raise_for_status()',
  '+            return response.content',
  '+        time.sleep(2 ** attempt)',
  '+    raise RuntimeError("unreachable")'
].join('\n')

type ToolsPull = {
  number: number
  title: string
  headSha: string
  head: string
  merged: boolean
  createdAt: string
  updatedAt: string
}

export const toolsPulls: ToolsPull[] = [
  {
    number: 42,
    title: 'Retry flaky downloads in the fetch helper',
    headSha: 'a7c3e1f09b2d4c6e8a0b1c3d5e7f9a1b3c5d7e9f',
    head: 'mira/fetch-retry',
    merged: false,
    createdAt: '2026-10-04T15:00:00Z',
    updatedAt: '2026-10-06T16:20:00Z'
  },
  {
    number: 40,
    title: 'Pin requests below 3',
    headSha: 'b8d4f2a1c0e3b5d7f9a2c4e6b8d0f2a4c6e8b0d2',
    head: 'mira/pin-requests',
    merged: true,
    createdAt: '2026-09-28T10:00:00Z',
    updatedAt: '2026-09-30T12:00:00Z'
  }
]

export const toolsPath = `/repos/${OWNER}/${REPO}`

export function toolsPull(number: number): ToolsPull | null {
  return toolsPulls.find((pull) => pull.number === number) ?? null
}

export function toolsDetail(pull: ToolsPull) {
  return {
    number: pull.number,
    state: pull.merged ? 'closed' : 'open',
    merged_at: pull.merged ? pull.updatedAt : null,
    title: pull.title,
    body: 'Downloads from the artifact mirror fail on transient 502s. Retry gateway errors with backoff.',
    user: mira,
    html_url: `https://github.com/${OWNER}/${REPO}/pull/${pull.number}`,
    draft: false,
    created_at: pull.createdAt,
    updated_at: pull.updatedAt,
    comments: 0,
    labels: [],
    additions: 11,
    deletions: 4,
    changed_files: 1,
    base: { ref: 'main', sha: BASE_SHA, repo: { full_name: `${OWNER}/${REPO}`, default_branch: 'main' } },
    head: { ref: pull.head, sha: pull.headSha, repo: { full_name: `${OWNER}/${REPO}` } }
  }
}

export const toolsFiles = [{ filename: PATH, status: 'modified', additions: 11, deletions: 4, changes: 15, patch }]

export function toolsContent(path: string, ref: string | null): string | null {
  if (path !== PATH) return null
  return ref === BASE_SHA ? base : head
}

export function toolsTree(): string[] {
  return [PATH, 'tools/__init__.py', 'README.md', 'pyproject.toml']
}

export function toolsNode(pull: ToolsPull) {
  return {
    __typename: 'PullRequest',
    number: pull.number,
    title: pull.title,
    url: `https://github.com/${OWNER}/${REPO}/pull/${pull.number}`,
    isDraft: false,
    state: pull.merged ? 'MERGED' : 'OPEN',
    createdAt: pull.createdAt,
    updatedAt: pull.updatedAt,
    baseRefName: 'main',
    headRefName: pull.head,
    isCrossRepository: false,
    repository: { nameWithOwner: `${OWNER}/${REPO}`, defaultBranchRef: { name: 'main' } },
    author: { login: mira.login, avatarUrl: mira.avatar_url },
    comments: { totalCount: 0 },
    labels: { nodes: [] }
  }
}
