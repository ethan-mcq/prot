import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { BrowserWindow, nativeTheme, shell } from 'electron'

const RENDERER_HTML = join(import.meta.dirname, '../renderer/index.html')

function isAppUrl(url: string): boolean {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) return url.startsWith(devUrl)
  return url.startsWith(pathToFileURL(resolve(RENDERER_HTML)).href)
}

export function openInBrowser(url: string): void {
  if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
}

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f0f10' : '#ffffff',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true
    }
  })

  win.once('ready-to-show', () => win.show())

  win.webContents.setWindowOpenHandler(({ url }) => {
    openInBrowser(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return
    event.preventDefault()
    openInBrowser(url)
  })

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(RENDERER_HTML)
  return win
}

export function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

export function focusMainWindow(): void {
  const [win] = BrowserWindow.getAllWindows()
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}
