import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type ProtApi } from '@shared/ipc'
import type { ChatEvent, InboxState } from '@shared/types'

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
    onChange: (cb) => subscribe<InboxState>(IPC.inboxChanged, cb)
  },
  pulls: {
    get: (ref) => ipcRenderer.invoke(IPC.pullGet, ref),
    file: (ref, path, sha) => ipcRenderer.invoke(IPC.pullFile, ref, path, sha),
    tree: (ref, sha) => ipcRenderer.invoke(IPC.pullTree, ref, sha),
    submitReview: (ref, input) => ipcRenderer.invoke(IPC.pullReview, ref, input),
    comment: (ref, body) => ipcRenderer.invoke(IPC.pullComment, ref, body)
  },
  guide: {
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
  keys: {
    get: () => ipcRenderer.invoke(IPC.keysGet),
    setAnthropic: (key) => ipcRenderer.invoke(IPC.keysSetAnthropic, key)
  },
  openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url)
}

contextBridge.exposeInMainWorld('prot', api)
