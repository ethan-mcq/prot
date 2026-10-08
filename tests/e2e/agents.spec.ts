import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { expect, test } from '@playwright/test'
import { AGENT_SYSTEM_PROMPT } from '../../src/shared/output-style'
import { launch, type Harness } from './launch'

const SHOTS = process.env.PROT_SHOTS
const OUTSIDE_CLAUDE = '3253eaf7-a224-4b39-b4a6-33ba51d8e490'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

type Call = { bin: 'claude' | 'codex'; argv?: string[]; cwd?: string; signal?: string; stdin?: { message: { content: Record<string, unknown>[] } } }
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAIElEQVR4nGPQ0DC4WR5OPMlAkmoNDQOGURtGbRgyNgAANMoTkMGIb4oAAAAASUVORK5CYII='

let h: Harness
let repoParent: string
let repo: string

test.beforeEach(async () => {
  repoParent = mkdtempSync(join(tmpdir(), 'prot-e2e-repo-'))
  repo = makeRepo(join(realpathSync(repoParent), 'widget'))
  h = await launch()
  // Turn-end notifications would pop real macOS banners from the hidden window.
  await h.app.evaluate(({ Notification }) => {
    Notification.isSupported = () => false
  })
})

test.afterEach(async () => {
  await h.close()
  rmSync(repoParent, { recursive: true, force: true })
})

async function shot(name: string) {
  if (SHOTS) await h.page.screenshot({ path: `${SHOTS}/${name}.png` })
}

async function settle() {
  await h.page.evaluate(
    'Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {})))'
  )
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=prot', '-c', 'user.email=prot@example.com', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8'
  }).trim()
}

function makeRepo(dir: string): string {
  mkdirSync(dir)
  git(dir, ['init', '-q', '-b', 'main'])
  writeFileSync(join(dir, 'README.md'), '# widget\n\nFirst line.\n')
  git(dir, ['add', '.'])
  git(dir, ['commit', '-q', '-m', 'Initial commit'])
  return dir
}

function calls(): Call[] {
  if (!existsSync(h.agents.argvLog)) return []
  const out: Call[] = []
  for (const line of readFileSync(h.agents.argvLog, 'utf8').split('\n')) {
    if (line !== '') out.push(JSON.parse(line) as Call)
  }
  return out
}

function turns(bin: Call['bin']): Call[] {
  return calls().filter((call) => call.bin === bin && call.argv !== undefined)
}

async function openDash() {
  await h.page.getByRole('button', { name: 'Agent dash', exact: true }).click()
  await expect(h.page.getByRole('heading', { name: 'What should your agents work on?' })).toBeVisible()
}

async function pick(trigger: string, option: string | RegExp) {
  await h.page.getByRole('combobox', { name: trigger }).click()
  await h.page.getByRole('option', { name: option }).click()
}

async function nextDialog(paths: string[]) {
  await h.app.evaluate(({ dialog }, picked) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: picked })) as typeof dialog.showOpenDialog
  }, paths)
}

async function addRepo(path: string) {
  await nextDialog([path])
  await pick('Folder', 'Add folder…')
  await expect(h.page.getByRole('combobox', { name: 'Folder' })).toHaveText(basename(path))
}

async function attachImage(): Promise<string> {
  const file = join(repoParent, 'screen.png')
  writeFileSync(file, Buffer.from(PNG, 'base64'))
  await nextDialog([file])
  await h.page.getByRole('button', { name: 'Attach files' }).click()
  const thumb = h.page.getByRole('list', { name: 'Attachments' }).getByRole('img', { name: 'screen.png' })
  await expect(thumb).toBeVisible()
  await expectLoaded(thumb)
  return file
}

async function expectLoaded(image: ReturnType<Harness['page']['locator']>) {
  await expect.poll(() => image.evaluate((element) => (element as unknown as { naturalWidth: number }).naturalWidth)).toBeGreaterThan(0)
}

async function startAgent(prompt: string) {
  await h.page.getByRole('textbox', { name: 'Task' }).fill(prompt)
  await h.page.getByRole('button', { name: 'Start agent' }).click()
  await expect(h.page.getByRole('heading', { level: 1, name: prompt })).toBeVisible()
}

async function send(text: string) {
  await h.page.getByRole('textbox', { name: 'Message agent' }).fill(text)
  await h.page.getByRole('button', { name: 'Send', exact: true }).click()
}

