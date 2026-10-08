import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Locator } from '@playwright/test'
import { aiGuide, CHAT_REPLY, TEST_TOKEN } from '../fixtures/servers'
import { inbox, otherPull, pull } from '../fixtures/share-pr'
import { toolsPulls } from '../fixtures/tools-pr'
import { openPrReview, signIn } from './flows'
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

async function settle() {
  await h.page.evaluate(
    'Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {})))'
  )
}

async function openSharePull() {
  await h.page.getByRole('button', { name: new RegExp(`${pull.owner}/${pull.repo}#${pull.number}`) }).click()
  await expect(h.page.getByRole('heading', { name: pull.title })).toBeVisible()
}

test('opens on home, signs in, badges the dock, and walks the guide from a risk-first overview through the story map into sections', async () => {
  const { page, app } = h
  const prReview = page.getByRole('button', { name: 'PR Review', exact: true })
  const agentDash = page.getByRole('button', { name: 'Agent dash', exact: true })
  const tokenField = page.getByLabel('Personal access token')
  const badge = () => app.evaluate(({ app }) => app.dock?.getBadge())
  await expect(prReview).toBeVisible()
  await expect(agentDash).toBeEnabled()
  await settle()
  await shot('00-home')

  await openPrReview(page)
  await expect(tokenField).toBeVisible()
  await shot('01-sign-in')
  await tokenField.fill(TEST_TOKEN)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('region', { name: 'Needs your review' })).toBeVisible()

  await expect.poll(badge).toBe('2')
  await expect(page.getByRole('region', { name: 'Your pull requests' })).toContainText('Add dark theme polish')

  await openSharePull()
  await page.getByRole('button', { name: 'Home', exact: true }).click()
  await expect(prReview).toBeVisible()
  await expect(page.getByRole('region', { name: 'Needs your review' })).toHaveCount(0)
  expect(await badge()).toBe('2')
  await openPrReview(page)
  await expect(page.getByRole('heading', { name: pull.title })).toBeVisible()
  await expect(page.getByRole('button', { name: `${pull.owner}/${pull.repo}#${pull.number} ${pull.title}` })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tabpanel')).toContainText('packages/mobile/plugins')
  const risk = page.getByRole('region', { name: 'Risk' })
  await expect(risk).toContainText(/(Low|Medium|High) risk/)
  await expect(risk).toContainText('estimated')
  const description = page.getByText('This PR adds mobile sharing so external content can be staged')
  await expect(description).toBeHidden()
  await expect(page.getByRole('tabpanel')).toContainText('entered through MainActivity.onNewIntent')
  await shot('02-overview')
  await page.getByText('Description', { exact: true }).click()
  await expect(description).toBeVisible()

  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: 'Story map' })).toHaveAttribute('aria-selected', 'true')
  const takeShare = page.getByRole('tabpanel').getByRole('button', { name: 'CapyShareModule.takeShare', exact: true })
  await expect(takeShare).toBeVisible()
  await shot('03-story-map')

  await takeShare.click()
  const ide = page.getByRole('region', { name: 'IDE' })
  const focused = ide.locator('[aria-current="true"]')
  await expect(focused).toContainText('fun takeShare(')
  await expect(focused).toBeInViewport()
  await settle()
  await shot('03b-story-map-node-enlarged')
  await page.keyboard.press('Escape')
  await expect(ide).toBeHidden()

  await page.getByRole('tabpanel').getByRole('button', { name: /^01\s*takeShare enters through MainActivity\.onNewIntent/ }).click()
  await expect(page.getByRole('tab', { name: /takeShare enters through MainActivity\.onNewIntent/ })).toHaveAttribute('aria-selected', 'true')
  const storyline = page.getByLabel('Storyline')
  const entry = storyline.getByRole('region').first()
  await expect(entry).toHaveAccessibleName('MainActivity.onNewIntent')
  await expect(entry.locator('header')).toContainText('Entry')
  const card = page.getByRole('region', { name: 'CapyShareModule.takeShare', exact: true })
  await expect(card.locator('header')).toContainText('Added')
  await shot('04-section')

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

  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('radio', { name: 'Dark' }).click()
  await page.keyboard.press('Escape')
  await expect(page.locator('html')).toHaveClass(/dark/)
  await page.getByRole('tab', { name: 'Story map' }).click()
  await settle()
  await shot('20-story-map-dark')
  await page.getByRole('tab', { name: /takeShare enters through MainActivity\.onNewIntent/ }).click()
  await settle()
  await shot('21-section-dark')
  await page.getByRole('button', { name: 'Home', exact: true }).click()
  await expect(prReview).toBeVisible()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await settle()
  await shot('22-home-dark')
})

