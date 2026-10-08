import type {
  Attachment,
  AuthState,
  ChatEvent,
  ChatRequest,
  Guide,
  InboxState,
  KeysState,
  PullDetail,
  PullRef,
  ReviewComment,
  ReviewInput,
  Settings
} from './types'
import type { PromptKind, PromptLibrary, PromptVersion } from './prompts'
import type {
  AgentChange,
  AgentDetail,
  AgentFileChange,
  AgentAttachment,
  AgentCommand,
  AgentInstructions,
  AgentOpenTarget,
  AgentRepo,
  AgentStartInput,
  AgentSummary,
  AgentsState,
  AgentUsageChange
} from './agents'

export interface ProtApi {
  auth: {
    get(): Promise<AuthState>
    signInWithGh(): Promise<AuthState>
    signInWithToken(token: string): Promise<AuthState>
    signOut(): Promise<AuthState>
  }
  inbox: {
    get(): Promise<InboxState>
    refresh(): Promise<InboxState>
    // Resolves the ref to open: the inbox's own copy when the PR is already listed, else the newly checked-out PR.
    checkout(ref: PullRef): Promise<PullRef>
    forget(ref: PullRef): Promise<void>
    onChange(cb: (state: InboxState) => void): () => void
  }
  pulls: {
    get(ref: PullRef): Promise<PullDetail>
    file(ref: PullRef, path: string, sha: string): Promise<string>
    tree(ref: PullRef, sha: string): Promise<string[]>
    submitReview(ref: PullRef, input: ReviewInput): Promise<void>
    comment(ref: PullRef, body: string): Promise<void>
    reply(ref: PullRef, commentId: number, body: string): Promise<ReviewComment>
    // Images, videos and files attached to the PR description. Imports run in the background.
    attachments(ref: PullRef): Promise<Attachment[]>
    // Fires when an import for the PR settles; list again to see the result.
    onAttachments(cb: (ref: PullRef) => void): () => void
    // Opens a stored file with the system default app, or the original URL when it was not stored.
    openAttachment(ref: PullRef, url: string): Promise<void>
  }
  guide: {
    story(ref: PullRef): Promise<Guide>
    ai(ref: PullRef, refresh: boolean): Promise<Guide>
  }
  ai: {
    chat(req: ChatRequest): Promise<void>
    cancel(id: string): Promise<void>
    onEvent(cb: (event: ChatEvent) => void): () => void
  }
  settings: {
    get(): Promise<Settings>
    set(patch: Partial<Settings>): Promise<Settings>
  }
  prompts: {
    get(kind: PromptKind): Promise<PromptLibrary>
    save(kind: PromptKind, text: string): Promise<{ library: PromptLibrary; version: PromptVersion }>
    rename(kind: PromptKind, hash: string, name: string): Promise<PromptLibrary>
    setLive(kind: PromptKind, hash: string): Promise<PromptLibrary>
    remove(kind: PromptKind, hash: string): Promise<PromptLibrary>
  }
  keys: {
    get(): Promise<KeysState>
    setAnthropic(key: string | null): Promise<KeysState>
  }
  agents: {
    state(): Promise<AgentsState>
    // Re-detects the CLIs, sign-in, models and sessions started outside prot.
    refresh(): Promise<AgentsState>
    start(input: AgentStartInput): Promise<AgentSummary>
    get(id: string): Promise<AgentDetail>
    // Sends a follow-up turn. On a session started outside prot this forks it into a new prot agent and resolves that agent.
    send(id: string, prompt: string, attachments: AgentAttachment[]): Promise<AgentSummary>
    stop(id: string): Promise<void>
    markRead(id: string): Promise<void>
    // Hides the agent from the dash; its worktree and branch stay.
    archive(id: string): Promise<void>
    // Removes the agent's worktree directory; the branch stays.
    removeWorktree(id: string): Promise<void>
    changes(id: string): Promise<AgentFileChange[]>
    diff(id: string, path: string): Promise<string>
    // Opens a folder picker and adds the chosen folder (its repo root when inside a git repo); null when cancelled.
    addFolder(): Promise<AgentRepo | null>
    // The skills and commands either CLI would load in the folder, plus the skills folder's own.
    commands(folder: string): Promise<AgentCommand[]>
    // A file dialog; copies the picked files under userData. Empty when cancelled.
    pickAttachments(): Promise<AgentAttachment[]>
    // Saves pasted or dropped bytes as an attachment.
    saveAttachment(name: string, data: Uint8Array): Promise<AgentAttachment>
    open(id: string, target: AgentOpenTarget): Promise<void>
    instructions(): Promise<AgentInstructions>
    chooseInstructionsFolder(): Promise<AgentInstructions>
    createAgentsMd(): Promise<AgentInstructions>
    // Saves the folder's AGENTS.md as a new agent prompt version and makes it live.
    importAgentsMd(): Promise<PromptLibrary>
    onChange(cb: (change: AgentChange) => void): () => void
    onUsage(cb: (change: AgentUsageChange) => void): () => void
  }
  openExternal(url: string): Promise<void>
  copyLink(url: string): Promise<void>
}

export const IPC = {
  authGet: 'auth:get',
  authGh: 'auth:gh',
  authToken: 'auth:token',
  authSignOut: 'auth:sign-out',
  inboxGet: 'inbox:get',
  inboxRefresh: 'inbox:refresh',
  inboxCheckout: 'inbox:checkout',
  inboxForget: 'inbox:forget',
  inboxChanged: 'inbox:changed',
  pullGet: 'pull:get',
  pullFile: 'pull:file',
  pullTree: 'pull:tree',
  pullReview: 'pull:review',
  pullComment: 'pull:comment',
  pullReply: 'pull:reply',
  pullAttachments: 'pull:attachments',
  pullAttachmentsChanged: 'pull:attachments-changed',
  pullOpenAttachment: 'pull:open-attachment',
  guideStory: 'guide:story',
  guideAi: 'guide:ai',
  aiChat: 'ai:chat',
  aiCancel: 'ai:cancel',
  aiEvent: 'ai:event',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  promptsGet: 'prompts:get',
  promptsSave: 'prompts:save',
  promptsRename: 'prompts:rename',
  promptsSetLive: 'prompts:set-live',
  promptsRemove: 'prompts:remove',
  keysGet: 'keys:get',
  keysSetAnthropic: 'keys:set-anthropic',
  agentsState: 'agents:state',
  agentsRefresh: 'agents:refresh',
  agentsStart: 'agents:start',
  agentsGet: 'agents:get',
  agentsSend: 'agents:send',
  agentsStop: 'agents:stop',
  agentsMarkRead: 'agents:mark-read',
  agentsArchive: 'agents:archive',
  agentsRemoveWorktree: 'agents:remove-worktree',
  agentsChanges: 'agents:changes',
  agentsDiff: 'agents:diff',
  agentsAddFolder: 'agents:add-folder',
  agentsCommands: 'agents:commands',
  agentsPickAttachments: 'agents:pick-attachments',
  agentsSaveAttachment: 'agents:save-attachment',
  agentsOpen: 'agents:open',
  agentsChanged: 'agents:changed',
  agentsInstructions: 'agents:instructions',
  agentsChooseInstructions: 'agents:choose-instructions',
  agentsCreateAgentsMd: 'agents:create-agents-md',
  agentsImportAgentsMd: 'agents:import-agents-md',
  agentsUsage: 'agents:usage',
  openExternal: 'open-external',
  copyLink: 'copy-link'
} as const