const sidebar = () => h.page.getByRole('complementary', { name: 'Agents' })
const section = (name: string) => sidebar().getByRole('region', { name, exact: true })
const transcript = () => h.page.getByRole('log', { name: 'Transcript' })
const header = () => h.page.locator('#main-pane header')

test('the dash opens without GitHub, shows both subscriptions signed in and lists outside sessions from the app homes', async () => {
  const { page } = h
  await openDash()
  await expect(page.getByRole('textbox', { name: 'Personal access token' })).toHaveCount(0)

  const subs = page.getByRole('region', { name: 'Subscriptions' })
  await expect(subs.getByRole('listitem', { name: 'Claude Code' })).toContainText('signed in · claude.ai')
  await expect(subs.getByRole('listitem', { name: 'Claude Code' })).toContainText('v9.9.9')
  await expect(subs.getByRole('listitem', { name: 'Codex' })).toContainText('signed in · ChatGPT')
  // Claude's limits come from the CLI's local /usage command before any turn runs.
  await expect(page.getByRole('meter', { name: 'Claude Code 5 hour usage' })).toHaveAttribute('aria-valuenow', '31')
  await expect(page.getByRole('meter', { name: 'Claude Code 7 day usage' })).toHaveAttribute('aria-valuenow', '64')
  await expect(page.getByRole('combobox', { name: 'Model' })).toHaveText(/Claude Code\s*opus\[1m\]/)
  await expect(page.getByRole('combobox', { name: 'Effort' })).toHaveText('Extra high')

  await expect(section('Claude app').getByRole('button', { name: 'Fix login redirect loop' })).toBeVisible()
  await expect(section('Codex app').getByRole('button', { name: 'Read a.txt' })).toBeVisible()
  // Promptless and guardian sessions are not listed.
  await expect(section('Codex app').getByRole('button', { name: 'Guardian review' })).toHaveCount(0)
  await expect(section('prot')).toContainText('Agents you start in prot show up here.')
  expect(calls()).toEqual([])

  // The theme follows the system until set in PR Review's settings, which the dash has no menu for.
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('html')).not.toHaveClass(/dark/)
  await settle()
  await shot('30-agent-dash')
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('html')).toHaveClass(/dark/)
  await settle()
  await shot('31-agent-dash-dark')
})

