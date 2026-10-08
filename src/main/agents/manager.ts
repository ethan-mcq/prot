import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { createInterface } from 'node:readline'
import { BrowserWindow, dialog, Notification, shell } from 'electron'
import {
  AGENT_PROVIDERS,
  PROVIDER_NAMES,
  type AgentChange,
  type AgentDetail,
  type AgentEvent,
  type AgentFileChange,
  type AgentOpenTarget,
  type AgentPr,
  type AgentProvider,
  type AgentRepo,
  type AgentStartInput,
  type AgentSummary,
  type AgentsState,
  type AgentUsageChange,
  type ProviderInfo,
  type UsageWindow
} from '@shared/agents'
import { IPC } from '@shared/ipc'
import type { AuthService } from '../auth'
import type { SettingsStore } from '../settings'
import { focusMainWindow } from '../window'
import { newClaudeState, parseClaudeLine, type ClaudeParseState } from './claude-events'
import {
  childEnv,
  claudeConfigDir,
  claudeDefaults,
  claudeModels,
  codexHome,
  codexModelsAndDefaults,
  DEFAULT_PERMISSION,
  findBinary,
  findOnPath,
  loginShellPath,
  PERMISSIONS,
  probeSignIn,
  probeVersion,
  turnArgs,
  type TurnMode
} from './cli'
import { newCodexState, parseCodexLine, type CodexParseState } from './codex-events'
import { oneLine, promptTitle, type ToolEvent } from './events'
import {
  addWorktree,
  changeStat,
  currentBranch,
  fileChanges,
  fileDiff,
  headSha,
  originRepo,
  removeWorktree,
  repoRoot,
  worktreeSlug,
  type RemoteRepo
} from './git'
import {
  latestCodexUsage,
  listClaudeSessions,
  listCodexSessions,
  readClaudeTranscript,
  readCodexTranscript,
  type OutsideSession
} from './sessions'
import type { AgentStore, StoredAgent } from './store'

const REFRESH_MS = 30_000
const PR_TTL_MS = 2 * 60 * 1000
const RECENT_MS = 24 * 60 * 60 * 1000
const STOP_GRACE_MS = 5_000
const STDERR_LINES = 20
const GIT_CONCURRENCY = 4

type Turn = {
  child: ChildProcess
  stopping: boolean
  killTimer: NodeJS.Timeout | null
  stderr: string[]
  sawResult: boolean
  resultError: boolean
  spawnError: string | null
  claude: ClaudeParseState | null
  codex: CodexParseState | null
}

type Outside = { summary: AgentSummary; file: string }

type GitInfo = { root: string; branch: string | null; changes: AgentSummary['changes']; origin: RemoteRepo | null }

export function worktreeRoot(): string {
  return resolve(process.env.PROT_WORKTREE_ROOT || join(homedir(), '.prot', 'worktrees'))
}

function publicSummary(agent: StoredAgent): AgentSummary {
  const { archived: _archived, forkedFrom: _forkedFrom, ...summary } = agent
  return summary
}

