import { readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { app, nativeTheme } from 'electron'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types'
import { parseStoredSettings } from './settings-validate'

export class SettingsStore {
  private settings: Settings
  private readonly listeners = new Set<(settings: Settings) => void>()
  private readonly file = join(app.getPath('userData'), 'settings.json')

  constructor() {
    this.settings = this.load()
    nativeTheme.themeSource = this.settings.theme
  }

  get(): Settings {
    return this.settings
  }

  async set(patch: Partial<Settings>): Promise<Settings> {
    this.settings = { ...this.settings, ...patch }
    nativeTheme.themeSource = this.settings.theme
    await this.save()
    for (const listener of this.listeners) listener(this.settings)
    return this.settings
  }

  onChange(listener: (settings: Settings) => void): void {
    this.listeners.add(listener)
  }

  private load(): Settings {
    try {
      return parseStoredSettings(JSON.parse(readFileSync(this.file, 'utf8')))
    } catch {
      return { ...DEFAULT_SETTINGS }
    }
  }

  private async save(): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    await writeFile(tmp, JSON.stringify(this.settings, null, 2))
    await rename(tmp, this.file)
  }
}
