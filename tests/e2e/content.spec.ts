import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { CHAT_REPLY } from '../fixtures/servers'
import { pull } from '../fixtures/share-pr'
import { signIn } from './flows'
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
  if (!SHOTS) return
  await h.page.evaluate(
    'Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {})))'
  )
  await h.page.screenshot({ path: `${SHOTS}/${name}.png` })
}

async function openSharePull() {
  await h.page.getByRole('button', { name: new RegExp(`${pull.owner}/${pull.repo}#${pull.number}`) }).click()
  await expect(h.page.getByRole('heading', { name: pull.title })).toBeVisible()
}

test('the overview reads risk, one sentence, then the attachments imported from the description only, which are deleted once the PR is approved', async () => {
  const { page, userData } = h
  await signIn(page)
  await openSharePull()

  const panel = page.getByRole('tabpanel')
  const attachments = page.getByRole('region', { name: 'Attachments' })
  await expect(attachments.getByRole('heading')).toHaveText('Attachments 2')
  await expect(attachments.getByRole('status')).toHaveCount(0)
  const synopsis = 'It adds 13 symbols across 3 sections, entered through MainActivity.onNewIntent.'
  const text = await panel.innerText()
  const order = ['Medium risk', synopsis, 'Attachments', 'Description'].map((part) => text.indexOf(part))
  expect({ missing: order.includes(-1), order }).toEqual({ missing: false, order: [...order].sort((a, b) => a - b) })
  await expect(panel.getByText(synopsis, { exact: true })).toBeVisible()
  await expect(panel).not.toContainText('Synopsis')

  const sheet = attachments.getByRole('img', { name: 'Share sheet on a Pixel 8' })
  await expect.poll(() => sheet.evaluate((img) => (img as unknown as { naturalWidth: number }).naturalWidth)).toBe(360)
  await expect(attachments.getByRole('button', { name: /share-intent\.log/ })).toBeVisible()
  await expect(attachments.getByRole('img', { name: 'Inbox with two shared photos' })).toHaveCount(0)
  await expect(attachments).not.toContainText('Inbox with two shared photos')
  await expect(attachments).not.toContainText('comment by')
  await shot('20-overview-attachments')
  if (SHOTS) {
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.waitForTimeout(600)
    await shot('20b-overview-attachments-dark')
    await page.emulateMedia({ colorScheme: 'light' })
  }

  await attachments.getByRole('button', { name: 'View Share sheet on a Pixel 8' }).click()
  const lightbox = page.getByRole('dialog', { name: 'Share sheet on a Pixel 8' })
  await expect(lightbox.getByRole('button', { name: 'Open original' })).toBeVisible()
  await expect.poll(() => lightbox.getByRole('img').evaluate((img) => (img as unknown as { naturalWidth: number }).naturalWidth)).toBe(360)
  await shot('21-lightbox')
  await page.keyboard.press('Escape')
  await expect(lightbox).toBeHidden()

  const dir = join(userData, 'attachments', `${pull.owner}__${pull.repo}__${pull.number}`)
  const detailFetches = () => h.github.requests.filter((r) => r.path === `/repos/${pull.owner}/${pull.repo}/pulls/${pull.number}`).length
  expect(existsSync(join(dir, 'manifest.json'))).toBe(true)
  const fetchedBefore = detailFetches()
  await page.getByRole('button', { name: /^Review/ }).click()
  await page.getByRole('radio', { name: 'Approve' }).click()
  await page.getByRole('button', { name: 'Submit review' }).click()
  await expect.poll(() => existsSync(dir)).toBe(false)
  await expect.poll(detailFetches).toBeGreaterThan(fetchedBefore)
  await page.waitForTimeout(300)
  expect(existsSync(dir), 'the refetch after approving does not import again').toBe(false)
})

