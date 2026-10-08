import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import type { AgentModelOption, AgentPermissionOption, AgentProvider } from '@shared/agents'

const PROBE_TIMEOUT_MS = 15_000
const PATH_MARK = '__PROT_PATH__'

export const BINARY_NAMES: Record<AgentProvider, string> = { claude: 'claude', codex: 'codex' }

const ENV_OVERRIDES: Record<AgentProvider, string> = { claude: 'PROT_CLAUDE_BIN', codex: 'PROT_CODEX_BIN' }

function knownPaths(provider: AgentProvider): string[] {
  if (provider === 'claude') {
    return [join(homedir(), '.local/bin/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude']
  }
  return ['/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex', '/Applications/Codex.app/Contents/Resources/codex']
}

export const PERMISSIONS: Record<AgentProvider, AgentPermissionOption[]> = {
  claude: [
    { id: 'auto', label: 'Auto', hint: 'A classifier approves safe actions' },
    { id: 'acceptEdits', label: 'Accept edits', hint: 'Edits allowed; commands that need approval are denied' },
    { id: 'plan', label: 'Plan', hint: 'Read-only, proposes a plan' },
    { id: 'bypassPermissions', label: 'Bypass', hint: 'No checks' }
  ],
  codex: [
    { id: 'auto', label: 'Auto', hint: 'Approval requests are reviewed automatically in the workspace-write sandbox' },
    { id: 'workspace-write', label: 'Workspace write', hint: 'Edits in the workspace; no approvals' },
    { id: 'read-only', label: 'Read-only', hint: 'Reads only' },
    { id: 'full', label: 'Full access', hint: 'No sandbox and no approvals' }
  ]
}

export const DEFAULT_PERMISSION: Record<AgentProvider, string> = { claude: 'auto', codex: 'auto' }

const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

export const CLAUDE_MODELS: AgentModelOption[] = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: CLAUDE_EFFORTS, defaultEffort: 'high' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', efforts: CLAUDE_EFFORTS, defaultEffort: 'high' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5', efforts: CLAUDE_EFFORTS, defaultEffort: 'high' },
  { id: 'claude-fable-5-1', label: 'Fable 5.1', efforts: CLAUDE_EFFORTS, defaultEffort: 'high' }
]

export function claudeConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
}

export function codexHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.CODEX_HOME || join(homedir(), '.codex')
}

type RunResult = { code: number | null; stdout: string; stderr: string }

export function run(file: string, args: string[], env: NodeJS.ProcessEnv, timeout = PROBE_TIMEOUT_MS): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(file, args, { env, timeout, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      let code: number | null = 0
      if (error) code = typeof error.code === 'number' ? error.code : null
      resolve({ code, stdout: String(stdout), stderr: String(stderr) })
    })
  })
}

function fallbackPath(): string {
  const extra = ['/opt/homebrew/bin', '/usr/local/bin', join(homedir(), '.local/bin')].join(delimiter)
  return process.env.PATH ? `${process.env.PATH}${delimiter}${extra}` : extra
}

export function parseShellPath(stdout: string): string | null {
  const start = stdout.indexOf(PATH_MARK)
  if (start === -1) return null
  const end = stdout.indexOf(PATH_MARK, start + PATH_MARK.length)
  if (end === -1) return null
  const value = stdout.slice(start + PATH_MARK.length, end).trim()
  return value === '' ? null : value
}

async function readLoginShellPath(): Promise<string> {
  const shell = process.env.SHELL || '/bin/zsh'
  const result = await run(shell, ['-ilc', `printf '${PATH_MARK}%s${PATH_MARK}' "$PATH"`], process.env, 30_000)
  return parseShellPath(result.stdout) ?? fallbackPath()
}

let loginPath: Promise<string> | null = null

// Apps started from Finder get a minimal PATH; children get the login shell's instead.
export function loginShellPath(): Promise<string> {
  loginPath ??= readLoginShellPath()
  return loginPath
}

