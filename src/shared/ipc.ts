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
  openExternal: 'open-external',
  copyLink: 'copy-link'
} as const
