import { expect, test } from '@playwright/test'
import { aiGuide, CHAT_REPLY, TEST_TOKEN } from '../fixtures/servers'
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

test('signs in, badges the dock, and walks the guide from a risk-first overview through the story map into sections', async () => {
  const { page, app } = h
  await shot('01-sign-in')
  await signIn()

  await expect.poll(() => app.evaluate(({ app }) => app.dock?.getBadge())).toBe('1')
  await expect(page.getByRole('region', { name: 'Your pull requests' })).toContainText('Add dark theme polish')

  await openSharePull()
  await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tabpanel')).toContainText('packages/mobile/plugins')
  const risk = page.getByRole('region', { name: 'Risk' })
  await expect(risk).toContainText(/(Low|Medium|High) risk/)
  await expect(risk).toContainText('estimated')
  const description = page.getByText('This PR adds mobile sharing so external content can be staged')
  await expect(description).toBeHidden()
  await expect(page.getByRole('tabpanel')).toContainText('takeShare enters through MainActivity.onNewIntent')
  await shot('02-overview')
  await page.getByText('Description', { exact: true }).click()
  await expect(description).toBeVisible()

  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: 'Story map' })).toHaveAttribute('aria-selected', 'true')
  const takeShare = page.getByRole('tabpanel').getByRole('button', { name: 'CapyShareModule.takeShare', exact: true })
  await expect(takeShare).toBeVisible()
  await shot('03-story-map')

  await takeShare.click()
  await expect(page.getByRole('tab', { name: /takeShare enters through MainActivity\.onNewIntent/ })).toHaveAttribute('aria-selected', 'true')
  const storyline = page.getByLabel('Storyline')
  const entry = storyline.getByRole('region').first()
  await expect(entry).toHaveAccessibleName('MainActivity.onNewIntent')
  await expect(entry.locator('header')).toContainText('Entry')
  const card = page.getByRole('region', { name: 'CapyShareModule.takeShare', exact: true })
  await expect(card.locator('header')).toContainText('Added')
  const focused = card.locator('[aria-current="true"]')
  await expect(focused).toContainText('fun takeShare(')
  await expect(focused).toBeInViewport()
  await shot('04-section-focused-row')

  const helper = page.getByRole('region', { name: 'CapyShareModule.stageItems', exact: true })
  await expect(helper).toContainText('fun stageItems(')
  await expect(storyline.getByRole('region', { name: 'ShareInbox', exact: true })).toHaveCount(0)

  await page.getByRole('button', { name: 'Next' }).click()
  await expect(page.getByRole('tab', { name: /withShareExtension/ })).toHaveAttribute('aria-selected', 'true')
  await shot('04c-second-section')

  await page.getByRole('button', { name: 'Next' }).click()
  await expect(page.getByRole('tab', { name: /New ShareInbox/ })).toHaveAttribute('aria-selected', 'true')
  await expect(storyline.getByRole('region').first()).toHaveAccessibleName('ShareInbox')
  await expect(storyline.getByRole('separator', { name: 'Tests' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'uploads every shared item' })).toContainText('useShareSend')
  await page.getByRole('region', { name: 'uploads every shared item' }).scrollIntoViewIfNeeded()
  await shot('04b-section-tests')

  const sendCard = page.getByRole('region', { name: 'useShareSend', exact: true })
  await sendCard.evaluate((card) => {
    const pane = card.closest('[aria-label="Storyline"]')
    if (pane) pane.scrollTop += card.getBoundingClientRect().top - pane.getBoundingClientRect().top + 300
  })
  const paneTop = (await storyline.boundingBox())?.y ?? 0
  await expect.poll(async () => Math.round(((await sendCard.locator('header').boundingBox())?.y ?? -1) - paneTop)).toBe(0)
  await expect(sendCard.locator('header')).toContainText('useShareSend')
  await shot('04d-sticky-header')
})

