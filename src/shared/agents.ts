export const AGENT_PROVIDERS = ['claude', 'codex'] as const
export type AgentProvider = (typeof AGENT_PROVIDERS)[number]

export const PROVIDER_NAMES: Record<AgentProvider, string> = { claude: 'Claude Code', codex: 'Codex' }

export type AgentModelOption = {
  id: string
  label: string
  efforts: string[]
  defaultEffort: string
}

export type AgentPermissionOption = { id: string; label: string; hint: string }

export type UsageWindow = {
  label: string
  usedPercent: number
  // Epoch seconds.
  resetsAt: number | null
}

export type ProviderInfo = {
  provider: AgentProvider
  installed: boolean
  binary: string | null
  version: string | null
  signedIn: boolean
  // How the CLI is signed in, as the CLI reports it, e.g. "claude.ai" or "ChatGPT".
  account: string | null
  models: AgentModelOption[]
  // The model and effort the provider's own app is configured with.
  defaultModel: string
  defaultEffort: string
  permissions: AgentPermissionOption[]
  defaultPermission: string
  // Latest subscription limits seen in any session's events; empty until one reports.
  usage: UsageWindow[]
}

// prot: started from prot. claude-app / codex-app: found on disk, started by the Claude or Codex apps or CLIs.
export type AgentSource = 'prot' | 'claude-app' | 'codex-app'

export type AgentStatus = 'running' | 'idle' | 'failed' | 'stopped'

export type AgentWorktree = { path: string; branch: string; base: string }

export type AgentPrState = 'open' | 'draft' | 'merged' | 'closed'

export type AgentPr = {
  owner: string
  repo: string
  number: number
  title: string
  state: AgentPrState
  url: string
}

export type AgentChanges = { files: number; additions: number; deletions: number }

export type AgentSummary = {
  id: string
  source: AgentSource
  provider: AgentProvider
  title: string
  repoPath: string | null
  repoName: string | null
  cwd: string
  branch: string | null
  worktree: AgentWorktree | null
  model: string | null
  effort: string | null
  permission: string | null
  sessionId: string | null
  status: AgentStatus
  // When the current turn started; null while not running.
  turnStartedAt: string | null
  // True when the last turn finished after the user last opened the agent.
  unread: boolean
  createdAt: string
  updatedAt: string
  lastMessage: string | null
  pr: AgentPr | null
  changes: AgentChanges | null
  costUsd: number | null
}

export type AgentEvent =
  // The agent system prompt version sent with the agent's turns.
  | { kind: 'system'; id: string; at: string; name: string; hash: string; text: string }
  | { kind: 'user'; id: string; at: string; text: string }
  | { kind: 'assistant'; id: string; at: string; text: string }
  | { kind: 'thinking'; id: string; at: string; text: string }
  | {
      kind: 'tool'
      id: string
      at: string
      name: string
      // One line: the command, file path or query the tool ran on.
      summary: string
      output: string | null
      status: 'running' | 'ok' | 'error'
    }
  | { kind: 'error'; id: string; at: string; text: string }
  | {
      kind: 'turn'
      id: string
      at: string
      durationMs: number | null
      costUsd: number | null
      inputTokens: number | null
      outputTokens: number | null
    }

export type AgentDetail = AgentSummary & { transcript: AgentEvent[] }

export type AgentStartInput = {
  provider: AgentProvider
  repoPath: string
  prompt: string
  model: string
  effort: string
  permission: string
  // True runs the agent in a new git worktree on a new branch; false runs it in the repo checkout itself.
  worktree: boolean
}

// The folder holding the user's skills and AGENTS.md; file is its topmost AGENTS.md.
export type AgentInstructions = { folder: string | null; file: string | null }

export type AgentRepo = { path: string; name: string; branch: string | null }

export type AgentsState = {
  agents: AgentSummary[]
  repos: AgentRepo[]
  providers: ProviderInfo[]
}

export type AgentFileStatus = 'added' | 'modified' | 'removed' | 'renamed' | 'untracked'

export type AgentFileChange = {
  path: string
  status: AgentFileStatus
  additions: number
  deletions: number
}

export type AgentOpenTarget = 'finder' | 'editor' | 'terminal'

// Pushed whenever an agent's summary changes; event is set when the change appended a transcript event.
export type AgentChange = { agent: AgentSummary; event: AgentEvent | null }

// Pushed when a turn or a session file reports new subscription limits.
export type AgentUsageChange = { provider: AgentProvider; usage: UsageWindow[] }
