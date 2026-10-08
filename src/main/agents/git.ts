import { execFile } from 'node:child_process'
import { open } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { AgentChanges, AgentFileChange, AgentFileStatus } from '@shared/agents'

const GIT_TIMEOUT_MS = 20_000
const MAX_BUFFER = 64 * 1024 * 1024
const UNTRACKED_MAX = 500
const UNTRACKED_BYTES = 2 * 1024 * 1024
export const DIFF_MAX = 1024 * 1024

export class GitError extends Error {}

function git(cwd: string, args: string[], okCodes: number[] = [0]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      { cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: MAX_BUFFER, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' } },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === 'number' ? error.code : -1) : 0
        if (okCodes.includes(code)) resolve(String(stdout))
        else reject(new GitError(String(stderr).trim() || (error?.message ?? `git exited with ${code}`)))
      }
    )
  })
}

async function gitOrNull(cwd: string, args: string[]): Promise<string | null> {
  try {
    return (await git(cwd, args)).trim()
  } catch {
    return null
  }
}

export async function repoRoot(path: string): Promise<string | null> {
  if (!isAbsolute(path)) return null
  const root = await gitOrNull(path, ['rev-parse', '--show-toplevel'])
  return root && root !== '' ? root : null
}

export async function currentBranch(cwd: string): Promise<string | null> {
  const branch = await gitOrNull(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
  return branch && branch !== 'HEAD' ? branch : null
}

export async function headSha(cwd: string): Promise<string | null> {
  return gitOrNull(cwd, ['rev-parse', 'HEAD'])
}

export async function addWorktree(repo: string, path: string, branch: string): Promise<void> {
  await git(repo, ['worktree', 'add', '-b', branch, path, 'HEAD'])
}

export async function removeWorktree(repo: string, path: string): Promise<void> {
  await git(repo, ['worktree', 'remove', '--force', path])
}

async function refExists(cwd: string, ref: string): Promise<boolean> {
  return (await gitOrNull(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])) !== null
}

// origin's default branch (origin/HEAD), else the first of origin/main, origin/master, main, master that exists.
export async function defaultBase(cwd: string): Promise<string | null> {
  const head = await gitOrNull(cwd, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])
  if (head) return head
  for (const ref of ['origin/main', 'origin/master', 'main', 'master']) {
    if (await refExists(cwd, ref)) return ref
  }
  return null
}

export async function mergeBase(cwd: string, base: string): Promise<string | null> {
  return gitOrNull(cwd, ['merge-base', 'HEAD', base])
}

// The commit the agent's changes are measured from: the merge base with base, else HEAD.
export async function diffBase(cwd: string, base: string | null): Promise<string | null> {
  const target = base ?? (await defaultBase(cwd))
  if (target) {
    const sha = await mergeBase(cwd, target)
    if (sha) return sha
  }
  return headSha(cwd)
}

type RawChange = { path: string; oldPath: string | null; status: AgentFileStatus; additions: number; deletions: number }

function statusOf(code: string): AgentFileStatus {
  if (code.startsWith('A')) return 'added'
  if (code.startsWith('D')) return 'removed'
  if (code.startsWith('R')) return 'renamed'
  return 'modified'
}

// `git diff --name-status -z -M`: "M\0path\0" or "R100\0old\0new\0".
export function parseNameStatus(text: string): Map<string, { status: AgentFileStatus; oldPath: string | null }> {
  const out = new Map<string, { status: AgentFileStatus; oldPath: string | null }>()
  const parts = text.split('\0')
  let i = 0
  while (i < parts.length) {
    const code = parts[i]
    if (!code) {
      i++
      continue
    }
    if (code.startsWith('R') || code.startsWith('C')) {
      const oldPath = parts[i + 1] ?? ''
      const path = parts[i + 2] ?? ''
      out.set(path, { status: code.startsWith('R') ? 'renamed' : 'added', oldPath })
      i += 3
    } else {
      out.set(parts[i + 1] ?? '', { status: statusOf(code), oldPath: null })
      i += 2
    }
  }
  return out
}

// `git diff --numstat -z -M`: "a\td\tpath\0" or, for a rename, "a\td\t\0old\0new\0". Binary files show "-".
export function parseNumstat(text: string): Map<string, { additions: number; deletions: number }> {
  const out = new Map<string, { additions: number; deletions: number }>()
  const parts = text.split('\0')
  let i = 0
  while (i < parts.length) {
    const head = parts[i]
    if (!head) {
      i++
      continue
    }
    const fields = head.split('\t')
    const additions = Number(fields[0])
    const deletions = Number(fields[1])
    let path = fields.slice(2).join('\t')
    let step = 1
    if (path === '') {
      path = parts[i + 2] ?? ''
      step = 3
    }
    out.set(path, {
      additions: Number.isFinite(additions) ? additions : 0,
      deletions: Number.isFinite(deletions) ? deletions : 0
    })
    i += step
  }
  return out
}

