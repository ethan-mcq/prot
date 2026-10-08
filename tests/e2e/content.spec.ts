import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
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

test('the overview reads risk, one sentence, then the imported attachments, which are deleted once the PR is approved', async () => {
  const { page, userData } = h
  await signIn(page)
  await openSharePull()

  const panel = page.getByRole('tabpanel')
  const attachments = page.getByRole('region', { name: 'Attachments' })
  await expect(attachments.getByRole('heading')).toHaveText('Attachments 3')
  await expect(attachments.getByRole('status')).toHaveCount(0)
  const synopsis = 'It adds 13 symbols across 3 sections, entered through MainActivity.onNewIntent.'
  const text = await panel.innerText()
  const order = ['Medium risk', synopsis, 'Attachments', 'Description'].map((part) => text.indexOf(part))
  expect({ missing: order.includes(-1), order }).toEqual({ missing: false, order: [...order].sort((a, b) => a - b) })
  await expect(panel.getByText(synopsis, { exact: true })).toBeVisible()
  await expect(panel).not.toContainText('Synopsis')

  const sheet = attachments.getByRole('img', { name: 'Share sheet on a Pixel 8' })
  await expect.poll(() => sheet.evaluate((img) => (img as unknown as { naturalWidth: number }).naturalWidth)).toBe(360)
  await expect(attachments.getByRole('img', { name: 'Inbox with two shared photos' })).toBeVisible()
  await expect(attachments).toContainText('comment by kai')
  await expect(attachments.getByRole('button', { name: /share-intent\.log/ })).toContainText('description')
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

test('a saved prompt version can be deleted from the trash button after confirming, and the live one cannot', async () => {
  const { page } = h
  await signIn(page)

  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Review prompt…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Review prompt' })
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
})
