import { expect, test } from '@playwright/test'
import { launch, type Harness } from './launch'

let h: Harness

test.beforeEach(async () => {
  h = await launch()
})

test.afterEach(async () => {
  await h.close()
})

test('zooming out keeps the title bar clear of the traffic lights in window pixels', async () => {
  const { app, page } = h
  const home = page.getByRole('button', { name: 'Home' })
  await expect(home).toBeVisible()
  const inset = () => page.evaluate(() => {
    const bar = document.querySelector<HTMLElement>('.title-inset')
    if (!bar) return null
    const style = getComputedStyle(bar)
    return { left: parseFloat(style.paddingLeft), height: bar.getBoundingClientRect().height }
  })
  expect(await inset()).toEqual({ left: 84, height: 52 })

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(0.5))
  // 168 CSS pixels at half zoom are the same 84 window pixels.
  await expect.poll(inset).toEqual({ left: 168, height: 104 })

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(1.5))
  await expect.poll(inset).toEqual({ left: 84, height: 52 })
})