test('a Claude agent in a new worktree runs with the chosen model, effort and permission, then resumes the same session and shows its changes', async () => {
  const { page } = h
  const prompt = 'Fix the flaky login test'
  await openDash()
  await addRepo(repo)
  await pick('Model', 'Sonnet 5.5')
  await pick('Effort', 'Medium')
  await pick('Permissions', /^Plan/)
  await expect(page.getByRole('combobox', { name: 'Checkout' })).toHaveText('New worktree')
  await startAgent(prompt)

  await expect(transcript()).toContainText(`Echo: ${prompt}`)
  const [first] = turns('claude')
  const sessionId = first?.argv?.[11] ?? ''
  expect(sessionId).toMatch(UUID)
  expect(first?.argv).toEqual([
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--model',
    'claude-sonnet-5-5',
    '--effort',
    'medium',
    '--permission-mode',
    'plan',
    '--session-id',
    sessionId,
    '--append-system-prompt',
    AGENT_SYSTEM_PROMPT,
    '--',
    prompt
  ])
  // The locked agent prompt shows as one collapsed card above the first message.
  const system = transcript().getByRole('button', { name: /^System prompt / })
  await expect(system).toHaveAttribute('aria-expanded', 'false')
  await system.click()
  await expect(transcript()).toContainText(AGENT_SYSTEM_PROMPT.split('\n')[0] ?? '')
  const cwd = first?.cwd ?? ''
  const slug = basename(cwd)
  expect(slug).toMatch(/^fix-the-flaky-login-test-[0-9a-f]{4}$/)
  expect(cwd).toBe(join(realpathSync(h.agents.worktreeRoot), 'widget', slug))
  expect(git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe(`prot/${slug}`)
  expect(git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('main')

  await expect(transcript().getByText(prompt, { exact: true })).toBeVisible()
  // Tool calls collapse into one row; their details live in the Activity panel.
  await expect(transcript().getByRole('button', { name: 'Bash echo hi' })).toHaveCount(0)
  await transcript().getByRole('button', { name: '1 tool call' }).click()
  const activity = page.getByRole('complementary', { name: 'Activity' })
  await expect(activity.getByRole('button', { name: 'Bash echo hi' }).getByLabel('ok')).toBeVisible()
  await expect(transcript()).toContainText('0s · $0.01 · 1.1k in · 20 out')
  await expect(header()).toContainText(`widget · prot/${slug}`)
  await expect(header()).toContainText('Sonnet 5.5')
  await expect(header()).toContainText('idle')
  await expect(section('prot').getByRole('button', { name: prompt })).toHaveAttribute('aria-current', 'page')
  await expect(section('Working')).toContainText('No agents are working.')
  await settle()
  await shot('32-agent-transcript')
  await page.getByRole('tab', { name: 'Changes' }).click()
  await expect(page.getByRole('complementary', { name: 'Changes' })).toContainText('No changes yet.')

  // Stand in for edits the agent made: one tracked file changed, one new file.
  writeFileSync(join(cwd, 'README.md'), '# widget\n\nFirst line.\nAdded by the agent.\n')
  mkdirSync(join(cwd, 'src'))
  writeFileSync(join(cwd, 'src', 'login.test.ts'), 'test("login", () => {})\n')
  await send('Now add a regression test')
  await expect(transcript()).toContainText('Echo: Now add a regression test')

  const second = turns('claude')[1]
  expect(second?.argv).toEqual([
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--model',
    'claude-sonnet-5-5',
    '--effort',
    'medium',
    '--permission-mode',
    'plan',
    '--resume',
    sessionId,
    '--append-system-prompt',
    AGENT_SYSTEM_PROMPT,
    '--',
    'Now add a regression test'
  ])
  expect(second?.cwd).toBe(cwd)

  const changes = page.getByRole('complementary', { name: 'Changes' })
  await expect(changes.getByRole('button')).toHaveText([/README\.md\s*\+1/, /login\.test\.ts\s*src\s*\+1/])
  await changes.getByRole('button', { name: 'README.md' }).click()
  const diff = page.getByRole('region', { name: 'Diff of README.md' })
  await expect(diff).toContainText('Added by the agent.')
  await expect(diff).toContainText('@@')
  await settle()
  await shot('33-agent-changes')
  await diff.getByRole('button', { name: 'Back to transcript' }).click()
  await expect(transcript().getByText('Looking into it.')).toHaveCount(2)

  // The rate limits from the turn reach the dash without a manual refresh.
  await page.getByRole('button', { name: 'New agent' }).click()
  const meters = page.getByRole('region', { name: 'Subscriptions' }).getByRole('meter')
  await expect(page.getByRole('meter', { name: 'Claude Code 5 hour usage' })).toHaveAttribute('aria-valuenow', '25')
  await expect(page.getByRole('meter', { name: 'Claude Code 7 day usage' })).toHaveAttribute('aria-valuenow', '50')
  await expect(meters).toHaveCount(3)

  // The fake wrote its session under $CLAUDE_CONFIG_DIR like the real CLI; a rescan must not list it twice.
  await sidebar().getByRole('button', { name: 'Refresh agents' }).click()
  await expect(sidebar().getByRole('button', { name: 'Refresh agents' })).toBeEnabled()
  await expect(sidebar().getByRole('button', { name: prompt })).toHaveCount(1)
  await expect(section('Claude app').getByRole('button')).toHaveText([/Claude app/, /Fix login redirect loop/, /started by prot/])

  const worktrees = page.getByRole('region', { name: 'Worktrees' })
  await worktrees.getByRole('button', { name: `Remove worktree prot/${slug}` }).click()
  await worktrees.getByRole('button', { name: `Confirm remove worktree prot/${slug}` }).click()
  await expect(worktrees).toContainText('No agent worktrees.')
  expect(existsSync(cwd)).toBe(false)
  expect(git(repo, ['branch', '--list', `prot/${slug}`])).toBe(`prot/${slug}`)
})

test('a Codex agent on the local checkout gets its options before `--` and resumes its own thread', async () => {
  const { page } = h
  const prompt = 'Explain the build'
  await openDash()
  await addRepo(repo)
  await pick('Model', 'GPT-6-Astra')
  await expect(page.getByRole('combobox', { name: 'Effort' })).toHaveText('Extra high')
  await pick('Permissions', /^Workspace write/)
  await pick('Checkout', 'Local checkout')
  await startAgent(prompt)
  await expect(transcript()).toContainText(`Echo: ${prompt}`)
  await transcript().getByRole('button', { name: '1 tool call' }).click()
  await expect(page.getByRole('complementary', { name: 'Activity' }).getByRole('button', { name: /echo hi/ })).toBeVisible()
  await expect(header()).toContainText('widget · main')

  const options = ['exec', '--json', '-m', 'gpt-6-astra', '-c', 'model_reasoning_effort="xhigh"', '-s', 'workspace-write', '-C', repo, '--skip-git-repo-check', '-c', `developer_instructions=${JSON.stringify(AGENT_SYSTEM_PROMPT)}`]
  const [first] = turns('codex')
  expect(first).toEqual({ bin: 'codex', argv: [...options, '--', prompt], cwd: repo })

  // The fake logs each thread under $CODEX_HOME/sessions with the thread id in the file name.
  const rollouts: string[] = []
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) visit(join(dir, entry.name))
      else if (readFileSync(join(dir, entry.name), 'utf8').includes(`"cwd":"${repo}"`)) rollouts.push(entry.name)
    }
  }
  visit(join(h.agents.codexHome, 'sessions'))
  expect(rollouts).toHaveLength(1)
  const threadId = /-([0-9a-f-]{36})\.jsonl$/.exec(rollouts[0] ?? '')?.[1]
  expect(threadId).toMatch(UUID)

  await send('And the tests?')
  await expect(transcript()).toContainText('Echo: And the tests?')
  expect(turns('codex')[1]).toEqual({ bin: 'codex', argv: [...options, 'resume', threadId, '--', 'And the tests?'], cwd: repo })

  // The newest rollout's rate limits replace the fixture's on the dash, without a refresh.
  await page.getByRole('button', { name: 'New agent' }).click()
  await expect(page.getByRole('meter', { name: 'Codex 5 hour usage' })).toHaveAttribute('aria-valuenow', '12')
  await expect(page.getByRole('meter', { name: 'Codex 7 day usage' })).toHaveAttribute('aria-valuenow', '40')

  // After a rescan the thread prot started is still only its own agent, and its transcript survives a reload.
  await page.reload()
  await openDash()
  await sidebar().getByRole('button', { name: 'Refresh agents' }).click()
  await expect(sidebar().getByRole('button', { name: 'Refresh agents' })).toBeEnabled()
  await expect(section('Codex app').getByRole('button')).toHaveText([/Codex app/, /Read a\.txt/])
  await expect(sidebar().getByRole('button', { name: prompt })).toHaveCount(1)
  await section('prot').getByRole('button', { name: prompt }).click()
  await expect(transcript()).toContainText(`Echo: ${prompt}`)
  await expect(transcript()).toContainText('Echo: And the tests?')
  await expect(page.getByRole('complementary', { name: 'Activity' }).getByRole('button', { name: /echo hi/ })).toHaveCount(2)
})

