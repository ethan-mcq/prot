import { app, Notification } from 'electron'
import { pullKey, type InboxState, type PullRef, type PullSummary } from '@shared/types'
import { IPC } from '@shared/ipc'
import type { AuthService } from './auth'
import type { CheckedOutStore } from './checked-out'
import { GitHubError } from './github'
import { newlyClosed, newReviewRequests } from './inbox-diff'
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
  private previous: PullSummary[] | null = null
  private readonly notifications = new Set<Notification>()
  private readonly closedListeners = new Set<(pull: PullSummary) => void>()

  constructor(
    private readonly auth: AuthService,
    private readonly settings: SettingsStore,
    private readonly checkedOut: CheckedOutStore
  ) {
    settings.onChange(() => this.schedule())
  }

  // Fires when a pull that was open on the previous poll comes back merged or closed.
  onClosed(listener: (pull: PullSummary) => void): void {
    this.closedListeners.add(listener)
  }

  async checkout(ref: PullRef): Promise<PullRef> {
    const listed = this.inboxPull(ref)
    if (listed) return listed.ref
    let pull: PullSummary
    try {
      pull = await this.auth.client().getPullSummary(ref, 'manual')
    } catch (error) {
      if (error instanceof GitHubError && error.status === 404) {
        throw new Error(`No pull request ${pullKey(ref)}, or you don't have access`)
      }
      throw error
    }
    const canonical = this.inboxPull(pull.ref)
    if (canonical) return canonical.ref
    await this.checkedOut.add(pull.ref)
    this.setPulls([...this.withoutManual(pull.ref), pull])
    return pull.ref
  }

  async forget(ref: PullRef): Promise<void> {
    await this.checkedOut.remove(ref)
    this.setPulls(this.withoutManual(ref))
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
      const client = this.auth.client()
      const requested = this.checkedOut.list()
      const [inbox, fetched] = await Promise.all([
        client.listInbox(),
        requested.length > 0 ? client.getPulls(requested, 'manual') : new Map<string, PullSummary | null>()
      ])
      if (!this.auth.user()) return this.state
      const pulls = [...inbox, ...this.manualPulls(fetched)]
      this.notifyNew(pulls)
      this.notifyClosed(pulls)
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

  // Walks the list as it is now, not as it was when the poll began, so a checkout or forget made mid-poll stands.
  // A pull this poll did not fetch or could not see keeps its last summary; one GitHub says is gone is hidden.
  private manualPulls(fetched: Map<string, PullSummary | null>): PullSummary[] {
    const shown = new Map<string, PullSummary>()
    for (const pull of this.state.pulls) {
      if (pull.bucket === 'manual') shown.set(pullKey(pull.ref), pull)
    }
    const pulls: PullSummary[] = []
    for (const ref of this.checkedOut.list()) {
      const key = pullKey(ref)
      const pull = fetched.has(key) ? fetched.get(key) : shown.get(key)
      if (pull) pulls.push(pull)
    }
    return pulls
  }

  // GitHub owner and repo names are case-insensitive, and typed input is not canonical.
  private inboxPull(ref: PullRef): PullSummary | null {
    const key = pullKey(ref).toLowerCase()
    for (const pull of this.state.pulls) {
      if (pull.bucket !== 'manual' && pullKey(pull.ref).toLowerCase() === key) return pull
    }
    return null
  }

  private withoutManual(ref: PullRef): PullSummary[] {
    return this.state.pulls.filter((pull) => pull.bucket !== 'manual' || pullKey(pull.ref) !== pullKey(ref))
  }

  private setPulls(pulls: PullSummary[]): void {
    this.state = { ...this.state, pulls }
    broadcast(IPC.inboxChanged, this.state)
  }

  private notifyClosed(pulls: PullSummary[]): void {
    if (this.previous === null) return
    for (const pull of newlyClosed(this.previous, pulls)) {
      for (const listener of this.closedListeners) listener(pull)
    }
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
