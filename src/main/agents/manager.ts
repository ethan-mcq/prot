import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { createInterface } from 'node:readline'
import { BrowserWindow, dialog, Notification, shell } from 'electron'
import {
  type AgentInstructions,
  AGENT_PROVIDERS,
  isImageMime,
  PROVIDER_NAMES,
  type AgentAttachment,
  type AgentChange,
  type AgentCommand,
  type AgentContext,
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
import { expandCommands } from '@shared/agent-commands'
import { IPC } from '@shared/ipc'
import type { AuthService } from '../auth'
import type { SettingsStore } from '../settings'
import { focusMainWindow } from '../window'
import { AgentAttachments } from './attachments'
import { newClaudeState, parseClaudeLine, type ClaudeParseState, type SaveImage } from './claude-events'
import {
  childEnv,
  claudeStdinMessage,
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
  probeClaudeUsage,
  probeSignIn,
  probeVersion,
  turnArgs,
  type StdinImage,
  type TurnMode
} from './cli'
import { commandBody, discoverCommands, parseCommandsChanged } from './commands'
import { AgentFileAllowlist } from './files'
import { eventImages, imageSaver, withImages } from './images'
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
  readCodexContext,
  readCodexTranscript,
  type OutsideSession
} from './sessions'
import type { AgentStore, StoredAgent } from './store'
import type { PromptStore } from '../prompt-store'
import { displayName, findVersion, livePrompt, type PromptLibrary } from '@shared/prompts'
import { findAgentsMd } from './instructions'

const REFRESH_MS = 30_000
const CLAUDE_USAGE_MS = 5 * 60 * 1000
const PR_TTL_MS = 2 * 60 * 1000
const RECENT_MS = 24 * 60 * 60 * 1000
const STOP_GRACE_MS = 5_000
const STDERR_LINES = 20
const GIT_CONCURRENCY = 4
const CLAUDE_WINDOW = 200_000
const CLAUDE_1M_WINDOW = 1_000_000

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
  // The model the stream reports, for its context window.
  model: string | null
}

type Outside = { summary: AgentSummary; file: string }

type GitInfo = { root: string; branch: string | null; changes: AgentSummary['changes']; origin: RemoteRepo | null }

export function worktreeRoot(): string {
  return resolve(process.env.PROT_WORKTREE_ROOT || join(homedir(), '.prot', 'worktrees'))
}

