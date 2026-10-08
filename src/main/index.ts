import { join } from 'node:path'
import { app, BrowserWindow, protocol } from 'electron'
import { IPC } from '@shared/ipc'
import { AgentManager } from './agents/manager'
import { AgentStore } from './agents/store'
import { ATTACHMENT_SCHEME, AttachmentService, serveAttachment } from './attachments'
import { AuthService } from './auth'
import { ChatService } from './chat'
import { CHAT_SYSTEM_PROMPT } from './chat-context'
import { AGENT_SYSTEM_PROMPT } from '@shared/output-style'
import { CheckedOutStore } from './checked-out'
import { CodeIndexService } from './code-index/service'
import { GitHubClient } from './github'
import { SYSTEM_PROMPT } from '@shared/guide'
import type { PullState } from '@shared/types'
import { GuideService } from './guide-ai'
import { registerIpc } from './ipc'
import { installMenu } from './menu'
import { InboxPoller } from './poller'
import { PromptStore } from './prompt-store'
import { PullCache } from './pull-cache'
import { PullService } from './pulls'
import { SecretsStore } from './secrets'
import { SettingsStore } from './settings'
import { broadcast, createMainWindow, focusMainWindow } from './window'

const CACHE_SWEEP_MS = 6 * 60 * 60 * 1000

app.setName('prot')
protocol.registerSchemesAsPrivileged([
  { scheme: ATTACHMENT_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', focusMainWindow)
  void app.whenReady().then(boot)
}

function boot(): void {
  if (!app.isPackaged) app.dock?.setIcon(join(import.meta.dirname, '../../resources/icon.png'))

  const githubApiUrl = process.env.GITHUB_API_URL ?? 'https://api.github.com'
  const settings = new SettingsStore()
  const secrets = new SecretsStore()
  const auth = new AuthService(secrets, (token) => new GitHubClient(token, githubApiUrl.replace(/\/+$/, '')))
  const userData = app.getPath('userData')
  const checkedOut = new CheckedOutStore(join(userData, 'checked-out.json'))
  const poller = new InboxPoller(auth, settings, checkedOut)
  const attachmentsRoot = join(userData, 'attachments')
  const attachments = new AttachmentService(
    attachmentsRoot,
    (url) => (auth.user() ? auth.client().attachmentHeaders(url) : {}),
    (ref) => broadcast(IPC.pullAttachmentsChanged, ref)
  )
  const pulls = new PullService(
    auth,
    (ref) => poller.latestUpdatedAt(ref),
    (ref, detail, links) => cache.fetched(ref, detail, links)
  )
  const code = new CodeIndexService(pulls)
  const prompts = new PromptStore(join(userData, 'prompts.json'), { guide: SYSTEM_PROMPT, chat: CHAT_SYSTEM_PROMPT, agent: AGENT_SYSTEM_PROMPT })
  const guide = new GuideService(secrets, settings, prompts, pulls, code, join(userData, 'guides'))
  const cache = new PullCache(guide, attachments)
  const chat = new ChatService(secrets, settings, pulls, prompts, broadcast)
  const agents = new AgentManager(new AgentStore(userData), auth, settings, prompts, broadcast)
  agents.boot()
  app.on('before-quit', () => agents.shutdown())
  protocol.handle(ATTACHMENT_SCHEME, (request) => serveAttachment(attachmentsRoot, request.url))

  poller.onClosed((pull) => {
    cache.forget(pull.ref).catch((error: unknown) => console.error('Could not delete the cache for a closed PR', error))
  })
  const sweepCache = () => {
    if (!auth.user()) return
    cache
      .sweep(async (refs) => {
        const states = new Map<string, PullState | null>()
        for (const [key, pull] of await auth.client().getPulls(refs, 'manual')) states.set(key, pull && pull.state)
        return states
      })
      .catch((error: unknown) => console.error('PR cache sweep failed; kept everything', error))
  }
  let sweepTimer: NodeJS.Timeout | null = null

  auth.onChange((state) => {
    if (sweepTimer) clearInterval(sweepTimer)
    sweepTimer = null
    if (state.status === 'signed_in') {
      poller.start()
      sweepCache()
      sweepTimer = setInterval(sweepCache, CACHE_SWEEP_MS)
    } else poller.stop()
  })
  app.on('browser-window-focus', () => poller.refreshIfStale())

  registerIpc({ auth, poller, pulls, guide, attachments, cache, code, chat, settings, secrets, prompts, agents })
  installMenu()
  auth.restore()
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
