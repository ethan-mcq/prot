import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import { AuthService } from './auth'
import { ChatService } from './chat'
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
import { PullService } from './pulls'
import { SecretsStore } from './secrets'
import { SettingsStore } from './settings'
import { broadcast, createMainWindow, focusMainWindow } from './window'

const GUIDE_SWEEP_MS = 6 * 60 * 60 * 1000

app.setName('prot')

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
  const checkedOut = new CheckedOutStore(join(app.getPath('userData'), 'checked-out.json'))
  const poller = new InboxPoller(auth, settings, checkedOut)
  const pulls = new PullService(auth, (ref) => poller.latestUpdatedAt(ref))
  const code = new CodeIndexService(pulls)
  const prompts = new PromptStore(join(app.getPath('userData'), 'prompts.json'), SYSTEM_PROMPT)
  const guide = new GuideService(secrets, settings, prompts, pulls, code, join(app.getPath('userData'), 'guides'))
  const chat = new ChatService(secrets, settings, pulls, broadcast)

  poller.onClosed((pull) => {
    guide.forget(pull.ref).catch((error: unknown) => console.error('Could not delete the guide for a closed PR', error))
  })
  const sweepGuides = () => {
    if (!auth.user()) return
    guide
      .sweep(async (refs) => {
        const states = new Map<string, PullState | null>()
        for (const [key, pull] of await auth.client().getPulls(refs, 'manual')) states.set(key, pull && pull.state)
        return states
      })
      .catch((error: unknown) => console.error('Guide sweep failed; kept every guide', error))
  }
  let sweepTimer: NodeJS.Timeout | null = null

  auth.onChange((state) => {
    if (sweepTimer) clearInterval(sweepTimer)
    sweepTimer = null
    if (state.status === 'signed_in') {
      poller.start()
      sweepGuides()
      sweepTimer = setInterval(sweepGuides, GUIDE_SWEEP_MS)
    } else poller.stop()
  })
  app.on('browser-window-focus', () => poller.refreshIfStale())

  registerIpc({ auth, poller, pulls, guide, code, chat, settings, secrets, prompts })
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
