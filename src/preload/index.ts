import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type ProtApi } from '@shared/ipc'
import type { AgentChange, AgentUsageChange } from '@shared/agents'
import type { ChatEvent, InboxState, PullRef } from '@shared/types'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: ProtApi = {
  auth: {
    get: () => ipcRenderer.invoke(IPC.authGet),
    signInWithGh: () => ipcRenderer.invoke(IPC.authGh),
    signInWithToken: (token) => ipcRenderer.invoke(IPC.authToken, token),
    signOut: () => ipcRenderer.invoke(IPC.authSignOut)
  },
  inbox: {
    get: () => ipcRenderer.invoke(IPC.inboxGet),
    refresh: () => ipcRenderer.invoke(IPC.inboxRefresh),
    checkout: (ref) => ipcRenderer.invoke(IPC.inboxCheckout, ref),
    forget: (ref) => ipcRenderer.invoke(IPC.inboxForget, ref),
    onChange: (cb) => subscribe<InboxState>(IPC.inboxChanged, cb)
  },
  pulls: {
    get: (ref) => ipcRenderer.invoke(IPC.pullGet, ref),
    file: (ref, path, sha) => ipcRenderer.invoke(IPC.pullFile, ref, path, sha),
    tree: (ref, sha) => ipcRenderer.invoke(IPC.pullTree, ref, sha),
    submitReview: (ref, input) => ipcRenderer.invoke(IPC.pullReview, ref, input),
    comment: (ref, body) => ipcRenderer.invoke(IPC.pullComment, ref, body),
    reply: (ref, commentId, body) => ipcRenderer.invoke(IPC.pullReply, ref, commentId, body),
    attachments: (ref) => ipcRenderer.invoke(IPC.pullAttachments, ref),
    onAttachments: (cb) => subscribe<PullRef>(IPC.pullAttachmentsChanged, cb),
    openAttachment: (ref, url) => ipcRenderer.invoke(IPC.pullOpenAttachment, ref, url)
  },
  guide: {
    story: (ref) => ipcRenderer.invoke(IPC.guideStory, ref),
    ai: (ref, refresh) => ipcRenderer.invoke(IPC.guideAi, ref, refresh)
  },
  ai: {
    chat: (req) => ipcRenderer.invoke(IPC.aiChat, req),
    cancel: (id) => ipcRenderer.invoke(IPC.aiCancel, id),
    onEvent: (cb) => subscribe<ChatEvent>(IPC.aiEvent, cb)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    set: (patch) => ipcRenderer.invoke(IPC.settingsSet, patch)
  },
  prompts: {
    get: (kind) => ipcRenderer.invoke(IPC.promptsGet, kind),
    save: (kind, text) => ipcRenderer.invoke(IPC.promptsSave, kind, text),
    rename: (kind, hash, name) => ipcRenderer.invoke(IPC.promptsRename, kind, hash, name),
    setLive: (kind, hash) => ipcRenderer.invoke(IPC.promptsSetLive, kind, hash),
    remove: (kind, hash) => ipcRenderer.invoke(IPC.promptsRemove, kind, hash)
  },
  keys: {
    get: () => ipcRenderer.invoke(IPC.keysGet),
    setAnthropic: (key) => ipcRenderer.invoke(IPC.keysSetAnthropic, key)
  },
  agents: {
    state: () => ipcRenderer.invoke(IPC.agentsState),
    refresh: () => ipcRenderer.invoke(IPC.agentsRefresh),
    start: (input) => ipcRenderer.invoke(IPC.agentsStart, input),
    get: (id) => ipcRenderer.invoke(IPC.agentsGet, id),
    send: (id, prompt) => ipcRenderer.invoke(IPC.agentsSend, id, prompt),
    stop: (id) => ipcRenderer.invoke(IPC.agentsStop, id),
    markRead: (id) => ipcRenderer.invoke(IPC.agentsMarkRead, id),
    archive: (id) => ipcRenderer.invoke(IPC.agentsArchive, id),
    removeWorktree: (id) => ipcRenderer.invoke(IPC.agentsRemoveWorktree, id),
    changes: (id) => ipcRenderer.invoke(IPC.agentsChanges, id),
    diff: (id, path) => ipcRenderer.invoke(IPC.agentsDiff, id, path),
    addRepo: () => ipcRenderer.invoke(IPC.agentsAddRepo),
    open: (id, target) => ipcRenderer.invoke(IPC.agentsOpen, id, target),
    instructions: () => ipcRenderer.invoke(IPC.agentsInstructions),
    chooseInstructionsFolder: () => ipcRenderer.invoke(IPC.agentsChooseInstructions),
    createAgentsMd: () => ipcRenderer.invoke(IPC.agentsCreateAgentsMd),
    importAgentsMd: () => ipcRenderer.invoke(IPC.agentsImportAgentsMd),
    onChange: (cb) => subscribe<AgentChange>(IPC.agentsChanged, cb),
    onUsage: (cb) => subscribe<AgentUsageChange>(IPC.agentsUsage, cb)
  },
  openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url),
  copyLink: (url) => ipcRenderer.invoke(IPC.copyLink, url)
}

contextBridge.exposeInMainWorld('prot', api)
