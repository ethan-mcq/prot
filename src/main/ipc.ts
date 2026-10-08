import { clipboard, ipcMain, shell } from 'electron'
import { IPC } from '@shared/ipc'
import type { AgentManager } from './agents/manager'
import type { AttachmentService } from './attachments'
import type { AuthService } from './auth'
import type { ChatService } from './chat'
import type { CodeIndexService } from './code-index/service'
import type { GuideService } from './guide-ai'
import type { InboxPoller } from './poller'
import type { PromptStore } from './prompt-store'
import type { PullCache } from './pull-cache'
import type { PullService } from './pulls'
import type { SecretsStore } from './secrets'
import type { SettingsStore } from './settings'
import { parseSettingsPatch } from './settings-validate'
import {
  parseAgentDiffPath,
  parseAgentId,
  parseAgentOpenTarget,
  parseAgentPrompt,
  parseAgentStartInput,
  parseAnthropicKey,
  parseChatRequest,
  parseCommentId,
  parseAttachmentUrl,
  parseHttpsUrl,
  parsePromptHash,
  parsePromptKind,
  parsePromptName,
  parsePromptText,
  parsePullRef,
  parseReplyBody,
  parseReviewInput,
  parseSha,
  parseToken
} from './validate'

export type Services = {
  auth: AuthService
  poller: InboxPoller
  pulls: PullService
  guide: GuideService
  attachments: AttachmentService
  cache: PullCache
  code: CodeIndexService
  chat: ChatService
  settings: SettingsStore
  secrets: SecretsStore
  prompts: PromptStore
  agents: AgentManager
}

