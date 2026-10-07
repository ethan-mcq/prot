import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { startAnthropic, startGitHub, type FixtureServer } from '../fixtures/servers'

export type Harness = {
  app: ElectronApplication
  page: Page
  github: FixtureServer
  anthropic: FixtureServer
  close(): Promise<void>
}

export async function launch(): Promise<Harness> {
  const github = await startGitHub()
  const anthropic = await startAnthropic()
  const userData = mkdtempSync(join(tmpdir(), 'prot-e2e-'))
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ANTHROPIC_API_KEY') env[key] = value
  }
  const app = await electron.launch({
    args: ['out/main/index.js', `--user-data-dir=${userData}`],
    env: { ...env, GITHUB_API_URL: github.url, ANTHROPIC_BASE_URL: anthropic.url }
  })
  const page = await app.firstWindow()
  return {
    app,
    page,
    github,
    anthropic,
    async close() {
      await app.close()
      await github.close()
      await anthropic.close()
      rmSync(userData, { recursive: true, force: true })
    }
  }
}
