import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  changeStat,
  countLines,
  currentBranch,
  fileChanges,
  fileDiff,
  originRepo,
  parseNameStatus,
  parseNumstat,
  parseRemoteUrl,
  repoRoot,
  worktreeSlug
} from './git'

describe('parseRemoteUrl', () => {
  it.each([
    ['https://github.com/octo-labs/tools.git', { host: 'github.com', owner: 'octo-labs', repo: 'tools' }],
    ['https://github.com/octo-labs/tools', { host: 'github.com', owner: 'octo-labs', repo: 'tools' }],
    ['https://x-access-token:abc@github.com/octo-labs/tools.git', { host: 'github.com', owner: 'octo-labs', repo: 'tools' }],
    ['git@github.com:octo-labs/tools.git', { host: 'github.com', owner: 'octo-labs', repo: 'tools' }],
    ['ssh://git@github.com:22/octo-labs/tools.git', { host: 'github.com', owner: 'octo-labs', repo: 'tools' }],
    ['git@gitlab.com:group/project.git', { host: 'gitlab.com', owner: 'group', repo: 'project' }]
  ])('parses %s', (url, repo) => {
    expect(parseRemoteUrl(url)).toEqual(repo)
  })

  it.each([['/srv/git/tools.git'], ['https://github.com/only-owner'], ['git@github.com:../x.git']])('rejects %s', (url) => {
    expect(parseRemoteUrl(url)).toBeNull()
  })
})

describe('change parsing', () => {
  it('reads -z name-status and numstat output, renames and binaries included', () => {
    expect(parseNameStatus('M\0src/a.ts\0R087\0old.ts\0new.ts\0A\0b.png\0D\0gone.ts\0')).toEqual(
      new Map([
        ['src/a.ts', { status: 'modified', oldPath: null }],
        ['new.ts', { status: 'renamed', oldPath: 'old.ts' }],
        ['b.png', { status: 'added', oldPath: null }],
        ['gone.ts', { status: 'removed', oldPath: null }]
      ])
    )
    expect(parseNumstat(['3\t1\tsrc/a.ts', '2\t2\t', 'old.ts', 'new.ts', '-\t-\tb.png', ''].join('\0'))).toEqual(
      new Map([
        ['src/a.ts', { additions: 3, deletions: 1 }],
        ['new.ts', { additions: 2, deletions: 2 }],
        ['b.png', { additions: 0, deletions: 0 }]
      ])
    )
  })

  it('counts lines, a missing final newline included, and none for binary files', () => {
    expect(countLines(Buffer.from('a\nb\n'))).toBe(2)
    expect(countLines(Buffer.from('a\nb'))).toBe(2)
    expect(countLines(Buffer.from(''))).toBe(0)
    expect(countLines(Buffer.from([1, 0, 2]))).toBe(0)
  })

  it('makes a slug from the first words of the prompt', () => {
    expect(worktreeSlug('Fix the login redirect loop, then add tests!', '3f9a')).toBe('fix-the-login-redirect-loop-3f9a')
    expect(worktreeSlug('???', 'beef')).toBe('agent-beef')
  })
})

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

describe('a real repository', () => {
  it('reports changes against the merge base, untracked lines as additions, and per-file diffs', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'prot-git-')))
    git(dir, 'init', '-q', '-b', 'main')
    git(dir, 'config', 'user.email', 'test@example.com')
    git(dir, 'config', 'user.name', 'Test')
    git(dir, 'remote', 'add', 'origin', 'git@github.com:octo-labs/tools.git')
    writeFileSync(join(dir, 'a.txt'), 'one\ntwo\n')
    writeFileSync(join(dir, 'old.txt'), 'keep\nthese\nlines\nhere\n')
    git(dir, 'add', '.')
    git(dir, 'commit', '-q', '-m', 'base')
    git(dir, 'checkout', '-q', '-b', 'prot/fix')
    writeFileSync(join(dir, 'a.txt'), 'one\n2\nthree\n')
    git(dir, 'mv', 'old.txt', 'new.txt')
    git(dir, 'commit', '-q', '-am', 'work')
    writeFileSync(join(dir, 'notes.md'), 'x\ny\nz')

    expect(await repoRoot(dir)).toBe(dir)
    expect(await repoRoot('relative')).toBeNull()
    expect(await currentBranch(dir)).toBe('prot/fix')
    expect(await originRepo(dir)).toEqual({ host: 'github.com', owner: 'octo-labs', repo: 'tools' })
    expect(await fileChanges(dir, 'main')).toEqual([
      { path: 'a.txt', status: 'modified', additions: 2, deletions: 1 },
      { path: 'new.txt', status: 'renamed', additions: 0, deletions: 0 },
      { path: 'notes.md', status: 'untracked', additions: 3, deletions: 0 }
    ])
    expect(await changeStat(dir, null)).toEqual({ files: 3, additions: 5, deletions: 1 })
    expect(await fileDiff(dir, 'main', 'a.txt')).toContain('+three')
    expect(await fileDiff(dir, 'main', 'notes.md')).toContain('+z')
    await expect(fileDiff(dir, 'main', 'missing.txt')).rejects.toThrow('missing.txt has no changes')
  })
})
