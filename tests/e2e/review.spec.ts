import { expect, test } from '@playwright/test'
import { CHAT_REPLY, TEST_TOKEN } from '../fixtures/servers'
import { pull } from '../fixtures/share-pr'
import { launch, type Harness } from './launch'

const SHOTS = process.env.PROT_SHOTS

let h: Harness

test.beforeEach(async () => {
  h = await launch()
})

test.afterEach(async () => {
  await h.close()
})

async function shot(name: string) {
  if (SHOTS) await h.page.screenshot({ path: `${SHOTS}/${name}.png` })
}

async function signIn() {
  const { page } = h
  await page.getByLabel('Personal access token').fill(TEST_TOKEN)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('region', { name: 'Needs your review' })).toBeVisible()
}

async function openSharePull() {
  await h.page.getByRole('button', { name: new RegExp(`${pull.owner}/${pull.repo}#${pull.number}`) }).click()
  await expect(h.page.getByRole('heading', { name: pull.title })).toBeVisible()
}

test('signs in, badges the dock, and walks the guide from overview through flow to chapters', async () => {
  const { page, app } = h
  await shot('01-sign-in')
  await signIn()

  await expect.poll(() => app.evaluate(({ app }) => app.dock?.getBadge())).toBe('1')
  await expect(page.getByRole('region', { name: 'Your pull requests' })).toContainText('Add dark theme polish')

  await openSharePull()
  await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tabpanel')).toContainText('packages/mobile/plugins')
  await shot('02-overview')

  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: 'Flow' })).toHaveAttribute('aria-selected', 'true')
  const takeShare = page.getByRole('tabpanel').getByRole('button', { name: 'takeShare()', exact: true })
  await expect(takeShare).toBeVisible()
  await shot('03-flow')

  await takeShare.click()
  await expect(page.getByRole('tab', { name: /Capy share module/ })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('region', { name: /CapyShareModule\.kt/ })).toBeVisible()
  await shot('04-chapter')

  await page.getByRole('button', { name: 'Next' }).click()
  await expect(page.getByRole('tab', { name: /With share extension/ })).toHaveAttribute('aria-selected', 'true')
})

test('expands into the IDE, browses the whole repo, and submits an approval with an inline comment', async () => {
  const { page, github } = h
  await signIn()
  await openSharePull()
  await page.getByRole('tab', { name: /Share inbox UI/ }).click()

  const send = page.getByRole('region', { name: 'packages/mobile/src/share/send.ts' })
  await expect(send).toContainText('Should uploads run in parallel?')
  await send.getByRole('button', { name: 'Comment on line 6' }).click()
  await page.getByRole('textbox').last().fill('Parallel would be faster here.')
  await page.getByRole('button', { name: 'Add comment' }).click()

  await page.getByRole('button', { name: 'Open packages/mobile/src/share/send.ts in IDE' }).first().click()
  const ide = page.getByRole('region', { name: 'IDE' })
  await expect(ide.getByRole('treeitem', { name: 'packages/mobile/src/share/send.ts' })).toBeVisible()
  await page.keyboard.press('j')
  await page.getByRole('radio', { name: 'All files' }).click()
  await ide.getByRole('treeitem', { name: 'packages/mobile/app.config.ts' }).click()
  await expect(ide).toContainText('with-share-extension.js')
  await shot('05-ide')
  await page.keyboard.press('Escape')
  await expect(ide).toBeHidden()

  await page.getByRole('button', { name: 'Review' }).click()
  await page.getByRole('textbox', { name: 'Summary' }).fill('Looks good.')
  await page.getByRole('radio', { name: 'Approve' }).click()
  await shot('06-review')
  await page.getByRole('button', { name: 'Submit review' }).click()

  await expect
    .poll(() => github.requests.find((r) => r.method === 'POST' && r.path.endsWith('/reviews'))?.body)
    .toEqual({
      commit_id: pull.headSha,
      body: 'Looks good.',
      event: 'APPROVE',
      comments: [{ path: 'packages/mobile/src/share/send.ts', line: 6, side: 'RIGHT', body: 'Parallel would be faster here.' }]
    })
})

test('chat widget takes an API key, swaps in the AI guide, and answers with the on-screen chapter as context', async () => {
  const { page, anthropic } = h
  await signIn()
  await openSharePull()

  await page.getByRole('button', { name: 'Ask prot' }).click()
  await page.getByLabel('Anthropic API key').fill('sk-ant-fixture')
  await page.getByRole('button', { name: 'Save' }).click()

  await page.getByRole('button', { name: 'Generate AI guide' }).click()
  await expect(page.getByRole('tab', { name: /Stage and upload shared files/ })).toBeVisible()
  await page.getByRole('tab', { name: /Stage and upload shared files/ }).click()

  await page.getByRole('textbox', { name: 'Message prot' }).fill('Where does sharing start?')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('log', { name: 'Conversation' })).toContainText(CHAT_REPLY)
  await shot('07-chat')

  const chat = anthropic.requests.filter((r) => !JSON.stringify(r.body).includes('json_schema')).at(-1)
  const sent = JSON.stringify(chat?.body)
  expect(sent).toContain('Stage and upload shared files')
  expect(sent).toContain('Where does sharing start?')
})
