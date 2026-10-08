import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { startAnthropic, startGitHub, type FixtureServer, type GitHubFixture } from '../fixtures/servers'

const AGENT_FIXTURES = resolve(import.meta.dirname, '../fixtures/agents')
// The cwd the fixture sessions were recorded in; copies point it at a real temp dir instead.
const FIXTURE_CWD = '/tmp/repo'

export type AgentEnv = {
  claudeBin: string
  codexBin: string
  claudeHome: string
  codexHome: string
  worktreeRoot: string
  argvLog: string
  // Where the fixture outside sessions say they ran; exists, but is not a git repo.
  outsideCwd: string
  zdotdir: string
}

export type Harness = {
  app: ElectronApplication
  page: Page
  github: GitHubFixture
  anthropic: FixtureServer
  userData: string
  agents: AgentEnv
  close(): Promise<void>
}

// Backdated an hour so the copies read as recent but not running.
function copyHome(name: string, to: string, cwd: string): void {
  cpSync(join(AGENT_FIXTURES, name), to, { recursive: true })
  const past = new Date(Date.now() - 60 * 60 * 1000)
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) {
        visit(path)
        continue
      }
      if (path.endsWith('.jsonl')) writeFileSync(path, readFileSync(path, 'utf8').replaceAll(FIXTURE_CWD, cwd))
      utimesSync(path, past, past)
    }
  }
  visit(to)
}

function agentEnv(root: string): AgentEnv {
  const outsideCwd = join(root, 'outside')
  mkdirSync(outsideCwd)
  // A login shell without the user's dotfiles: prot reads children's PATH from it, and it needs node for the fakes.
  const zdotdir = join(root, 'zsh')
  mkdirSync(zdotdir)
  writeFileSync(join(zdotdir, '.zshenv'), `export PATH=${JSON.stringify(process.env.PATH ?? '')}\n`)
  const env: AgentEnv = {
    claudeBin: join(AGENT_FIXTURES, 'fake-claude.mjs'),
    codexBin: join(AGENT_FIXTURES, 'fake-codex.mjs'),
    claudeHome: join(root, 'claude-home'),
    codexHome: join(root, 'codex-home'),
    worktreeRoot: join(root, 'worktrees'),
    argvLog: join(root, 'argv.jsonl'),
    outsideCwd,
    zdotdir
  }
  copyHome('claude-home', env.claudeHome, outsideCwd)
  copyHome('codex-home', env.codexHome, outsideCwd)
  return env
}

export async function launch(): Promise<Harness> {
  const github = await startGitHub()
  const anthropic = await startAnthropic()
  const userData = mkdtempSync(join(tmpdir(), 'prot-e2e-'))
  const agentRoot = mkdtempSync(join(tmpdir(), 'prot-e2e-agents-'))
  const agents = agentEnv(agentRoot)
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ANTHROPIC_API_KEY') env[key] = value
  }
  const app = await electron.launch({
    args: ['out/main/index.js', `--user-data-dir=${userData}`],
    env: {
      ...env,
      GITHUB_API_URL: github.url,
      ANTHROPIC_BASE_URL: anthropic.url,
      PROT_HIDDEN_WINDOW: process.env.PROT_HEADED === '1' ? '0' : '1',
      // Every launch runs the fake CLIs against copies of the fixture homes, never the real ones.
      PROT_CLAUDE_BIN: agents.claudeBin,
      PROT_CODEX_BIN: agents.codexBin,
      CLAUDE_CONFIG_DIR: agents.claudeHome,
      CODEX_HOME: agents.codexHome,
      PROT_WORKTREE_ROOT: agents.worktreeRoot,
      PROT_FAKE_ARGV_LOG: agents.argvLog,
      SHELL: '/bin/zsh',
      ZDOTDIR: agents.zdotdir
    }
  })
  const page = await app.firstWindow()
  return {
    app,
    page,
    github,
    anthropic,
    userData,
    agents,
    async close() {
      await app.close()
      await github.close()
      await anthropic.close()
      rmSync(userData, { recursive: true, force: true })
      rmSync(agentRoot, { recursive: true, force: true })
    }
  }
}