function publicSummary(agent: StoredAgent): AgentSummary {
  const { archived: _archived, forkedFrom: _forkedFrom, promptHash: _promptHash, ...summary } = agent
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

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function userEvent(at: string, text: string, attachments: AgentAttachment[]): AgentEvent {
  const event: AgentEvent = { kind: 'user', id: randomUUID(), at, text }
  if (attachments.length > 0) event.attachments = attachments
  return event
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
  private claudeUsageAt = 0
  private readonly attachments: AgentAttachments
  private readonly saveImage: SaveImage
  private readonly files = new AgentFileAllowlist()

  constructor(
    private readonly store: AgentStore,
    private readonly auth: AuthService,
    private readonly settings: SettingsStore,
    private readonly prompts: PromptStore,
    private readonly broadcast: (channel: string, payload: unknown) => void,
    // userData/agents: attachments/ and images/ live under it.
    dataDir: string
  ) {
    this.attachments = new AgentAttachments(join(dataDir, 'attachments'))
    this.saveImage = imageSaver(join(dataDir, 'images'))
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
    const folder = resolve(input.folder)
    if (!(await isDirectory(folder))) throw new Error(`${input.folder} is not a folder`)
    const repo = await repoRoot(folder)
    if (input.worktree && !repo) throw new Error(`${folder} is not a git repository, so it cannot have a worktree`)
    const attachments = await this.attachments.resolve(input.attachments)
    const info = await this.providerInfo(input.provider)
    if (!info.binary) throw new Error(`${PROVIDER_NAMES[input.provider]} is not installed`)
    if (!info.signedIn) throw new Error(`${PROVIDER_NAMES[input.provider]} is not signed in`)
    if (!PERMISSIONS[input.provider].some((option) => option.id === input.permission)) {
      throw new Error(`Unknown permission ${input.permission}`)
    }

    let cwd = repo ?? folder
    let branch = repo ? await currentBranch(repo) : null
    let worktree: StoredAgent['worktree'] = null
    if (input.worktree && repo) {
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
      repoName: basename(repo ?? folder),
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
      context: null,
      archived: false,
      forkedFrom: null,
      promptHash: null
    }
    this.store.add(agent)
    this.store.addRepo(repo ?? folder)
    this.emit(agent, [await this.lockPrompt(agent, now), userEvent(now, input.prompt, attachments)])
    await this.runTurn(agent, input.prompt, 'first', agent.sessionId, attachments)
    return publicSummary(agent)
  }

  async get(id: string): Promise<AgentDetail> {
    const agent = this.store.get(id)
    if (agent && !agent.archived) return { ...publicSummary(agent), transcript: this.allowImages(await this.store.readTranscript(id)) }
    const outside = this.outside.get(id)
    if (!outside) throw new Error('Unknown agent')
    return { ...outside.summary, transcript: this.allowImages(await this.readOutside(outside)) }
  }

  // The protocol serves only image paths a loaded agent's events or attachments named.
  fileAllowed(path: string): boolean {
    return this.files.has(path)
  }

  private allowImages(events: AgentEvent[]): AgentEvent[] {
    for (const event of events) this.files.allow(eventImages(event))
    return events
  }

  private async readOutside(outside: Outside): Promise<AgentEvent[]> {
    const events =
      outside.summary.provider === 'claude' ? await readClaudeTranscript(outside.file, this.saveImage) : await readCodexTranscript(outside.file)
    const out: AgentEvent[] = []
    for (const event of events) out.push(withImages(event))
    return out
  }

  async commands(folder: string): Promise<AgentCommand[]> {
    return this.discover(resolve(folder))
  }

  private async discover(dir: string): Promise<AgentCommand[]> {
    const agentFolder = this.settings.get().agentFolder
    return discoverCommands({
      repoPath: dir,
      home: homedir(),
      claudeDir: claudeConfigDir(),
      codexHome: codexHome(),
      agentFolder: agentFolder && existsSync(agentFolder) ? agentFolder : null,
      cached: this.store.cachedCommands(dir)
    })
  }

  // /name tokens become what the agent's CLI understands.
  private async expand(agent: StoredAgent, text: string): Promise<string> {
    if (!text.includes('/')) return text
    const commands = await this.discover(agent.repoPath ?? agent.cwd)
    return expandCommands(text, agent.provider, commands, (command) => (command.path ? commandBody(command.path) : null))
  }

  async pickAttachments(): Promise<AgentAttachment[]> {
    const options: Electron.OpenDialogOptions = { title: 'Attach files', properties: ['openFile', 'multiSelections'] }
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled) return []
    const out: AgentAttachment[] = []
    for (const path of result.filePaths) out.push(await this.attachments.copy(path))
    this.files.allow(out.map((attachment) => attachment.path))
    return out
  }

  async saveAttachment(name: string, data: Uint8Array): Promise<AgentAttachment> {
    const attachment = await this.attachments.save(name, data)
    this.files.allow([attachment.path])
    return attachment
  }

  async send(id: string, prompt: string, list: AgentAttachment[] = []): Promise<AgentSummary> {
    const attachments = await this.attachments.resolve(list)
    const agent = this.store.get(id)
    if (!agent || agent.archived) {
      const outside = this.outside.get(id)
      if (!outside) throw new Error('Unknown agent')
      return this.fork(outside, prompt, attachments)
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
    this.emit(agent, [userEvent(new Date().toISOString(), prompt, attachments)])
    await this.runTurn(agent, prompt, mode, sessionId, attachments)
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
    if (!existsSync(agent.cwd) || !(await repoRoot(agent.cwd))) return []
    return fileChanges(agent.cwd, agent.worktree?.base ?? null)
  }

  async diff(id: string, path: string): Promise<string> {
    const agent = this.summary(id)
    if (!existsSync(agent.cwd)) throw new Error(`${agent.cwd} no longer exists`)
    return fileDiff(agent.cwd, agent.worktree?.base ?? null, path)
  }

  async addFolder(): Promise<AgentRepo | null> {
    const options: Electron.OpenDialogOptions = { title: 'Add a folder', properties: ['openDirectory', 'createDirectory'] }
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    const picked = result.filePaths[0]
    if (result.canceled || !picked) return null
    if (!(await isDirectory(picked))) throw new Error(`${picked} is not a folder`)
    const path = (await repoRoot(picked)) ?? resolve(picked)
    this.store.addRepo(path)
    return this.folderEntry(path)
  }

  private async folderEntry(path: string): Promise<AgentRepo> {
    const git = (await repoRoot(path)) !== null
    return { path, name: basename(path), branch: git ? await currentBranch(path) : null, git }
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
      void this.refreshClaudeUsage(true)
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
      repos.push(await this.folderEntry(path))
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
        costUsd: session.costUsd,
        context: this.outsideContext(session)
      }
      this.outside.set(id, { summary, file: session.file })
      if (!previous || !sameJson(previous, summary)) this.changed(summary, null)
    }
    for (const id of [...this.outside.keys()]) {
      if (!seen.has(id)) this.outside.delete(id)
    }
  }

  private outsideContext(session: OutsideSession): AgentContext | null {
    if (session.contextTokens === null) return null
    const window = session.contextWindow ?? (session.provider === 'claude' ? this.claudeWindow(session.model, null) : null)
    return window ? { usedTokens: session.contextTokens, windowTokens: window } : null
  }

  // The window result.modelUsage last reported for the model, else Claude's default for it.
  private claudeWindow(agentModel: string | null, streamModel: string | null): number {
    const known = (streamModel ? this.store.contextWindow(streamModel) : null) ?? (agentModel ? this.store.contextWindow(agentModel) : null)
    if (known) return known
    return agentModel?.includes('[1m]') || streamModel?.includes('[1m]') ? CLAUDE_1M_WINDOW : CLAUDE_WINDOW
  }

  // At most every 5 minutes unless forced; each probe starts the CLI.
  private async refreshClaudeUsage(force: boolean): Promise<void> {
    const info = this.providers.get('claude')
    if (!info?.binary || !info.signedIn) return
    if (!force && Date.now() - this.claudeUsageAt < CLAUDE_USAGE_MS) return
    this.claudeUsageAt = Date.now()
    try {
      const usage = await probeClaudeUsage(info.binary, await childEnv())
      if (usage.length > 0 && !sameJson(usage, this.store.usage('claude'))) this.setUsage('claude', usage)
    } catch {
      // Keep the last known usage.
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
      await Promise.all([this.scanOutside(), this.refreshCodexUsage(), this.refreshClaudeUsage(false)])
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
  // Locks the live agent prompt for the agent's turns and returns the transcript card that names it.
  private async lockPrompt(agent: StoredAgent, at: string): Promise<AgentEvent> {
    const live = livePrompt(await this.prompts.get('agent'))
    agent.promptHash = live.hash
    return { kind: 'system', id: randomUUID(), at, name: displayName(live), hash: live.hash, text: live.text }
  }

  private async systemPrompt(agent: StoredAgent): Promise<string | null> {
    if (!agent.promptHash) return null
    const library = await this.prompts.get('agent')
    return (findVersion(library, agent.promptHash) ?? livePrompt(library)).text
  }

  async instructions(): Promise<AgentInstructions> {
    const folder = this.settings.get().agentFolder
    return { folder, file: folder ? await findAgentsMd(folder) : null }
  }

  async chooseInstructionsFolder(): Promise<AgentInstructions> {
    const picked = await dialog.showOpenDialog({ title: 'Folder with your skills and AGENTS.md', properties: ['openDirectory'] })
    if (!picked.canceled && picked.filePaths[0]) await this.settings.set({ agentFolder: picked.filePaths[0] })
    return this.instructions()
  }

  // Writes the live agent prompt as the folder's AGENTS.md when it has none.
  async createAgentsMd(): Promise<AgentInstructions> {
    const current = await this.instructions()
    if (!current.folder) throw new Error('Choose a folder first')
    if (current.file) throw new Error(`${current.file} already exists`)
    await writeFile(join(current.folder, 'AGENTS.md'), `${livePrompt(await this.prompts.get('agent')).text}\n`, { flag: 'wx' })
    return this.instructions()
  }

  async importAgentsMd(): Promise<PromptLibrary> {
    const { file } = await this.instructions()
    if (!file) throw new Error('The folder has no AGENTS.md')
    const { library, version } = await this.prompts.save('agent', await readFile(file, 'utf8'))
    void library
    return this.prompts.setLive('agent', version.hash)
  }

  private async runTurn(
    agent: StoredAgent,
    prompt: string,
    mode: TurnMode,
    sessionId: string | null,
    attachments: AgentAttachment[]
  ): Promise<void> {
    try {
      await this.spawnTurn(agent, await this.expand(agent, prompt), mode, sessionId, attachments)
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error)
      agent.status = 'failed'
      agent.turnStartedAt = null
      this.emit(agent, [{ kind: 'error', id: randomUUID(), at: new Date().toISOString(), text }])
      this.changed(agent, null)
    }
  }

  private async spawnTurn(
    agent: StoredAgent,
    prompt: string,
    mode: TurnMode,
    sessionId: string | null,
    attachments: AgentAttachment[]
  ): Promise<void> {
    const info = await this.providerInfo(agent.provider)
    if (!info.binary) throw new Error(`${PROVIDER_NAMES[agent.provider]} is not installed`)
    const agentFolder = this.settings.get().agentFolder
    const images: AgentAttachment[] = []
    const others: string[] = []
    for (const attachment of attachments) {
      if (isImageMime(attachment.mime)) images.push(attachment)
      else others.push(`- ${attachment.path}`)
    }
    let text = prompt
    if (others.length > 0) text += `\n\nAttached files:\n${others.join('\n')}`
    const stdinPrompt = agent.provider === 'claude' && images.length > 0
    let stdin: string | null = null
    if (stdinPrompt) {
      const blocks: StdinImage[] = []
      for (const image of images) blocks.push({ mime: image.mime, data: await readFile(image.path) })
      stdin = claudeStdinMessage(text, blocks)
    }
    const args = turnArgs(agent.provider, {
      mode,
      prompt: text,
      model: agent.model ?? info.defaultModel,
      effort: agent.effort ?? info.defaultEffort,
      permission: agent.permission ?? info.defaultPermission,
      cwd: agent.cwd,
      sessionId,
      systemPrompt: await this.systemPrompt(agent),
      addDirs: agent.provider === 'claude' && agentFolder && existsSync(agentFolder) ? [agentFolder] : [],
      stdinPrompt,
      images: agent.provider === 'codex' ? images.map((image) => image.path) : []
    })
    const env = await childEnv()
    const child = spawn(info.binary, args, { cwd: agent.cwd, env, stdio: [stdin === null ? 'ignore' : 'pipe', 'pipe', 'pipe'], detached: true })
    if (stdin !== null && child.stdin) {
      child.stdin.on('error', () => {})
      child.stdin.end(stdin)
    }
    const turn: Turn = {
      child,
      stopping: false,
      killTimer: null,
      stderr: [],
      sawResult: false,
      resultError: false,
      spawnError: null,
      claude: agent.provider === 'claude' ? newClaudeState(false, this.saveImage) : null,
      codex: agent.provider === 'codex' ? newCodexState(randomBytes(4).toString('hex')) : null,
      model: null
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
      if (out.model) turn.model = out.model
      if (out.commands) {
        const commands = parseCommandsChanged(out.commands)
        if (commands) this.store.setCachedCommands(agent.repoPath ?? agent.cwd, commands)
      }
      if (out.contextWindows) {
        this.store.setContextWindows(out.contextWindows)
        if (agent.context) agent.context = { ...agent.context, windowTokens: this.claudeWindow(agent.model, turn.model) }
      }
      if (out.contextTokens !== null) {
        agent.context = { usedTokens: out.contextTokens, windowTokens: this.claudeWindow(agent.model, turn.model) }
        this.changed(agent, null)
      }
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
    if (agent.provider === 'codex') {
      void this.refreshCodexUsage()
      void this.refreshCodexContext(agent)
    }
  }

  private async refreshCodexContext(agent: StoredAgent): Promise<void> {
    if (!agent.sessionId) return
    try {
      const context = await readCodexContext(codexHome(), agent.sessionId)
      if (!context || sameJson(context, agent.context)) return
      agent.context = context
      this.store.scheduleSave()
      this.changed(agent, null)
    } catch {
      // Keep the last known context.
    }
  }

  private setUsage(provider: AgentProvider, usage: UsageWindow[]): void {
    this.store.setUsage(provider, usage)
    const change: AgentUsageChange = { provider, usage }
    this.broadcast(IPC.agentsUsage, change)
  }

  private emit(agent: StoredAgent, list: AgentEvent[]): void {
    if (list.length === 0) return
    const events: AgentEvent[] = []
    for (const event of list) events.push(withImages(event))
    this.allowImages(events)
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

  private async fork(outside: Outside, prompt: string, attachments: AgentAttachment[]): Promise<AgentSummary> {
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
      context: source.context,
      archived: false,
      forkedFrom: source.sessionId,
      promptHash: null
    }
    const history = await this.readOutside(outside).catch(() => [] as AgentEvent[])
    this.store.add(agent)
    await this.store.appendEvents(agent.id, history)
    this.emit(agent, [await this.lockPrompt(agent, now), userEvent(now, prompt, attachments)])
    await this.runTurn(agent, prompt, 'fork', source.sessionId, attachments)
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
