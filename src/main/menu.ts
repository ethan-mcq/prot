import { Menu } from 'electron'

// Edit keeps Cmd+C/V/A working in inputs, and the app menu supplies Cmd+Q.
export function installMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' }
    ])
  )
}