test('expands into the IDE, browses the whole repo, and submits an approval with an inline comment', async () => {
  const { page, github } = h
  await signIn()
  await openSharePull()
  await page.getByRole('tab', { name: /New ShareInbox/ }).click()

  const send = page.getByRole('region', { name: 'useShareSend', exact: true })
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

  const reply = 'Sequential keeps the caption order; parallel can wait for a follow-up.'
  const thread = send.getByRole('group', { name: 'Thread by kai' })
  await expect(thread).toContainText('Should uploads run in parallel?')
  await thread.getByRole('button', { name: 'Reply to kai' }).click()
  await thread.getByRole('textbox', { name: 'Reply' }).fill(reply)
  const sendReply = thread.getByRole('button', { name: 'Send reply' })
  await expect(sendReply).toHaveCSS('opacity', '1')
  await shot('05c-reply-composer')
  await sendReply.click()
  await expect(thread).toContainText(reply)
  await expect(thread.getByRole('textbox', { name: 'Reply' })).toHaveCount(0)
  await shot('05d-reply-posted')
  expect(github.requests.filter((r) => r.method === 'POST' && r.path.includes('/replies'))).toEqual([
    { method: 'POST', path: `/repos/${pull.owner}/${pull.repo}/pulls/${pull.number}/comments/9001/replies`, body: { body: reply } }
  ])
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

  const question = aiGuide.questions[0] as string
  const suggested = page.getByRole('list', { name: 'Suggested questions' }).getByRole('button')
  await expect(suggested.first()).toHaveText(`1.${question}`)
  await expect(suggested).toHaveCount(aiGuide.questions.length)
  await shot('07a-chat-questions')
  await suggested.first().click()
  await expect(page.getByRole('log', { name: 'Conversation' })).toContainText(CHAT_REPLY)
  await shot('07-chat')

  const chats = () => anthropic.requests.filter((r) => !JSON.stringify(r.body).includes('json_schema'))
  const first = chats().at(-1)?.body as { model: string; output_config: { effort: string } }
  const sent = JSON.stringify(first)
  const guideRequest = JSON.stringify(anthropic.requests.find((r) => JSON.stringify(r.body).includes('json_schema'))?.body)
  expect(guideRequest).toContain('CapyShareModule.takeShare')
  expect(guideRequest).not.toContain('share extension and Android share intent to a new or existing thread')
  expect(guideRequest).not.toContain('staged, uploaded, and sent to Capy threads')
  expect(sent).toContain('Stage and upload shared files')
  expect(sent).toContain(question)
  expect(sent).not.toContain('staged, uploaded, and sent to Capy threads')
  expect({ model: first.model, effort: first.output_config.effort }).toEqual({ model: 'claude-sonnet-5-5', effort: 'medium' })

  await page.getByRole('combobox', { name: 'Thinking effort' }).click()
  await page.getByRole('option', { name: 'High', exact: true }).click()
  await page.getByRole('textbox', { name: 'Message prot' }).fill('Anything risky?')
  await page.keyboard.press('Enter')
  await expect.poll(() => chats().length).toBe(2)
  const second = chats().at(-1)?.body as { output_config: { effort: string } }
  expect(second.output_config.effort).toBe('high')
})

test('a push while reading flags the stale AI guide in place, reaches the new file, and refreshes the guide on request', async () => {
  const { page, github, anthropic } = h
  const moduleKt = 'packages/mobile/modules/capy-share/android/src/main/java/ai/capy/share/CapyShareModule.kt'
  const guideRequests = () => anthropic.requests.filter((r) => JSON.stringify(r.body).includes('json_schema')).length
  await signIn()
  await openSharePull()

  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('switch', { name: 'AI guide automatically' }).click()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Ask prot' }).click()
  await page.getByLabel('Anthropic API key').fill('sk-ant-fixture')
  await page.getByRole('button', { name: 'Save' }).click()
  await page.getByRole('button', { name: 'Close chat' }).click()
  await page.getByRole('button', { name: 'Generate AI guide', exact: true }).click()
  const chapter = page.getByRole('tab', { name: /Stage and upload shared files/ })
  await chapter.click()
  await expect.poll(guideRequests).toBe(1)

  github.push()
  await page.getByRole('button', { name: 'Refresh pull requests' }).click()

  const banner = page.getByRole('status').filter({ hasText: 'changed since the guide' })
  await expect(banner).toContainText('2 files, +44 −0 since 9f3c2a1')
  await expect(banner).toContainText('New core file share-queue.ts is not in any chapter yet.')
  await expect(chapter).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('tabpanel').getByRole('button', { name: 'CapyShareModule.takeShare', exact: true }).click()
  await expect(page.getByRole('region', { name: 'CapyShareModule.takeShare', exact: true }).locator('header')).toContainText(
    'changed since guide'
  )
  await shot('08-stale-guide-banner')

  await page.getByRole('button', { name: `Open ${moduleKt} in IDE` }).first().click()
  const ide = page.getByRole('region', { name: 'IDE' })
  await expect(ide.getByRole('treeitem', { name: moduleKt })).toContainText('Δ guide')
  await expect(ide).toHaveCSS('opacity', '1')
  await shot('09-stale-guide-ide-tag')
  await page.keyboard.press('Escape')

  await page.getByRole('tab', { name: /New since guide/ }).click()
  await expect(page.getByRole('region', { name: 'packages/mobile/src/share/share-queue.ts' })).toContainText('drainShareQueue')
  await shot('10-new-since-guide')

  await page.getByRole('button', { name: 'Refresh guide', exact: true }).click()
  await expect.poll(guideRequests).toBe(2)
  await expect(banner).toBeHidden()
})