export async function childEnv(): Promise<NodeJS.ProcessEnv> {
  return { ...process.env, PATH: await loginShellPath() }
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

export async function findOnPath(name: string, pathEnv: string): Promise<string | null> {
  for (const dir of pathEnv.split(delimiter)) {
    if (dir === '') continue
    const candidate = join(dir, name)
    if (await isExecutable(candidate)) return candidate
  }
  return null
}

export async function findBinary(provider: AgentProvider, pathEnv: string, env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  const override = env[ENV_OVERRIDES[provider]]
  if (override) return (await isExecutable(override)) ? override : null
  const onPath = await findOnPath(BINARY_NAMES[provider], pathEnv)
  if (onPath) return onPath
  for (const candidate of knownPaths(provider)) {
    if (await isExecutable(candidate)) return candidate
  }
  return null
}

export function parseVersion(output: string): string | null {
  const match = /\d+\.\d+\.\d+[^\s)]*/.exec(output)
  return match ? match[0] : null
}

export type SignIn = { signedIn: boolean; account: string | null }

// Only loggedIn and authMethod are read; the rest of the status (email, org) is ignored.
export function parseClaudeAuthStatus(stdout: string): SignIn {
  try {
    const raw = JSON.parse(stdout) as { loggedIn?: unknown; authMethod?: unknown }
    return {
      signedIn: raw.loggedIn === true,
      account: typeof raw.authMethod === 'string' ? raw.authMethod : null
    }
  } catch {
    return { signedIn: false, account: null }
  }
}

export function parseCodexLoginStatus(output: string): SignIn {
  if (/not logged in/i.test(output)) return { signedIn: false, account: null }
  const match = /logged in using (.+)/i.exec(output)
  if (match && match[1]) return { signedIn: true, account: match[1].trim() }
  if (/logged in/i.test(output)) return { signedIn: true, account: null }
  return { signedIn: false, account: null }
}

export async function probeVersion(binary: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  const result = await run(binary, ['--version'], env)
  return parseVersion(result.stdout + result.stderr)
}

export async function probeSignIn(provider: AgentProvider, binary: string, env: NodeJS.ProcessEnv): Promise<SignIn> {
  if (provider === 'claude') {
    const result = await run(binary, ['auth', 'status'], env)
    return parseClaudeAuthStatus(result.stdout)
  }
  const result = await run(binary, ['login', 'status'], env)
  return parseCodexLoginStatus(`${result.stdout}\n${result.stderr}`)
}

export type ModelDefaults = { model: string; effort: string }

export async function claudeDefaults(configDir: string): Promise<ModelDefaults> {
  let model = CLAUDE_MODELS[0]!.id
  let effort = 'high'
  try {
    const raw = JSON.parse(await readFile(join(configDir, 'settings.json'), 'utf8')) as { model?: unknown; effortLevel?: unknown }
    if (typeof raw.model === 'string' && raw.model.trim() !== '') model = raw.model.trim()
    if (typeof raw.effortLevel === 'string' && CLAUDE_EFFORTS.includes(raw.effortLevel)) effort = raw.effortLevel
  } catch {
    // No settings file: the CLI's own defaults.
  }
  return { model, effort }
}

// The settings model can be an alias such as "opus[1m]"; it is offered as-is next to the static list.
export function claudeModels(defaults: ModelDefaults): AgentModelOption[] {
  const models = [...CLAUDE_MODELS]
  if (!models.some((model) => model.id === defaults.model)) {
    models.unshift({ id: defaults.model, label: defaults.model, efforts: CLAUDE_EFFORTS, defaultEffort: defaults.effort })
  }
  return models
}

type RawCodexModel = {
  slug?: unknown
  display_name?: unknown
  visibility?: unknown
  default_reasoning_level?: unknown
  supported_reasoning_levels?: unknown
  priority?: unknown
}