test('the inbox puts open PRs before drafts, keeps a stack together, collapses sections, and filters without moving the dock badge', async () => {
  const { page, app } = h
  const card = (p: { owner: string; repo: string; number: number; title: string }) => `${p.owner}/${p.repo}#${p.number} ${p.title}`
  const buttonNames = (scope: Locator) => scope.getByRole('button').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')))
  const badge = () => app.evaluate(({ app }) => app.dock?.getBadge())
  const [a, b, c] = inbox.stack as [typeof inbox.draft, typeof inbox.draft, typeof inbox.draft]
  const mineDefault = [
    'Your pull requests',
    'stack · 3',
    card(a),
    card(b),
    card(c),
    card(otherPull),
    card(inbox.old),
    'Drafts',
    card(inbox.draft)
  ]
  await signIn(page)
  const review = page.getByRole('region', { name: 'Needs your review' })
  const mine = page.getByRole('region', { name: 'Your pull requests' })

  await expect.poll(() => buttonNames(mine)).toEqual(mineDefault)
  await expect(mine.getByRole('group', { name: 'stack · 3' }).getByRole('button', { name: /^ethan-mcq\/prot#/ })).toHaveCount(3)
  await expect(review.getByRole('button', { name: card(inbox.secondReviewer) })).toBeVisible()
  await expect.poll(badge).toBe('2')
  await shot('12-inbox-default')

  const stack = mine.getByRole('group', { name: 'stack · 3' })
  const stackHeader = stack.getByRole('button', { name: 'stack · 3' })
  await stackHeader.click()
  await expect(stackHeader).toHaveAttribute('aria-expanded', 'false')
  await expect(stackHeader).toHaveText('stack · 3')
  await expect.poll(() => buttonNames(stack)).toEqual(['stack · 3', card(a)])
  await settle()
  await shot('14b-stack-collapsed')
  await stackHeader.click()
  await expect.poll(() => buttonNames(stack)).toEqual(['stack · 3', card(a), card(b), card(c)])

  const mineHeader = mine.getByRole('button', { name: 'Your pull requests' })
  await mineHeader.click()
  await expect(mineHeader).toHaveAttribute('aria-expanded', 'false')
  await expect(mine.getByRole('button', { name: card(otherPull) })).toHaveCount(0)
  await settle()
  await shot('14-inbox-collapsed')
  await mineHeader.click()
  await expect(mine.getByRole('button', { name: card(otherPull) })).toBeVisible()

  await page.getByRole('button', { name: 'Filter pull requests' }).click()
  await page.getByRole('checkbox', { name: 'kai' }).click()
  await expect(review.getByRole('button', { name: card(inbox.secondReviewer) })).toHaveCount(0)
  await expect(review.locator('h2')).toContainText('1 of 2')
  await page.getByRole('radio', { name: '30 days' }).click()
  await expect(mine.getByRole('button', { name: card(inbox.old) })).toHaveCount(0)
  await page.getByRole('switch', { name: 'Show drafts' }).click()
  await expect(mine.getByRole('button', { name: card(inbox.draft) })).toHaveCount(0)
  await expect(mine.getByRole('button', { name: 'Drafts' })).toHaveCount(0)
  await page.getByRole('switch', { name: 'Group stacks' }).click()
  await expect(mine.getByRole('group', { name: 'stack · 3' })).toHaveCount(0)
  await expect(mine.getByRole('button', { name: card(b) })).toContainText(`stacked on #${a.number}`)
  await expect(mine.locator('h2')).toContainText('4 of 6')
  expect(await badge()).toBe('2')

  await page.keyboard.press('Escape')
  await page.reload()
  await openPrReview(page)
  await expect.poll(() => buttonNames(mine)).toEqual(['Your pull requests', card(c), card(a), card(b), card(otherPull)])
  await expect(review.getByRole('button', { name: card(inbox.secondReviewer) })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Filter pull requests' })).toContainText('4')

  await page.getByRole('button', { name: 'Filter pull requests' }).click()
  await settle()
  await shot('13-inbox-filter')
  await page.getByRole('checkbox', { name: '0xluffyb' }).click()
  await page.keyboard.press('Escape')
  await expect(review).toContainText('No pull requests match these filters')
  await expect(review.getByRole('button', { name: 'Reset' })).toBeVisible()
  await settle()
  await shot('16-inbox-no-matches')

  await page.getByRole('button', { name: 'Filter pull requests' }).click()
  await page.getByRole('button', { name: 'Reset filters' }).click()
  await page.keyboard.press('Escape')
  await expect.poll(() => buttonNames(mine)).toEqual(mineDefault)
  await expect(review.getByRole('button', { name: card(inbox.secondReviewer) })).toBeVisible()
  expect(await badge()).toBe('2')

  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('radio', { name: 'Dark' }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await settle()
  await shot('15-inbox-dark')
})

test('expands into the IDE, browses the whole repo, and submits an approval with an inline comment', async () => {
  const { page, github } = h
  await signIn(page)
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

  await page.getByRole('button', { name: 'Ask prot' }).click()
  await page.getByLabel('Anthropic API key').fill('sk-ant-fixture')
  await page.getByRole('button', { name: 'Save' }).click()
  await page.getByRole('button', { name: 'Close chat' }).click()
  const aiChapter = page.getByRole('tab', { name: /Stage and upload shared files/ })
  await expect(aiChapter).toBeVisible()
  const guideFile = join(h.userData, 'guides', `${pull.owner}__${pull.repo}__${pull.number}.json`)
  await expect.poll(() => existsSync(guideFile)).toBe(true)

  await page.getByRole('button', { name: /^Review/ }).click()
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
  await expect.poll(() => existsSync(guideFile)).toBe(false)
  await expect(aiChapter).toBeVisible()
})

test('checks out PRs outside the inbox by link, keeps them across a reload, opens inbox PRs in place, and removes them', async () => {
  const { page, userData } = h
  const [open, merged] = toolsPulls as [(typeof toolsPulls)[number], (typeof toolsPulls)[number]]
  const card = (p: { number: number; title: string }) => `octo-labs/tools#${p.number} ${p.title}`
  const input = page.getByRole('textbox', { name: 'Check out a pull request' })
  const manual = page.getByRole('region', { name: 'Manually checked out' })
  const saved = () =>
    (JSON.parse(readFileSync(join(userData, 'checked-out.json'), 'utf8')) as { owner: string; repo: string; number: number }[]).map(
      (entry) => `${entry.owner}/${entry.repo}#${entry.number}`
    )
  const checkout = async (text: string) => {
    await input.fill(text)
    await input.press('Enter')
  }
  await signIn(page)
  await expect(manual).toHaveCount(0)

  await checkout('https://github.com/octo-labs/tools/pull/42/files')
  await expect(page.getByRole('heading', { name: open.title })).toBeVisible()
  await expect(manual.getByRole('button', { name: card(open) })).toHaveAttribute('aria-current', 'page')
  await expect(input).toHaveValue('')
  await checkout('octo-labs/tools#40')
  await expect(page.getByRole('heading', { name: merged.title })).toBeVisible()
  await expect(manual.getByRole('button', { name: card(merged) })).toContainText('merged')
  await manual.scrollIntoViewIfNeeded()
  await manual.getByRole('button', { name: card(open) }).hover()
  await settle()
  await shot('17-manual-section')

  await page.reload()
  await openPrReview(page)
  await expect.poll(() => manual.getByRole('button', { name: /^octo-labs\/tools#/ }).evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')))).toEqual([
    card(open),
    card(merged)
  ])
  expect(saved()).toEqual(['octo-labs/tools#42', 'octo-labs/tools#40'])

  const capyCards = page.getByRole('button', { name: `${pull.owner}/${pull.repo}#${pull.number} ${pull.title}` })
  await checkout(`${pull.owner}/${pull.repo}#${pull.number}`)
  await expect(page.getByRole('heading', { name: pull.title })).toBeVisible()
  await checkout(`#${pull.number}`)
  await expect(input).toHaveValue('')
  await expect(page.getByRole('heading', { name: pull.title })).toBeVisible()
  await expect(capyCards).toHaveCount(1)
  await expect(capyCards).toHaveAttribute('aria-current', 'page')
  expect(saved()).toEqual(['octo-labs/tools#42', 'octo-labs/tools#40'])

  await checkout('https://github.com/octo-labs/tools/issues/42')
  await expect(page.getByRole('alert')).toHaveText("That's an issue link, not a pull request")
  await settle()
  await shot('18-checkout-error')
  await checkout('octo-labs/tools#999')
  await expect(page.getByRole('alert')).toHaveText("No pull request octo-labs/tools#999, or you don't have access")

  for (const p of [open, merged]) {
    await manual.getByRole('button', { name: card(p) }).hover()
    await page.getByRole('button', { name: `Remove octo-labs/tools#${p.number} from manually checked out` }).click()
  }
  await expect(manual).toHaveCount(0)
  expect(saved()).toEqual([])
})

test('chat widget takes an API key, swaps in the AI guide, and answers with the on-screen chapter and chosen effort', async () => {
  const { page, anthropic } = h
  await signIn(page)
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
  const first = chats().at(-1)?.body as { model: string; output_config: { effort: string }; fallbacks?: unknown; system: { text: string }[] }
  const sent = JSON.stringify(first)
  const guideRequest = JSON.stringify(anthropic.requests.find((r) => JSON.stringify(r.body).includes('json_schema'))?.body)
  expect(guideRequest).toContain('CapyShareModule.takeShare')
  expect(guideRequest).not.toContain('share extension and Android share intent to a new or existing thread')
  expect(guideRequest).not.toContain('staged, uploaded, and sent to Capy threads')
  expect(sent).toContain('Stage and upload shared files')
  expect(sent).toContain(question)
  expect(sent).not.toContain('staged, uploaded, and sent to Capy threads')
  expect({
    model: first.model,
    effort: first.output_config.effort,
    fallbacks: first.fallbacks ?? null,
    concise: first.system.some((block) => block.text.includes('Output style: concise.'))
  }).toEqual({ model: 'claude-haiku-5-5', effort: 'medium', fallbacks: null, concise: true })

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
  await signIn(page)
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
  await signIn(page)
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
  await page.getByRole('button', { name: 'System prompts…' }).click()
  const dialog = page.getByRole('dialog', { name: 'System prompts' })
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