test('a saved, renamed review prompt made live is the system prompt the next AI guide is written with', async () => {
  const { page, anthropic } = h
  const marker = 'PROMPT-MARKER-7'
  const guideSystems = () =>
    anthropic.requests
      .filter((r) => JSON.stringify(r.body).includes('json_schema'))
      .map((r) => (r.body as { system: string }).system)
  await signIn()
  await openSharePull()

  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('switch', { name: 'AI guide automatically' }).click()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Ask prot' }).click()
  await page.getByLabel('Anthropic API key').fill('sk-ant-fixture')
  await page.getByRole('button', { name: 'Save' }).click()
  await page.getByRole('button', { name: 'Close chat' }).click()
  await page.getByRole('button', { name: 'Generate AI guide', exact: true }).click()
  await expect.poll(() => guideSystems().length).toBe(1)

  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Review prompt…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Review prompt' })
  const versions = dialog.getByRole('listbox', { name: 'Prompt versions' })
  await expect(versions.getByRole('option')).toHaveText([/built-in default/])
  const editor = dialog.getByRole('textbox', { name: 'System prompt' })
  const builtIn = await editor.inputValue()
  await editor.fill(`${builtIn}\n\n${marker}: lead every section with what could break.`)
  await dialog.getByRole('button', { name: 'Save as new version' }).click()

  const saved = versions.getByRole('option', { name: /^[0-9a-f]{12}$/ })
  await expect(saved).toHaveCount(1)
  await expect(versions.getByRole('option')).toHaveCount(2)
  await expect(saved).toHaveAttribute('aria-selected', 'true')
  await expect(dialog.getByRole('button', { name: 'Save as new version' })).toBeDisabled()
  await shot('11a-prompt-two-versions')

  await dialog.getByRole('button', { name: 'Rename prompt' }).click()
  const name = dialog.getByRole('textbox', { name: 'Prompt name' })
  await expect(name).toHaveValue('')
  await expect(name).toHaveAttribute('placeholder', /^[0-9a-f]{12}$/)
  await name.fill('terse risk-first')
  await shot('11b-prompt-rename')
  await name.press('Enter')
  const renamed = versions.getByRole('option', { name: 'terse risk-first' })
  await expect(renamed).toBeVisible()
  await expect(versions.getByRole('option', { name: /^[0-9a-f]{12}$/ })).toHaveCount(0)

  const builtInRow = versions.getByRole('option', { name: 'built-in default' })
  await expect(builtInRow.getByText('live', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Make live' }).click()
  await expect(renamed.getByText('live', { exact: true })).toBeVisible()
  await expect(builtInRow.getByText('live', { exact: true })).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Make live' })).toBeDisabled()
  await shot('11c-prompt-live')

  await editor.fill('An unsaved edit.')
  await dialog.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('dialog', { name: 'Discard your edits?' }).getByRole('button', { name: 'Discard' }).click()
  await expect(dialog).toBeHidden()

  const notice = page.getByRole('status').filter({ hasText: 'Generated with prompt' })
  await expect(notice).toContainText('Generated with prompt built-in default. The live prompt is terse risk-first. Regenerate to use it.')
  await shot('11d-prompt-notice')
  await page.getByRole('button', { name: 'Regenerate AI guide' }).click()
  await expect.poll(() => guideSystems().length).toBe(2)
  await expect(notice).toBeHidden()
  await expect(page.locator('[title^="Written with prompt"]')).toHaveAttribute('title', 'Written with prompt terse risk-first')

  const [before, after] = guideSystems()
  expect({ before: before?.includes(marker), after: after?.includes(marker), afterStart: after?.startsWith(builtIn.slice(0, 40)) }).toEqual({
    before: false,
    after: true,
    afterStart: true
  })
})