export function countLines(buffer: Buffer): number {
  const probe = buffer.subarray(0, 8000)
  if (probe.includes(0)) return 0
  if (buffer.length === 0) return 0
  let lines = 0
  for (const byte of buffer) {
    if (byte === 10) lines++
  }
  if (buffer[buffer.length - 1] !== 10) lines++
  return lines
}

async function fileLines(path: string): Promise<number> {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(UNTRACKED_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, UNTRACKED_BYTES, 0)
    return countLines(buffer.subarray(0, bytesRead))
  } finally {
    await handle.close()
  }
}

async function rawChanges(cwd: string, base: string): Promise<RawChange[]> {
  const [names, numbers, others] = await Promise.all([
    git(cwd, ['diff', '--name-status', '-z', '-M', base, '--']),
    git(cwd, ['diff', '--numstat', '-z', '-M', base, '--']),
    git(cwd, ['ls-files', '--others', '--exclude-standard', '-z'])
  ])
  const stats = parseNumstat(numbers)
  const changes: RawChange[] = []
  for (const [path, entry] of parseNameStatus(names)) {
    const stat = stats.get(path) ?? { additions: 0, deletions: 0 }
    changes.push({ path, oldPath: entry.oldPath, status: entry.status, ...stat })
  }
  const untracked = others.split('\0').filter((path) => path !== '')
  for (const [index, path] of untracked.entries()) {
    let additions = 0
    if (index < UNTRACKED_MAX) {
      try {
        additions = await fileLines(join(cwd, path))
      } catch {
        additions = 0
      }
    }
    changes.push({ path, oldPath: null, status: 'untracked', additions, deletions: 0 })
  }
  changes.sort((a, b) => a.path.localeCompare(b.path))
  return changes
}

export async function fileChanges(cwd: string, base: string | null): Promise<AgentFileChange[]> {
  const sha = await diffBase(cwd, base)
  if (!sha) return []
  const changes: AgentFileChange[] = []
  for (const change of await rawChanges(cwd, sha)) {
    changes.push({ path: change.path, status: change.status, additions: change.additions, deletions: change.deletions })
  }
  return changes
}

export function summarizeChanges(changes: AgentFileChange[]): AgentChanges {
  let additions = 0
  let deletions = 0
  for (const change of changes) {
    additions += change.additions
    deletions += change.deletions
  }
  return { files: changes.length, additions, deletions }
}

export async function changeStat(cwd: string, base: string | null): Promise<AgentChanges | null> {
  try {
    return summarizeChanges(await fileChanges(cwd, base))
  } catch {
    return null
  }
}

// Unified diff of one changed file against the merge base; only paths git lists as changed are diffed.
export async function fileDiff(cwd: string, base: string | null, path: string): Promise<string> {
  const sha = await diffBase(cwd, base)
  if (!sha) throw new GitError('No commit to diff against')
  const change = (await rawChanges(cwd, sha)).find((entry) => entry.path === path)
  if (!change) throw new GitError(`${path} has no changes`)
  let diff: string
  if (change.status === 'untracked') diff = await git(cwd, ['diff', '--no-index', '--', '/dev/null', path], [0, 1])
  else if (change.oldPath) diff = await git(cwd, ['diff', '-M', sha, '--', change.oldPath, path])
  else diff = await git(cwd, ['diff', sha, '--', path])
  return diff.length > DIFF_MAX ? `${diff.slice(0, DIFF_MAX)}\n… diff truncated` : diff
}

export type RemoteRepo = { host: string; owner: string; repo: string }

const NAME = /^[A-Za-z0-9._-]+$/

// https://github.com/o/r(.git), git@github.com:o/r.git and ssh://git@github.com[:port]/o/r.git.
export function parseRemoteUrl(url: string): RemoteRepo | null {
  const text = url.trim()
  const patterns = [
    /^(?:https?|git|ssh):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/,
    /^(?:[^@/]+@)?([^/:]+):([^/]+)\/([^/]+?)(?:\.git)?\/?$/
  ]
  for (const pattern of patterns) {
    const match = pattern.exec(text)
    if (!match || !match[1] || !match[2] || !match[3]) continue
    const owner = match[2]
    const repo = match[3]
    if (!NAME.test(owner) || !NAME.test(repo) || /^\.+$/.test(owner) || /^\.+$/.test(repo)) return null
    return { host: match[1].toLowerCase(), owner, repo }
  }
  return null
}

export async function originRepo(cwd: string): Promise<RemoteRepo | null> {
  const url = await gitOrNull(cwd, ['remote', 'get-url', 'origin'])
  return url ? parseRemoteUrl(url) : null
}

// The first words of the prompt plus a short random suffix, e.g. "fix-login-redirect-3f9a".
export function worktreeSlug(prompt: string, suffix: string): string {
  const words = prompt.toLowerCase().match(/[a-z0-9]+/g) ?? []
  let slug = ''
  for (const word of words.slice(0, 5)) {
    const next = slug === '' ? word : `${slug}-${word}`
    if (next.length > 40) break
    slug = next
  }
  return `${slug === '' ? 'agent' : slug}-${suffix}`
}
