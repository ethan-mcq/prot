import { app, Notification } from 'electron'
import { pullKey, type InboxState, type PullRef, type PullSummary } from '@shared/types'
import { IPC } from '@shared/ipc'
import type { AuthService } from './auth'
import { GitHubError } from './github'
import { newReviewRequests } from './inbox-diff'
import type { SettingsStore } from './settings'
import { broadcast, focusMainWindow } from './window'

const STALE_AFTER_MS = 30_000
const MAX_INDIVIDUAL_NOTIFICATIONS = 3

const EMPTY_STATE: InboxState = { pulls: [], fetchedAt: null, error: null }

export class InboxPoller {
  private state: InboxState = EMPTY_STATE
  private timer: NodeJS.Timeout | null = null
  private inFlight: Promise<InboxState> | null = null
  private lastAttemptAt = 0
  // Null until the first successful poll, so launch never notifies for the existing backlog.
  private previous: PullSummary[] | null = null
  private readonly notifications = new Set<Notification>()

  constructor(
    private readonly auth: AuthService,
    private readonly settings: SettingsStore
  ) {
    settings.onChange(() => this.schedule())
  }

  get(): InboxState {
    return this.state
  }

  latestUpdatedAt(ref: PullRef): string | null {
    const key = pullKey(ref)
    for (const pull of this.state.pulls) {
      if (pullKey(pull.ref) === key) return pull.updatedAt
    }
    return null
  }

  start(): void {
    void this.refresh()
  }

  stop(): void {
    this.clearTimer()
    this.previous = null
    this.lastAttemptAt = 0
    this.state = EMPTY_STATE
    app.dock?.setBadge('')
    broadcast(IPC.inboxChanged, this.state)
  }

  refresh(): Promise<InboxState> {
    if (this.inFlight) return this.inFlight
    this.clearTimer()
    this.inFlight = this.poll().finally(() => {
      this.inFlight = null
      this.schedule()
    })
    return this.inFlight
  }

  refreshIfStale(): void {
    if (!this.auth.user()) return
    if (Date.now() - this.lastAttemptAt < STALE_AFTER_MS) return
    void this.refresh()
  }

  private async poll(): Promise<InboxState> {
    if (!this.auth.user()) return this.state
    this.lastAttemptAt = Date.now()
    try {
      const pulls = await this.auth.client().listInbox()
      if (!this.auth.user()) return this.state
      this.notifyNew(pulls)
      this.previous = pulls
      this.state = { pulls, fetchedAt: new Date().toISOString(), error: null }
    } catch (error) {
      if (error instanceof GitHubError && error.status === 401) {
        await this.auth.expire()
        return this.state
      }
      const message = error instanceof Error ? error.message : String(error)
      this.state = { ...this.state, error: message }
    }
    this.updateBadge()
    broadcast(IPC.inboxChanged, this.state)
    return this.state
  }

  private updateBadge(): void {
    let count = 0
    for (const pull of this.state.pulls) {
      if (pull.bucket === 'review') count++
    }
    app.dock?.setBadge(count > 0 ? String(count) : '')
  }

  private notifyNew(pulls: PullSummary[]): void {
    if (this.previous === null) return
    if (!this.settings.get().notify || !Notification.isSupported()) return
    const fresh = newReviewRequests(this.previous, pulls)
    if (fresh.length > MAX_INDIVIDUAL_NOTIFICATIONS) {
      this.show('Review requested', `${fresh.length} new pull requests are waiting for your review`)
      return
    }
    for (const pull of fresh) {
      const where = `${pull.ref.owner}/${pull.ref.repo}#${pull.ref.number}`
      this.show('Review requested', `${where} ${pull.title}\nfrom ${pull.author.login}`)
    }
  }

  private show(title: string, body: string): void {
    const notification = new Notification({ title, body })
    // Electron drops a notification that is garbage collected before the user clicks it.
    this.notifications.add(notification)
    notification.on('click', () => {
      focusMainWindow()
      this.notifications.delete(notification)
    })
    notification.on('close', () => this.notifications.delete(notification))
    notification.show()
  }

  private schedule(): void {
    this.clearTimer()
    if (!this.auth.user()) return
    this.timer = setTimeout(() => void this.refresh(), this.settings.get().pollSeconds * 1000)
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}