export function registerIpc(services: Services): void {
  const { auth, poller, pulls, guide, attachments, cache, code, chat, settings, secrets, prompts, agents } = services

  ipcMain.handle(IPC.authGet, () => auth.get())
  ipcMain.handle(IPC.authGh, () => auth.signInWithGh())
  ipcMain.handle(IPC.authToken, (_event, token: unknown) => auth.signInWithToken(parseToken(token)))
  ipcMain.handle(IPC.authSignOut, () => auth.signOut())

  ipcMain.handle(IPC.inboxGet, () => poller.get())
  ipcMain.handle(IPC.inboxRefresh, () => poller.refresh())
  ipcMain.handle(IPC.inboxCheckout, (_event, ref: unknown) => poller.checkout(parsePullRef(ref)))
  ipcMain.handle(IPC.inboxForget, (_event, ref: unknown) => poller.forget(parsePullRef(ref)))

  ipcMain.handle(IPC.pullGet, (_event, ref: unknown) => pulls.fetch(parsePullRef(ref)))
  ipcMain.handle(IPC.pullFile, (_event, ref: unknown, path: unknown, sha: unknown) => {
    if (typeof path !== 'string' || path === '') throw new Error('path must be a non-empty string')
    return pulls.getFile(parsePullRef(ref), path, parseSha(sha))
  })
  ipcMain.handle(IPC.pullTree, (_event, ref: unknown, sha: unknown) =>
    pulls.getTree(parsePullRef(ref), parseSha(sha))
  )
  ipcMain.handle(IPC.pullReview, async (_event, rawRef: unknown, rawInput: unknown) => {
    const ref = parsePullRef(rawRef)
    const input = parseReviewInput(rawInput)
    await pulls.submitReview(ref, input)
    await cache.reviewed(ref, input)
  })
  ipcMain.handle(IPC.pullComment, (_event, ref: unknown, body: unknown) => {
    if (typeof body !== 'string' || body.trim() === '') throw new Error('Comment must not be empty')
    return pulls.comment(parsePullRef(ref), body)
  })
  ipcMain.handle(IPC.pullReply, (_event, ref: unknown, commentId: unknown, body: unknown) =>
    pulls.reply(parsePullRef(ref), parseCommentId(commentId), parseReplyBody(body))
  )

  ipcMain.handle(IPC.pullAttachments, (_event, ref: unknown) => attachments.list(parsePullRef(ref)))
  ipcMain.handle(IPC.pullOpenAttachment, async (_event, rawRef: unknown, rawUrl: unknown) => {
    const target = await attachments.openTarget(parsePullRef(rawRef), parseAttachmentUrl(rawUrl))
    if ('url' in target) return shell.openExternal(parseHttpsUrl(target.url))
    const failure = await shell.openPath(target.path)
    if (failure !== '') throw new Error(failure)
  })

  ipcMain.handle(IPC.guideStory, (_event, ref: unknown) => code.story(parsePullRef(ref)))
  ipcMain.handle(IPC.guideAi, (_event, ref: unknown, refresh: unknown) =>
    guide.get(parsePullRef(ref), refresh === true)
  )

  ipcMain.handle(IPC.aiChat, (_event, req: unknown) => {
    chat.start(parseChatRequest(req))
  })
  ipcMain.handle(IPC.aiCancel, (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('id must be a string')
    chat.cancel(id)
  })

  ipcMain.handle(IPC.settingsGet, () => settings.get())
  ipcMain.handle(IPC.settingsSet, (_event, patch: unknown) =>
    settings.set(parseSettingsPatch(patch))
  )

  ipcMain.handle(IPC.promptsGet, (_event, kind: unknown) => prompts.get(parsePromptKind(kind)))
  ipcMain.handle(IPC.promptsSave, (_event, kind: unknown, text: unknown) => prompts.save(parsePromptKind(kind), parsePromptText(text)))
  ipcMain.handle(IPC.promptsRename, (_event, kind: unknown, hash: unknown, name: unknown) =>
    prompts.rename(parsePromptKind(kind), parsePromptHash(hash), parsePromptName(name))
  )
  ipcMain.handle(IPC.promptsSetLive, (_event, kind: unknown, hash: unknown) => prompts.setLive(parsePromptKind(kind), parsePromptHash(hash)))
  ipcMain.handle(IPC.promptsRemove, (_event, kind: unknown, hash: unknown) => prompts.remove(parsePromptKind(kind), parsePromptHash(hash)))

  ipcMain.handle(IPC.keysGet, async () => ({ anthropic: await secrets.hasAnthropicKey() }))
  ipcMain.handle(IPC.keysSetAnthropic, async (_event, key: unknown) => {
    await secrets.update({ anthropicKey: parseAnthropicKey(key) })
    return { anthropic: await secrets.hasAnthropicKey() }
  })

  ipcMain.handle(IPC.agentsState, () => agents.state())
  ipcMain.handle(IPC.agentsRefresh, () => agents.refresh())
  ipcMain.handle(IPC.agentsStart, (_event, input: unknown) => agents.start(parseAgentStartInput(input)))
  ipcMain.handle(IPC.agentsGet, (_event, id: unknown) => agents.get(parseAgentId(id)))
  ipcMain.handle(IPC.agentsSend, (_event, id: unknown, prompt: unknown) => agents.send(parseAgentId(id), parseAgentPrompt(prompt)))
  ipcMain.handle(IPC.agentsStop, (_event, id: unknown) => agents.stop(parseAgentId(id)))
  ipcMain.handle(IPC.agentsMarkRead, (_event, id: unknown) => agents.markRead(parseAgentId(id)))
  ipcMain.handle(IPC.agentsArchive, (_event, id: unknown) => agents.archive(parseAgentId(id)))
  ipcMain.handle(IPC.agentsRemoveWorktree, (_event, id: unknown) => agents.removeWorktree(parseAgentId(id)))
  ipcMain.handle(IPC.agentsChanges, (_event, id: unknown) => agents.changes(parseAgentId(id)))
  ipcMain.handle(IPC.agentsDiff, (_event, id: unknown, path: unknown) => agents.diff(parseAgentId(id), parseAgentDiffPath(path)))
  ipcMain.handle(IPC.agentsAddRepo, () => agents.addRepo())
  ipcMain.handle(IPC.agentsOpen, (_event, id: unknown, target: unknown) => agents.open(parseAgentId(id), parseAgentOpenTarget(target)))

  ipcMain.handle(IPC.openExternal, (_event, url: unknown) => shell.openExternal(parseHttpsUrl(url)))
  ipcMain.handle(IPC.copyLink, (_event, url: unknown) => clipboard.writeText(parseHttpsUrl(url)))
}
