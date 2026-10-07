import type { AuthSource, AuthState, GitHubUser } from '@shared/types'
import { GitHubError, type GitHubClient } from './github'
import { GhCliError, readGhToken } from './gh-cli'
import type { SecretsStore } from './secrets'

type Session = { client: GitHubClient; user: GitHubUser; source: AuthSource }

const NO_GITHUB_SECRETS = { githubToken: null, githubSource: null, githubUser: null }

function signedOut(error: string | null): AuthState {
  return { status: 'signed_out', error }
}

function describeSignInError(error: unknown): string {
  if (error instanceof GhCliError) return error.message
  if (error instanceof GitHubError && error.status === 401) {
    return 'GitHub rejected that token (401). Check that it is valid and not expired.'
  }
  return error instanceof Error ? error.message : String(error)
}

export class AuthService {
  private session: Session | null = null
  private state: AuthState = signedOut(null)
  private readonly listeners = new Set<(state: AuthState) => void>()
  private ready: Promise<void> = Promise.resolve()

  constructor(
    private readonly secrets: SecretsStore,
    private readonly createClient: (token: string) => GitHubClient
  ) {}

  restore(): void {
    this.ready = this.restoreFromSecrets()
  }

  async get(): Promise<AuthState> {
    await this.ready
    return this.state
  }

  async signInWithGh(): Promise<AuthState> {
    await this.ready
    try {
      return await this.signIn(await readGhToken(), 'gh')
    } catch (error) {
      return this.fail(describeSignInError(error))
    }
  }

  async signInWithToken(token: string): Promise<AuthState> {
    await this.ready
    try {
      return await this.signIn(token, 'token')
    } catch (error) {
      return this.fail(describeSignInError(error))
    }
  }

  async signOut(): Promise<AuthState> {
    await this.ready
    await this.secrets.update(NO_GITHUB_SECRETS)
    this.session = null
    return this.setState(signedOut(null))
  }

  async expire(): Promise<void> {
    await this.secrets.update(NO_GITHUB_SECRETS)
    this.session = null
    this.setState(signedOut('GitHub rejected the saved token. Sign in again.'))
  }

  client(): GitHubClient {
    if (!this.session) throw new Error('Not signed in to GitHub.')
    return this.session.client
  }

  user(): GitHubUser | null {
    return this.session?.user ?? null
  }

  onChange(listener: (state: AuthState) => void): void {
    this.listeners.add(listener)
  }

  private async signIn(token: string, source: AuthSource): Promise<AuthState> {
    const client = this.createClient(token)
    const user = await client.getUser()
    await this.secrets.update({ githubToken: token, githubSource: source, githubUser: user })
    this.session = { client, user, source }
    return this.setState({ status: 'signed_in', user, source })
  }

  private async restoreFromSecrets(): Promise<void> {
    const stored = await this.secrets.get()
    if (!stored.githubToken || !stored.githubSource) return
    const source = stored.githubSource
    let token = stored.githubToken
    if (source === 'gh') {
      // gh rotates its token on re-login. If gh is gone, the stored token may still work.
      try {
        token = await readGhToken()
      } catch {
        token = stored.githubToken
      }
    }
    const client = this.createClient(token)
    try {
      const user = await client.getUser()
      await this.secrets.update({ githubToken: token, githubUser: user })
      this.session = { client, user, source }
      this.setState({ status: 'signed_in', user, source })
    } catch (error) {
      const unreachable = error instanceof GitHubError && error.status !== 401
      if (unreachable && stored.githubUser) {
        this.session = { client, user: stored.githubUser, source }
        this.setState({ status: 'signed_in', user: stored.githubUser, source })
        return
      }
      await this.secrets.update(NO_GITHUB_SECRETS)
      this.setState(signedOut(describeSignInError(error)))
    }
  }

  private fail(message: string): AuthState {
    this.session = null
    return this.setState(signedOut(message))
  }

  private setState(state: AuthState): AuthState {
    this.state = state
    for (const listener of this.listeners) listener(state)
    return state
  }
}