test('Stop interrupts a running turn: the CLI gets SIGINT and the agent ends stopped', async () => {
  const { page } = h
  const prompt = 'WAIT for the review'
  await openDash()
  await addRepo(repo)
  await pick('Checkout', 'Local checkout')
  await startAgent(prompt)

  await expect(header()).toContainText('running')
  await expect(section('Working').getByRole('button', { name: prompt })).toBeVisible()
  await expect(transcript().getByRole('button', { name: '1 running, 0 completed' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Message agent' })).toBeDisabled()
  await page.getByRole('button', { name: 'New agent' }).click()
  await expect(page.getByRole('region', { name: 'Working now' }).getByRole('button', { name: prompt })).toBeVisible()
  await section('Working').getByRole('button', { name: prompt }).click()

  await page.getByRole('button', { name: 'Stop agent' }).click()
  await expect(header()).toContainText('stopped')
  await expect(page.getByRole('button', { name: 'Stop agent' })).toHaveCount(0)
  await transcript().getByRole('button', { name: '1 tool call · 1 failed' }).click()
  await expect(page.getByRole('complementary', { name: 'Activity' }).getByRole('button', { name: 'Bash echo hi' }).getByLabel('error')).toBeVisible()
  await expect(section('prot').getByRole('button', { name: prompt })).toBeVisible()
  await expect(section('Working')).toContainText('No agents are working.')
  expect(calls().filter((call) => call.signal !== undefined)).toEqual([{ bin: 'claude', signal: 'SIGINT' }])
  await expect(page.getByRole('textbox', { name: 'Message agent' })).toBeEnabled()
})

test('a turn that exits non-zero fails with the CLI stderr in the transcript and lands in Needs you', async () => {
  const prompt = 'FAIL on purpose'
  await openDash()
  await addRepo(repo)
  await pick('Checkout', 'Local checkout')
  await startAgent(prompt)

  await expect(header()).toContainText('failed')
  await expect(transcript()).toContainText('! Claude Code exited with code 1\nfake-claude: something went wrong')
  await expect(transcript()).toContainText('Looking into it.')
  await expect(section('Needs you').getByRole('button', { name: prompt })).toBeVisible()
})

test('sending to a Claude app session forks it into a new prot agent that keeps the history and becomes selected', async () => {
  const { page } = h
  await openDash()
  const outside = section('Claude app').getByRole('button', { name: 'Fix login redirect loop' })
  await outside.click()
  await expect(header()).toContainText('from the Claude app')
  await expect(transcript()).toContainText('Opened a PR with the fix.')
  await expect(page.getByRole('button', { name: 'Stop agent' })).toHaveCount(0)

  await page.getByRole('textbox', { name: 'Message agent' }).fill('Carry on with the tests')
  await page.getByRole('button', { name: 'Continue in prot' }).click()

  const forked = section('prot').getByRole('button', { name: 'Fix login redirect loop' })
  await expect(forked).toHaveAttribute('aria-current', 'page')
  await expect(transcript()).toContainText('Echo: Carry on with the tests')
  await expect(transcript()).toContainText('Opened a PR with the fix.')
  await expect(header()).not.toContainText('from the Claude app')
  await expect(outside).toBeVisible()
  await expect(outside).not.toHaveAttribute('aria-current', 'page')

  const [fork] = turns('claude')
  expect(fork).toEqual({
    bin: 'claude',
    argv: [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--model',
      'claude-opus-5-5',
      '--effort',
      'xhigh',
      '--permission-mode',
      'auto',
      '--resume',
      OUTSIDE_CLAUDE,
      '--fork-session',
      '--append-system-prompt',
      AGENT_SYSTEM_PROMPT,
      '--',
      'Carry on with the tests'
    ],
    cwd: realpathSync(h.agents.outsideCwd)
  })

  // A follow-up resumes the fork's own new session, not the original.
  await send('One more thing')
  await expect(transcript()).toContainText('Echo: One more thing')
  const resumed = turns('claude')[1]?.argv ?? []
  const resumedId = resumed[resumed.indexOf('--resume') + 1]
  expect(resumedId).toMatch(UUID)
  expect(resumedId).not.toBe(OUTSIDE_CLAUDE)
  expect(resumed).not.toContain('--fork-session')
})

test('the / menu lists the agent\'s own skills first, inserts one from the other CLI and the turn reads its SKILL.md', async () => {
  const { page } = h
  mkdirSync(join(h.agents.claudeHome, 'skills', 'deploy-notes'), { recursive: true })
  writeFileSync(join(h.agents.claudeHome, 'skills', 'deploy-notes', 'SKILL.md'), '---\nname: deploy-notes\ndescription: Write release notes\n---\nBody\n')
  const skill = join(h.agents.codexHome, 'skills', 'deploy-check', 'SKILL.md')
  mkdirSync(join(skill, '..'), { recursive: true })
  writeFileSync(skill, '---\nname: deploy-check\ndescription: Check a deploy is safe\n---\nRun the checks.\n')
  await openDash()
  await addRepo(repo)
  await pick('Checkout', 'Local checkout')

  const task = page.getByRole('textbox', { name: 'Task' })
  await task.fill('/dep')
  const menu = page.getByRole('listbox', { name: 'Commands and skills' })
  await expect(menu.getByRole('option')).toHaveText([/\/deploy-notes\s*Write release notes/, /\/deploy-check\s*Check a deploy is safe\s*via SKILL\.md/])
  await expect(menu.getByRole('group')).toHaveText([/^Claude Code/, /^Codex/])
  await settle()
  await shot('34-agent-slash-menu')
  await task.press('ArrowDown')
  await expect(menu.getByRole('option', { name: /deploy-check/ })).toHaveAttribute('aria-selected', 'true')
  await task.press('Enter')
  await expect(menu).toHaveCount(0)
  await expect(task).toHaveValue('/deploy-check ')
  await task.pressSequentially('before merging')
  await page.getByRole('button', { name: 'Start agent' }).click()
  await expect(transcript()).toContainText('Echo: Read and follow the skill at')

  // The transcript keeps what was typed; the CLI gets the expanded form.
  await expect(transcript().getByText('/deploy-check before merging', { exact: true })).toBeVisible()
  const argv = turns('claude')[0]?.argv ?? []
  expect(argv.slice(-2)).toEqual(['--', `Read and follow the skill at ${skill}. before merging`])
})

test('the follow-up composer shows how full the context window is', async () => {
  const { page } = h
  await openDash()
  await addRepo(repo)
  await pick('Checkout', 'Local checkout')
  await startAgent('Count the tokens')
  await expect(transcript()).toContainText('Echo: Count the tokens')
  // The fake reports 250k tokens in context and a 1M window for opus[1m].
  const wheel = page.getByRole('meter', { name: 'Context window' })
  await expect(wheel).toHaveAttribute('aria-valuenow', '25')
  await expect(wheel).toHaveAttribute('title', '250k / 1M tokens (25%)')
})

test('an attached image goes to Claude as a stdin image block and to Codex as --image, with a thumbnail in the message', async () => {
  const { page } = h
  await openDash()
  await addRepo(repo)
  await pick('Checkout', 'Local checkout')
  await attachImage()
  await startAgent('What is on screen?')
  await expect(transcript()).toContainText('Echo: What is on screen?')
  await expectLoaded(transcript().getByRole('button', { name: 'Open image screen.png' }).getByRole('img'))

  const [claude] = turns('claude')
  expect(claude?.argv?.slice(-2)).toEqual(['--input-format', 'stream-json'])
  expect(claude?.argv).not.toContain('--')
  const content = claude?.stdin?.message.content ?? []
  expect(content[0]).toEqual({ type: 'text', text: 'What is on screen?' })
  expect(content[1]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } })

  await page.getByRole('button', { name: 'New agent' }).click()
  await pick('Model', 'GPT-6-Astra')
  await attachImage()
  await startAgent('And now?')
  await expect(transcript()).toContainText('Echo: And now?')
  const codex = turns('codex')[0]?.argv ?? []
  const image = codex.find((arg) => arg.startsWith('--image='))?.slice('--image='.length) ?? ''
  expect(image).toMatch(/\/agents\/attachments\/[0-9a-f]{16}\/screen\.png$/)
  expect(codex.slice(-3)).toEqual([`--image=${image}`, '--', 'And now?'])
})

test('an image a tool returns renders under the tool calls', async () => {
  await openDash()
  await addRepo(repo)
  await pick('Checkout', 'Local checkout')
  await startAgent('Show me the IMAGE')
  await expect(transcript()).toContainText('Echo: Show me the IMAGE')
  const thumb = transcript().getByRole('button', { name: /^Open image [0-9a-f]{64}\.png$/ })
  await expectLoaded(thumb.getByRole('img'))
  await thumb.click()
  await expectLoaded(h.page.getByRole('dialog').getByRole('img'))
  // An image file no event or attachment named is not served.
  const other = join(repoParent, 'other.png')
  writeFileSync(other, Buffer.from(PNG, 'base64'))
  const load = (path: string) =>
    h.page.evaluate(
      `new Promise((done) => { const image = new Image(); image.onload = () => done('loaded'); image.onerror = () => done('blocked'); image.src = ${JSON.stringify(`prot-agent-file://f/${encodeURIComponent(path)}`)} })`
    )
  expect(await load(other)).toBe('blocked')
})

test('an agent starts in a folder that is not a git repo, without a worktree', async () => {
  const { page } = h
  const folder = join(realpathSync(repoParent), 'notes')
  mkdirSync(folder)
  await openDash()
  await addRepo(folder)
  const checkout = page.getByRole('combobox', { name: 'Checkout' })
  await expect(checkout).toBeDisabled()
  await expect(checkout).toHaveText('In folder')
  await startAgent('Tidy these notes')
  await expect(transcript()).toContainText('Echo: Tidy these notes')
  expect(turns('claude')[0]?.cwd).toBe(folder)
  await expect(header()).toContainText('notes')
  await page.getByRole('tab', { name: 'Changes' }).click()
  await expect(page.getByRole('complementary', { name: 'Changes' })).toContainText('No changes yet.')
  await page.getByRole('button', { name: 'New agent' }).click()
  await expect(page.getByRole('region', { name: 'Recent folders' }).getByRole('button', { name: 'Use notes' })).toBeVisible()
})
