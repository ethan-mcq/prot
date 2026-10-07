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
  const moduleKt = page.getByRole('region', {
    name: 'packages/mobile/modules/capy-share/android/src/main/java/ai/capy/share/CapyShareModule.kt'
  })
  await expect(moduleKt).toBeVisible()
  const focused = moduleKt.locator('[aria-current="true"]')
  await expect(focused).toContainText('fun takeShare(')
  await expect(focused).toBeInViewport()
  await shot('04-chapter-focused-row')

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
  await expect(send.getByRole('link', { name: 'Fix in Cursor' })).toHaveCount(2)
  await expect(send).toContainText('Finalize can bypass run failure hold')
  await expect(send).toContainText('SampleMarkComplete')
  await expect(send.getByRole('link', { name: 'Cursor Bugbot' })).toBeVisible()
  await send.locator('summary', { hasText: 'Additional Locations (1)' }).click()
  await expect(send.getByText('website/api/sample.py#L584-L713')).toBeVisible()
  for (const raw of ['BUGBOT_BUG_ID', '<div>', '<!--', '[Cursor Bugbot](', '<details>']) {
    await expect(send).not.toContainText(raw)
  }
  await expect(send.locator('p', { hasText: 'Homopolymer insertions' }).locator('br')).toHaveCount(1)
  await send.getByText('Homopolymer insertions at run edges clear').scrollIntoViewIfNeeded()
  await shot('05a-bugbot-homopolymer')
  await send.getByText('Finalize can bypass run failure hold').scrollIntoViewIfNeeded()
  await shot('05b-bugbot-finalize')
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

test('chat widget takes an API key, swaps in the AI guide, and answers with the on-screen chapter and chosen effort', async () => {
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

  const chats = () => anthropic.requests.filter((r) => !JSON.stringify(r.body).includes('json_schema'))
  const first = chats().at(-1)?.body as { model: string; output_config: { effort: string } }
  const sent = JSON.stringify(first)
  expect(sent).toContain('Stage and upload shared files')
  expect(sent).toContain('Where does sharing start?')
  expect({ model: first.model, effort: first.output_config.effort }).toEqual({ model: 'claude-sonnet-5-5', effort: 'medium' })

  await page.getByRole('combobox', { name: 'Thinking effort' }).click()
  await page.getByRole('option', { name: 'High', exact: true }).click()
  await page.getByRole('textbox', { name: 'Message prot' }).fill('Anything risky?')
  await page.keyboard.press('Enter')
  await expect.poll(() => chats().length).toBe(2)
  const second = chats().at(-1)?.body as { output_config: { effort: string } }
  expect(second.output_config.effort).toBe('high')
})
