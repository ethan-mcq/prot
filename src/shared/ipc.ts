import type {
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
    onChange(cb: (state: InboxState) => void): () => void
  }
  pulls: {
    get(ref: PullRef): Promise<PullDetail>
    file(ref: PullRef, path: string, sha: string): Promise<string>
    tree(ref: PullRef, sha: string): Promise<string[]>
    submitReview(ref: PullRef, input: ReviewInput): Promise<void>
    comment(ref: PullRef, body: string): Promise<void>
    reply(ref: PullRef, commentId: number, body: string): Promise<ReviewComment>
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
  keys: {
    get(): Promise<KeysState>
    setAnthropic(key: string | null): Promise<KeysState>
  }
  openExternal(url: string): Promise<void>
}

export const IPC = {
  authGet: 'auth:get',
  authGh: 'auth:gh',
  authToken: 'auth:token',
  authSignOut: 'auth:sign-out',
  inboxGet: 'inbox:get',
  inboxRefresh: 'inbox:refresh',
  inboxChanged: 'inbox:changed',
  pullGet: 'pull:get',
  pullFile: 'pull:file',
  pullTree: 'pull:tree',
  pullReview: 'pull:review',
  pullComment: 'pull:comment',
  pullReply: 'pull:reply',
  guideStory: 'guide:story',
  guideAi: 'guide:ai',
  aiChat: 'ai:chat',
  aiCancel: 'ai:cancel',
  aiEvent: 'ai:event',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  keysGet: 'keys:get',
  keysSetAnthropic: 'keys:set-anthropic',
  openExternal: 'open-external'
} as const