export function parseCodexModels(raw: unknown): AgentModelOption[] {
  const list = (raw as { models?: unknown } | null)?.models
  if (!Array.isArray(list)) return []
  const ranked: { priority: number; option: AgentModelOption }[] = []
  for (const item of list as RawCodexModel[]) {
    if (item.visibility !== 'list' || typeof item.slug !== 'string') continue
    const efforts: string[] = []
    if (Array.isArray(item.supported_reasoning_levels)) {
      for (const level of item.supported_reasoning_levels as { effort?: unknown }[]) {
        if (typeof level.effort === 'string') efforts.push(level.effort)
      }
    }
    const fallback = efforts.includes('medium') ? 'medium' : (efforts[0] ?? 'medium')
    ranked.push({
      priority: typeof item.priority === 'number' ? item.priority : Number.MAX_SAFE_INTEGER,
      option: {
        id: item.slug,
        label: typeof item.display_name === 'string' ? item.display_name : item.slug,
        efforts,
        defaultEffort: typeof item.default_reasoning_level === 'string' ? item.default_reasoning_level : fallback
      }
    })
  }
  ranked.sort((a, b) => a.priority - b.priority)
  return ranked.map((entry) => entry.option)
}

// Reads top-level `key = "value"` pairs only; tables start at the first [section].
export function parseTopLevelToml(text: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('[')) break
    const match = /^([A-Za-z0-9_-]+)\s*=\s*"([^"]*)"/.exec(trimmed)
    if (match && match[1] && match[2] !== undefined) values[match[1]] = match[2]
  }
  return values
}

export async function codexModelsAndDefaults(home: string): Promise<{ models: AgentModelOption[]; defaults: ModelDefaults }> {
  let models: AgentModelOption[] = []
  try {
    models = parseCodexModels(JSON.parse(await readFile(join(home, 'models_cache.json'), 'utf8')))
  } catch {
    models = []
  }
  let config: Record<string, string> = {}
  try {
    config = parseTopLevelToml(await readFile(join(home, 'config.toml'), 'utf8'))
  } catch {
    config = {}
  }
  const model = config.model ?? models[0]?.id ?? 'gpt-5.5'
  let option = models.find((entry) => entry.id === model)
  if (!option) {
    option = { id: model, label: model, efforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'medium' }
    models.unshift(option)
  }
  const effort = config.model_reasoning_effort ?? option.defaultEffort
  return { models, defaults: { model, effort } }
}

export type TurnMode = 'first' | 'resume' | 'fork'

export type TurnSpec = {
  mode: TurnMode
  prompt: string
  model: string
  effort: string
  permission: string
  cwd: string
  // Claude: the new session id on a first turn, else the session to resume or fork. Codex: the thread to resume or fork.
  sessionId: string | null
}

export function claudeArgs(spec: TurnSpec): string[] {
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--model', spec.model, '--effort', spec.effort, '--permission-mode', spec.permission]
  if (!spec.sessionId) throw new Error('A Claude turn needs a session id')
  if (spec.mode === 'first') args.push('--session-id', spec.sessionId)
  else args.push('--resume', spec.sessionId)
  if (spec.mode === 'fork') args.push('--fork-session')
  // `--` keeps a prompt that starts with `-` from being read as an option.
  args.push('--', spec.prompt)
  return args
}

export function codexPermissionArgs(permission: string): string[] {
  if (permission === 'auto') return ['--approve-for-me']
  if (permission === 'workspace-write') return ['-s', 'workspace-write']
  if (permission === 'read-only') return ['-s', 'read-only']
  if (permission === 'full') return ['--dangerously-bypass-approvals-and-sandbox']
  throw new Error(`Unknown Codex permission ${permission}`)
}

// -s, -C and --approve-for-me only parse before the resume/fork subcommand, so every option goes first.
export function codexArgs(spec: TurnSpec): string[] {
  const args = [
    'exec',
    '--json',
    '-m',
    spec.model,
    '-c',
    `model_reasoning_effort="${spec.effort}"`,
    ...codexPermissionArgs(spec.permission),
    '-C',
    spec.cwd,
    '--skip-git-repo-check'
  ]
  if (spec.mode !== 'first') {
    if (!spec.sessionId) throw new Error('A Codex follow-up needs a thread id')
    args.push(spec.mode === 'fork' ? 'fork' : 'resume', spec.sessionId)
  }
  args.push('--', spec.prompt)
  return args
}

export function turnArgs(provider: AgentProvider, spec: TurnSpec): string[] {
  return provider === 'claude' ? claudeArgs(spec) : codexArgs(spec)
}
