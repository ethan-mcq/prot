import { expect, type Page } from '@playwright/test'
import { TEST_TOKEN } from '../fixtures/servers'

export async function openPrReview(page: Page) {
  await page.getByRole('button', { name: 'PR Review', exact: true }).click()
}

export async function signIn(page: Page) {
  await openPrReview(page)
  await page.getByLabel('Personal access token').fill(TEST_TOKEN)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('region', { name: 'Needs your review' })).toBeVisible()
}