function signal(child: ChildProcess, name: NodeJS.Signals): void {
  // Children run in their own process group so the agent's own subprocesses get the signal too.
  try {
    if (child.pid) process.kill(-child.pid, name)
    return
  } catch {
    // Fall back to the child alone.
  }
  try {
    child.kill(name)
  } catch {
    // Already gone.
  }
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export class AgentManager {
  private readonly turns = new Map<string, Turn>()
  private readonly outside = new Map<string, Outside>()
  private readonly providers = new Map<AgentProvider, ProviderInfo>()
  private readonly prCache = new Map<string, { at: number; pr: AgentPr | null }>()
  private readonly notifications = new Set<Notification>()
  private ready: Promise<void> | null = null
  private timer: NodeJS.Timeout | null = null
  private ticking = false

  constructor(
    private readonly store: AgentStore,
    private readonly auth: AuthService,
    private readonly settings: SettingsStore,
    private readonly broadcast: (channel: string, payload: unknown) => void
  ) {
    let changed = false
    for (const agent of store.agents()) {
      if (agent.status !== 'running') continue
      agent.status = 'stopped'
      agent.turnStartedAt = null
      changed = true
    }
    if (changed) store.scheduleSave()
  }

  boot(): void {
    // The login shell can take seconds to start; resolve its PATH before the dash first asks.
    void loginShellPath()
    this.timer = setInterval(() => {
      if (BrowserWindow.getFocusedWindow()) void this.tick()
    }, REFRESH_MS)
  }

  // Called from before-quit: every child dies with prot.
  shutdown(): void {
    if (this.timer) clearInterval(this.timer)
    for (const turn of this.turns.values()) {
      turn.stopping = true
      signal(turn.child, 'SIGTERM')
    }
    void this.store.flush().catch(() => {})
  }

  async state(): Promise<AgentsState> {
    this.ready ??= this.load()
    await this.ready
    return this.snapshot()
  }

  async refresh(): Promise<AgentsState> {
    this.ready = this.load()
    await this.ready
    return this.snapshot()
  }

  async start(input: AgentStartInput): Promise<AgentSummary> {
    const repo = await repoRoot(input.repoPath)
    if (!repo) throw new Error(`${input.repoPath} is not in a git repository`)
    const info = await this.providerInfo(input.provider)
    if (!info.binary) throw new Error(`${PROVIDER_NAMES[input.provider]} is not installed`)
    if (!info.signedIn) throw new Error(`${PROVIDER_NAMES[input.provider]} is not signed in`)
    if (!PERMISSIONS[input.provider].some((option) => option.id === input.permission)) {
      throw new Error(`Unknown permission ${input.permission}`)
    }

    let cwd = repo
    let branch = await currentBranch(repo)
    let worktree: StoredAgent['worktree'] = null
    if (input.worktree) {
      const slug = worktreeSlug(input.prompt, randomBytes(2).toString('hex'))
      const path = join(worktreeRoot(), basename(repo), slug)
      const base = branch ?? (await headSha(repo)) ?? 'HEAD'
      await mkdir(dirname(path), { recursive: true })
      await addWorktree(repo, path, `prot/${slug}`)
      worktree = { path, branch: `prot/${slug}`, base }
      cwd = path
      branch = worktree.branch
    }

    const now = new Date().toISOString()
    const agent: StoredAgent = {
      id: randomUUID(),
      source: 'prot',
      provider: input.provider,
      title: promptTitle(input.prompt),
      repoPath: repo,
      repoName: basename(repo),
      cwd,
      branch,
      worktree,
      model: input.model,
      effort: input.effort,
      permission: input.permission,
      sessionId: input.provider === 'claude' ? randomUUID() : null,
      status: 'idle',
      turnStartedAt: null,
      unread: false,
      createdAt: now,
      updatedAt: now,
      lastMessage: null,
      pr: null,
      changes: null,
      costUsd: null,
      archived: false,
      forkedFrom: null
    }
    this.store.add(agent)
    this.store.addRepo(repo)
    this.emit(agent, [{ kind: 'user', id: randomUUID(), at: now, text: input.prompt }])
    await this.runTurn(agent, input.prompt, 'first', agent.sessionId)
    return publicSummary(agent)
  }

  async get(id: string): Promise<AgentDetail> {
    const agent = this.store.get(id)
    if (agent && !agent.archived) return { ...publicSummary(agent), transcript: await this.store.readTranscript(id) }
    const outside = this.outside.get(id)
    if (!outside) throw new Error('Unknown agent')
    const read = outside.summary.provider === 'claude' ? readClaudeTranscript : readCodexTranscript
    return { ...outside.summary, transcript: await read(outside.file) }
  }

  async send(id: string, prompt: string): Promise<AgentSummary> {
    const agent = this.store.get(id)
    if (!agent || agent.archived) {
      const outside = this.outside.get(id)
      if (!outside) throw new Error('Unknown agent')
      return this.fork(outside, prompt)
    }
    if (this.turns.has(id)) throw new Error('This agent is still working. Stop it or wait for the turn to end.')
    if (!existsSync(agent.cwd)) throw new Error(`${agent.cwd} no longer exists`)
    let mode: TurnMode = 'resume'
    let sessionId = agent.sessionId
    if (!sessionId && agent.forkedFrom) {
      mode = 'fork'
      sessionId = agent.forkedFrom
    } else if (!sessionId) {
      mode = 'first'
      if (agent.provider === 'claude') {
        agent.sessionId = randomUUID()
        sessionId = agent.sessionId
      }
    }
    this.emit(agent, [{ kind: 'user', id: randomUUID(), at: new Date().toISOString(), text: prompt }])
    await this.runTurn(agent, prompt, mode, sessionId)
    return publicSummary(agent)
  }

  stop(id: string): void {
    const turn = this.turns.get(id)
    if (!turn) {
      if (this.outside.has(id)) throw new Error('Only agents started from prot can be stopped here')
      return
    }
    if (turn.stopping) return
    turn.stopping = true
    signal(turn.child, 'SIGINT')
    turn.killTimer = setTimeout(() => signal(turn.child, 'SIGTERM'), STOP_GRACE_MS)
  }

  markRead(id: string): void {
    const agent = this.store.get(id)
    if (!agent || !agent.unread) return
    agent.unread = false
    this.store.scheduleSave()
    this.changed(agent, null)
  }

  archive(id: string): void {
    const agent = this.store.get(id)
    if (agent) {
      this.stop(id)
      agent.archived = true
      this.store.scheduleSave()
      return
    }
    if (!this.outside.has(id)) throw new Error('Unknown agent')
    this.store.hide(id)
    this.outside.delete(id)
  }

  async removeWorktree(id: string): Promise<void> {
    const agent = this.store.get(id)
    if (!agent || !agent.worktree || !agent.repoPath) throw new Error('This agent has no worktree')
    if (this.turns.has(id)) throw new Error('Stop the agent before removing its worktree')
    const path = resolve(agent.worktree.path)
    if (!path.startsWith(worktreeRoot() + sep)) throw new Error('prot only removes worktrees it created')
    await removeWorktree(agent.repoPath, path)
    agent.worktree = null
    agent.changes = null
    agent.updatedAt = new Date().toISOString()
    this.store.scheduleSave()
    this.changed(agent, null)
  }

  async changes(id: string): Promise<AgentFileChange[]> {
    const agent = this.summary(id)
    if (!existsSync(agent.cwd)) return []
    return fileChanges(agent.cwd, agent.worktree?.base ?? null)
  }

  async diff(id: string, path: string): Promise<string> {
    const agent = this.summary(id)
    if (!existsSync(agent.cwd)) throw new Error(`${agent.cwd} no longer exists`)
    return fileDiff(agent.cwd, agent.worktree?.base ?? null, path)
  }

  async addRepo(): Promise<AgentRepo | null> {
    const options: Electron.OpenDialogOptions = { title: 'Add a repository', properties: ['openDirectory'] }
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    const picked = result.filePaths[0]
    if (result.canceled || !picked) return null
    const root = await repoRoot(picked)
    if (!root) throw new Error(`${picked} is not in a git repository`)
    this.store.addRepo(root)
    return { path: root, name: basename(root), branch: await currentBranch(root) }
  }

  async open(id: string, target: AgentOpenTarget): Promise<void> {
    const dir = this.summary(id).cwd
    if (!existsSync(dir)) throw new Error(`${dir} no longer exists`)
    if (target === 'finder') {
      const failure = await shell.openPath(dir)
      if (failure !== '') throw new Error(failure)
      return
    }
    if (target === 'terminal') {
      await new Promise<void>((done, fail) => {
        execFile('open', ['-a', 'Terminal', dir], { timeout: 10_000 }, (error) => (error ? fail(error) : done()))
      })
      return
    }
    const pathEnv = await loginShellPath()
    const editor = (await findOnPath('code', pathEnv)) ?? (await findOnPath('cursor', pathEnv))
    if (!editor) {
      const failure = await shell.openPath(dir)
      if (failure !== '') throw new Error(failure)
      return
    }
    const child = spawn(editor, [dir], { detached: true, stdio: 'ignore', env: { ...process.env, PATH: pathEnv } })
    child.on('error', (error) => console.error('Could not open the editor', error))
    child.unref()
  }

  // Loading

  private async load(): Promise<void> {
    try {
      await Promise.all([this.detectProviders(), this.scanOutside(), this.refreshCodexUsage()])
    } catch (error) {
      console.error('Could not load agents', error)
    }
    void this.refreshGit(this.recentAgents())
  }

  private async detectProviders(): Promise<void> {
    const infos = await Promise.all(AGENT_PROVIDERS.map((provider) => this.detect(provider)))
    for (const info of infos) this.providers.set(info.provider, info)
  }

  private async detect(provider: AgentProvider): Promise<ProviderInfo> {
    const pathEnv = await loginShellPath()
    const env = { ...process.env, PATH: pathEnv }
    const binary = await findBinary(provider, pathEnv)
    let version: string | null = null
    let signIn = { signedIn: false, account: null as string | null }
    if (binary) [version, signIn] = await Promise.all([probeVersion(binary, env), probeSignIn(provider, binary, env)])
    let models: ProviderInfo['models']
    let defaults: { model: string; effort: string }
    if (provider === 'claude') {
      defaults = await claudeDefaults(claudeConfigDir())
      models = claudeModels(defaults)
    } else {
      const codex = await codexModelsAndDefaults(codexHome())
      models = codex.models
      defaults = codex.defaults
    }
    return {
      provider,
      installed: binary !== null,
      binary,
      version,
      signedIn: signIn.signedIn,
      account: signIn.account,
      models,
      defaultModel: defaults.model,
      defaultEffort: defaults.effort,
      permissions: PERMISSIONS[provider],
      defaultPermission: DEFAULT_PERMISSION[provider],
      usage: []
    }
  }

  private async providerInfo(provider: AgentProvider): Promise<ProviderInfo> {
    let info = this.providers.get(provider)
    if (!info) {
      info = await this.detect(provider)
      this.providers.set(provider, info)
    }
    return info
  }

  private async snapshot(): Promise<AgentsState> {
    const providers: ProviderInfo[] = []
    for (const provider of AGENT_PROVIDERS) {
      const info = await this.providerInfo(provider)
      providers.push({ ...info, usage: this.store.usage(provider) })
    }
    return { agents: this.visible(), repos: await this.repoList(), providers }
  }

  private visible(): AgentSummary[] {
    const agents: AgentSummary[] = []
    for (const agent of this.store.agents()) {
      if (!agent.archived) agents.push(publicSummary(agent))
    }
    for (const entry of this.outside.values()) agents.push(entry.summary)
    agents.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    return agents
  }

  private async repoList(): Promise<AgentRepo[]> {
    const repos: AgentRepo[] = []
    for (const path of this.store.repos()) {
      if (!existsSync(path)) continue
      repos.push({ path, name: basename(path), branch: await currentBranch(path) })
    }
    return repos
  }

  private summary(id: string): AgentSummary {
    const agent = this.store.get(id)
    if (agent && !agent.archived) return agent
    const outside = this.outside.get(id)
    if (!outside) throw new Error('Unknown agent')
    return outside.summary
  }

  // Outside sessions

  private async scanOutside(): Promise<void> {
    const exclude = new Set<string>()
    for (const agent of this.store.agents()) {
      if (agent.sessionId) exclude.add(agent.sessionId)
    }
    const [claude, codex] = await Promise.all([
      listClaudeSessions(claudeConfigDir(), exclude).catch(() => [] as OutsideSession[]),
      listCodexSessions(codexHome(), exclude).catch(() => [] as OutsideSession[])
    ])
    const seen = new Set<string>()
    for (const session of [...claude, ...codex]) {
      const source = session.provider === 'claude' ? 'claude-app' : 'codex-app'
      const id = `${source}:${session.sessionId}`
      if (this.store.isHidden(id)) continue
      seen.add(id)
      const previous = this.outside.get(id)?.summary
      const summary: AgentSummary = {
        id,
        source,
        provider: session.provider,
        title: session.title,
        repoPath: previous?.repoPath ?? null,
        repoName: previous?.repoName ?? null,
        cwd: session.cwd,
        branch: previous?.branch ?? session.gitBranch,
        worktree: null,
        model: session.model,
        effort: session.effort,
        permission: null,
        sessionId: session.sessionId,
        status: session.running ? 'running' : 'idle',
        turnStartedAt: session.running ? session.lastTurnAt : null,
        unread: false,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        lastMessage: session.lastMessage,
        pr: previous?.pr ?? null,
        changes: previous?.changes ?? null,
        costUsd: session.costUsd
      }
      this.outside.set(id, { summary, file: session.file })
      if (!previous || !sameJson(previous, summary)) this.changed(summary, null)
    }
    for (const id of [...this.outside.keys()]) {
      if (!seen.has(id)) this.outside.delete(id)
    }
  }

  private async refreshCodexUsage(): Promise<void> {
    try {
      const usage = await latestCodexUsage(codexHome())
      if (usage.length > 0 && !sameJson(usage, this.store.usage('codex'))) this.setUsage('codex', usage)
    } catch {
      // Keep the last known usage.
    }
  }

  private async tick(): Promise<void> {
    if (this.ticking) return
    this.ticking = true
    try {
      await Promise.all([this.scanOutside(), this.refreshCodexUsage()])
      await this.refreshGit(this.recentAgents())
    } catch (error) {
      console.error('Agent refresh failed', error)
    } finally {
      this.ticking = false
    }
  }

  private recentAgents(): AgentSummary[] {
    const since = Date.now() - RECENT_MS
    const agents: AgentSummary[] = []
    for (const agent of this.visible()) {
      if (Date.parse(agent.updatedAt) >= since) agents.push(agent)
    }
    return agents
  }

  // Git and pull requests

  private async refreshGit(agents: AgentSummary[]): Promise<void> {
    try {
      await this.refreshGitNow(agents)
    } catch (error) {
      console.error('Agent git refresh failed', error)
    }
  }

  private async refreshGitNow(agents: AgentSummary[]): Promise<void> {
    const infos = new Map<string, Promise<GitInfo | null>>()
    for (let start = 0; start < agents.length; start += GIT_CONCURRENCY) {
      const chunk = agents.slice(start, start + GIT_CONCURRENCY)
      await Promise.all(
        chunk.map(async (agent) => {
          const base = agent.worktree?.base ?? null
          const key = `${agent.cwd}\0${base ?? ''}`
          let info = infos.get(key)
          if (!info) {
            info = this.gitInfo(agent.cwd, base)
            infos.set(key, info)
          }
          const result = await info
          if (!result) return
          const pr = await this.lookupPr(result, base)
          this.applyGit(agent.id, result, pr)
        })
      )
    }
  }

  private async gitInfo(cwd: string, base: string | null): Promise<GitInfo | null> {
    if (!existsSync(cwd)) return null
    try {
      const root = await repoRoot(cwd)
      if (!root) return null
      const [branch, changes, origin] = await Promise.all([currentBranch(cwd), changeStat(cwd, base), originRepo(cwd)])
      return { root, branch, changes, origin }
    } catch {
      return null
    }
  }

  // undefined keeps the PR already on the card.
  private async lookupPr(info: GitInfo, base: string | null): Promise<AgentPr | null | undefined> {
    const { branch, origin } = info
    if (!branch || !origin || origin.host !== 'github.com') return null
    if (['main', 'master'].includes(branch) || branch === base?.replace(/^origin\//, '')) return null
    if (!this.auth.user()) return undefined
    const key = `${origin.owner}/${origin.repo}#${branch}`
    const cached = this.prCache.get(key)
    if (cached && Date.now() - cached.at < PR_TTL_MS) return cached.pr
    try {
      const pr = await this.auth.client().findPullByBranch(origin.owner, origin.repo, branch)
      this.prCache.set(key, { at: Date.now(), pr })
      return pr
    } catch (error) {
      console.error('PR lookup failed', error)
      this.prCache.set(key, { at: Date.now(), pr: cached?.pr ?? null })
      return undefined
    }
  }

  private applyGit(id: string, info: GitInfo, pr: AgentPr | null | undefined): void {
    const agent = this.store.get(id)
    const outside = this.outside.get(id)
    const target: AgentSummary | undefined = agent ?? outside?.summary
    if (!target) return
    const before = JSON.stringify(target)
    target.branch = info.branch
    target.changes = info.changes
    if (pr !== undefined) target.pr = pr
    if (!agent) {
      target.repoPath = info.root
      target.repoName = basename(info.root)
    }
    if (JSON.stringify(target) === before) return
    if (agent) this.store.scheduleSave()
    this.changed(target, null)
  }

  // Turns

  // A turn that cannot start leaves the agent failed with the reason in its transcript.
  private async runTurn(agent: StoredAgent, prompt: string, mode: TurnMode, sessionId: string | null): Promise<void> {
    try {
      await this.spawnTurn(agent, prompt, mode, sessionId)
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error)
      agent.status = 'failed'
      agent.turnStartedAt = null
      this.emit(agent, [{ kind: 'error', id: randomUUID(), at: new Date().toISOString(), text }])
      this.changed(agent, null)
    }
  }

  private async spawnTurn(agent: StoredAgent, prompt: string, mode: TurnMode, sessionId: string | null): Promise<void> {
    const info = await this.providerInfo(agent.provider)
    if (!info.binary) throw new Error(`${PROVIDER_NAMES[agent.provider]} is not installed`)
    const args = turnArgs(agent.provider, {
      mode,
      prompt,
      model: agent.model ?? info.defaultModel,
      effort: agent.effort ?? info.defaultEffort,
      permission: agent.permission ?? info.defaultPermission,
      cwd: agent.cwd,
      sessionId
    })
    const env = await childEnv()
    const child = spawn(info.binary, args, { cwd: agent.cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
    const turn: Turn = {
      child,
      stopping: false,
      killTimer: null,
      stderr: [],
      sawResult: false,
      resultError: false,
      spawnError: null,
      claude: agent.provider === 'claude' ? newClaudeState() : null,
      codex: agent.provider === 'codex' ? newCodexState(randomBytes(4).toString('hex')) : null
    }
    this.turns.set(agent.id, turn)
    const now = new Date().toISOString()
    agent.status = 'running'
    agent.turnStartedAt = now
    agent.updatedAt = now
    this.store.scheduleSave()
    this.changed(agent, null)

    createInterface({ input: child.stdout!, crlfDelay: Infinity }).on('line', (line) => this.onLine(agent, turn, line))
    createInterface({ input: child.stderr!, crlfDelay: Infinity }).on('line', (line) => {
      turn.stderr.push(line)
      if (turn.stderr.length > STDERR_LINES) turn.stderr.shift()
    })
    child.on('error', (error) => {
      turn.spawnError = error.message
    })
    child.on('close', (code) => this.onClose(agent, turn, code))
  }

  private onLine(agent: StoredAgent, turn: Turn, text: string): void {
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      return
    }
    const now = new Date().toISOString()
    if (turn.claude) {
      const out = parseClaudeLine(raw, turn.claude, now)
      if (out.sessionId) agent.sessionId = out.sessionId
      if (out.usage) this.setUsage('claude', out.usage)
      if (out.result) {
        turn.sawResult = true
        turn.resultError = out.result.isError
        if (out.result.costUsd !== null) agent.costUsd = (agent.costUsd ?? 0) + out.result.costUsd
      }
      this.emit(agent, out.events)
    } else if (turn.codex) {
      const out = parseCodexLine(raw, turn.codex, now)
      if (out.threadId) agent.sessionId = out.threadId
      if (out.ended) {
        turn.sawResult = true
        turn.resultError = out.failed
      }
      this.emit(agent, out.events)
    }
  }

  private onClose(agent: StoredAgent, turn: Turn, code: number | null): void {
    if (this.turns.get(agent.id) === turn) this.turns.delete(agent.id)
    if (turn.killTimer) clearTimeout(turn.killTimer)
    const now = new Date().toISOString()
    const name = PROVIDER_NAMES[agent.provider]
    const events: AgentEvent[] = []
    let status: StoredAgent['status']
    if (turn.stopping) status = 'stopped'
    else if (turn.spawnError) {
      status = 'failed'
      events.push({ kind: 'error', id: randomUUID(), at: now, text: `Could not start ${name}: ${turn.spawnError}` })
    } else if (turn.sawResult) status = turn.resultError ? 'failed' : 'idle'
    else if (code === 0) status = 'idle'
    else {
      status = 'failed'
      const tail = turn.stderr.join('\n').trim()
      const head = `${name} exited with code ${code ?? 'unknown'}`
      events.push({ kind: 'error', id: randomUUID(), at: now, text: tail ? `${head}\n${tail}` : head })
    }
    const tools = turn.claude?.tools ?? turn.codex?.tools
    for (const tool of tools?.values() ?? []) {
      if (tool.status !== 'running') continue
      const ended: ToolEvent = { ...tool, status: 'error', output: tool.output ?? (turn.stopping ? 'Stopped' : 'Did not finish') }
      events.unshift(ended)
    }
    agent.status = status
    agent.turnStartedAt = null
    agent.unread = true
    agent.updatedAt = now
    this.emit(agent, events)
    this.store.scheduleSave()
    this.changed(agent, null)
    this.notifyTurnEnd(agent)
    void this.refreshGit([agent])
    if (agent.provider === 'codex') void this.refreshCodexUsage()
  }

  private setUsage(provider: AgentProvider, usage: UsageWindow[]): void {
    this.store.setUsage(provider, usage)
    const change: AgentUsageChange = { provider, usage }
    this.broadcast(IPC.agentsUsage, change)
  }

  private emit(agent: StoredAgent, events: AgentEvent[]): void {
    if (events.length === 0) return
    for (const event of events) {
      if (event.kind === 'assistant') agent.lastMessage = oneLine(event.text).slice(0, 300)
    }
    agent.updatedAt = new Date().toISOString()
    this.store.appendEvents(agent.id, events).catch((error: unknown) => console.error('Could not save an agent transcript', error))
    this.store.scheduleSave()
    for (const event of events) this.changed(agent, event)
  }

  private changed(agent: AgentSummary | StoredAgent, event: AgentEvent | null): void {
    if ('archived' in agent) {
      if (agent.archived) return
      const change: AgentChange = { agent: publicSummary(agent), event }
      this.broadcast(IPC.agentsChanged, change)
      return
    }
    const change: AgentChange = { agent: { ...agent }, event }
    this.broadcast(IPC.agentsChanged, change)
  }

  private async fork(outside: Outside, prompt: string): Promise<AgentSummary> {
    const source = outside.summary
    if (!existsSync(source.cwd)) throw new Error(`${source.cwd} no longer exists`)
    const info = await this.providerInfo(source.provider)
    if (!info.binary) throw new Error(`${PROVIDER_NAMES[source.provider]} is not installed`)
    const repoPath = source.repoPath ?? (await repoRoot(source.cwd))
    const now = new Date().toISOString()
    const agent: StoredAgent = {
      id: randomUUID(),
      source: 'prot',
      provider: source.provider,
      title: source.title,
      repoPath,
      repoName: repoPath ? basename(repoPath) : null,
      cwd: source.cwd,
      branch: source.branch,
      worktree: null,
      model: source.model ?? info.defaultModel,
      effort: source.effort ?? info.defaultEffort,
      permission: info.defaultPermission,
      sessionId: null,
      status: 'idle',
      turnStartedAt: null,
      unread: false,
      createdAt: now,
      updatedAt: now,
      lastMessage: source.lastMessage,
      pr: source.pr,
      changes: source.changes,
      costUsd: null,
      archived: false,
      forkedFrom: source.sessionId
    }
    const read = source.provider === 'claude' ? readClaudeTranscript : readCodexTranscript
    const history = await read(outside.file).catch(() => [] as AgentEvent[])
    this.store.add(agent)
    await this.store.appendEvents(agent.id, history)
    this.emit(agent, [{ kind: 'user', id: randomUUID(), at: now, text: prompt }])
    await this.runTurn(agent, prompt, 'fork', source.sessionId)
    return publicSummary(agent)
  }

  private notifyTurnEnd(agent: StoredAgent): void {
    if (BrowserWindow.getFocusedWindow()) return
    if (!this.settings.get().notify || !Notification.isSupported()) return
    if (agent.status === 'stopped') return
    const title = agent.status === 'failed' ? `${agent.title} failed` : agent.title
    const body = agent.lastMessage ?? (agent.status === 'failed' ? 'The turn failed' : 'The turn finished')
    const notification = new Notification({ title, body })
    this.notifications.add(notification)
    notification.on('click', () => {
      focusMainWindow()
      this.notifications.delete(notification)
    })
    notification.on('close', () => this.notifications.delete(notification))
    notification.show()
  }
}
