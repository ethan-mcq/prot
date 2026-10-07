import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    titleBarStyle: 'hiddenInset',
    webPreferences: { preload: join(import.meta.dirname, '../preload/index.cjs'), sandbox: true }
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())
