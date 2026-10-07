import { execFile } from 'node:child_process'

// Apps launched from Finder get a minimal PATH that misses Homebrew.
function pathWithHomebrew(): string {
  const extra = '/opt/homebrew/bin:/usr/local/bin'
  const current = process.env.PATH
  return current ? `${current}:${extra}` : extra
}

export class GhCliError extends Error {}

export function readGhToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'gh',
      ['auth', 'token', '--hostname', 'github.com'],
      { env: { ...process.env, PATH: pathWithHomebrew() }, timeout: 10_000 },
      (error, stdout) => {
        if (error) {
          if ('code' in error && error.code === 'ENOENT') {
            reject(
              new GhCliError('The GitHub CLI (gh) was not found. Install it or sign in with a token.')
            )
            return
          }
          reject(
            new GhCliError('gh is not logged in. Run `gh auth login` in a terminal or use a token.')
          )
          return
        }
        const token = stdout.trim()
        if (token === '') {
          reject(new GhCliError('gh returned no token. Run `gh auth login` in a terminal.'))
          return
        }
        resolve(token)
      }
    )
  })
}