test('a saved prompt version can be deleted, the live one cannot, and a chat keeps the chat prompt that was live when it started', async () => {
  const { page } = h
  await signIn(page)

  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'System prompts…' }).click()
  const dialog = page.getByRole('dialog', { name: 'System prompts' })
  const versions = dialog.getByRole('listbox', { name: 'Prompt versions' })
  const editor = dialog.getByRole('textbox', { name: 'System prompt' })
  await editor.fill(`${await editor.inputValue()}\n\nName the riskiest caller first.`)
  await dialog.getByRole('button', { name: 'Save as new version' }).click()
  const saved = versions.getByRole('option', { name: /^[0-9a-f]{12}$/ })
  await expect(saved).toHaveCount(1)
  const hash = (await saved.getAttribute('aria-label')) as string

  const liveTrash = dialog.getByRole('button', { name: 'Delete built-in default' })
  await expect(liveTrash).toBeDisabled()
  await expect(liveTrash).toHaveAttribute('title', 'Make another version live first')

  await shot('22a-prompt-trash-buttons')
  await dialog.getByRole('button', { name: `Delete ${hash}` }).click()
  const confirm = page.getByRole('dialog', { name: 'Delete this prompt version?' })
  await expect(confirm).toContainText('Guides already written with it keep working.')
  await shot('22-prompt-delete-confirm')
  await confirm.getByRole('button', { name: 'Delete' }).click()

  await expect(versions.getByRole('option', { name: hash })).toHaveCount(0)
  await expect(versions.getByRole('option')).toHaveText([/built-in default/])
  await shot('23-prompt-after-delete')

  const kinds = dialog.getByRole('tablist', { name: 'Prompt kinds' })
  const guideTab = kinds.getByRole('tab', { name: 'Review guide' })
  const chatTab = kinds.getByRole('tab', { name: 'Chat' })
  const discard = page.getByRole('dialog', { name: 'Discard your edits?' })
  await editor.fill('An unsaved edit.')
  await chatTab.click()
  await discard.getByRole('button', { name: 'Keep editing' }).click()
  await expect(guideTab).toHaveAttribute('aria-selected', 'true')
  await expect(editor).toHaveValue('An unsaved edit.')
  await chatTab.click()
  await discard.getByRole('button', { name: 'Discard' }).click()
  await expect(chatTab).toHaveAttribute('aria-selected', 'true')

  const marker = 'CHAT-MARKER-9'
  await expect(versions.getByRole('option')).toHaveText([/built-in default/])
  await editor.fill(`${await editor.inputValue()}\n\n${marker}: answer in one paragraph.`)
  await dialog.getByRole('button', { name: 'Save as new version' }).click()
  const chatSaved = versions.getByRole('option', { name: /^[0-9a-f]{12}$/ })
  await expect(chatSaved).toHaveCount(1)
  const chatHash = (await chatSaved.getAttribute('aria-label')) as string
  await dialog.getByRole('button', { name: 'Make live' }).click()
  await expect(chatSaved.getByText('live', { exact: true })).toBeVisible()
  await shot('24-system-prompts-chat-tab')
  await dialog.getByRole('button', { name: 'Close' }).click()

  await openSharePull()
  await page.getByRole('button', { name: 'Ask prot' }).click()
  await page.getByLabel('Anthropic API key').fill('sk-ant-fixture')
  await page.getByRole('button', { name: 'Save' }).click()
  const chatSystems = () =>
    h.anthropic.requests.filter((r) => !JSON.stringify(r.body).includes('json_schema')).map((r) => JSON.stringify((r.body as { system: unknown }).system))
  const message = page.getByRole('textbox', { name: 'Message prot' })
  await message.fill('Where does a share start?')
  await message.press('Enter')
  await expect(page.getByRole('log', { name: 'Conversation' })).toContainText(CHAT_REPLY)
  const threadPrompt = page.getByRole('complementary', { name: 'Ask prot' }).getByText(/^prompt: /)
  await expect(threadPrompt).toHaveText(`prompt: ${chatHash}`)
  await shot('25-chat-thread-prompt')

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'System prompts…' }).click()
  await chatTab.click()
  await versions.getByRole('option', { name: 'built-in default' }).click()
  await dialog.getByRole('button', { name: 'Make live' }).click()
  await expect(versions.getByRole('option', { name: 'built-in default' }).getByText('live', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Close' }).click()

  await message.fill('Anything risky?')
  await message.press('Enter')
  await expect.poll(() => chatSystems().length).toBe(2)
  await expect(threadPrompt).toHaveText(`prompt: ${chatHash}`)
  expect(chatSystems().map((system) => system.includes(marker))).toEqual([true, true])
})
