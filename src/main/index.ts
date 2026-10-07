import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import { AuthService } from './auth'
import { ChatService } from './chat'
import { GitHubClient } from './github'
import { GuideService } from './guide-ai'
import { registerIpc } from './ipc'
import { installMenu } from './menu'
import { InboxPoller } from './poller'
import { PullService } from './pulls'
import { SecretsStore } from './secrets'
import { SettingsStore } from './settings'
import { broadcast, createMainWindow, focusMainWindow } from './window'

app.setName('prot')

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', focusMainWindow)
  void app.whenReady().then(boot)
}

function boot(): void {
  if (!app.isPackaged) app.dock?.setIcon(join(app.getAppPath(), 'resources/icon.png'))

  const githubApiUrl = process.env.GITHUB_API_URL ?? 'https://api.github.com'
  const settings = new SettingsStore()
  const secrets = new SecretsStore()
  const auth = new AuthService(secrets, (token) => new GitHubClient(token, githubApiUrl.replace(/\/+$/, '')))
  const poller = new InboxPoller(auth, settings)
  const pulls = new PullService(auth, (ref) => poller.latestUpdatedAt(ref))
  const guide = new GuideService(secrets, settings, pulls, join(app.getPath('userData'), 'guides'))
  const chat = new ChatService(secrets, settings, pulls, broadcast)

  auth.onChange((state) => {
    if (state.status === 'signed_in') poller.start()
    else poller.stop()
  })
  app.on('browser-window-focus', () => poller.refreshIfStale())

  registerIpc({ auth, poller, pulls, guide, chat, settings, secrets })
  installMenu()
  auth.restore()
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
}

// macOS convention: closing the window leaves the app and its poller running.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
