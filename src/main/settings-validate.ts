import { AI_MODELS, DEFAULT_SETTINGS, type Settings, type Theme } from '@shared/types'

export const MIN_POLL_SECONDS = 30
export const MAX_POLL_SECONDS = 3600

const THEMES: readonly Theme[] = ['system', 'light', 'dark']

function clampPollSeconds(value: number): number {
  return Math.min(MAX_POLL_SECONDS, Math.max(MIN_POLL_SECONDS, Math.round(value)))
}

type FieldParsers = { [K in keyof Settings]: (value: unknown) => Settings[K] | undefined }

const FIELDS: FieldParsers = {
  theme: (value) => THEMES.find((theme) => theme === value),
  pollSeconds: (value) =>
    typeof value === 'number' && Number.isFinite(value) ? clampPollSeconds(value) : undefined,
  model: (value) => AI_MODELS.find((model) => model === value),
  notify: (value) => (typeof value === 'boolean' ? value : undefined),
  autoAiGuide: (value) => (typeof value === 'boolean' ? value : undefined)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseStoredSettings(raw: unknown): Settings {
  const settings: Settings = { ...DEFAULT_SETTINGS }
  if (!isRecord(raw)) return settings
  const target: Record<string, unknown> = settings
  for (const key of Object.keys(FIELDS) as (keyof Settings)[]) {
    const parsed = FIELDS[key](raw[key])
    if (parsed !== undefined) target[key] = parsed
  }
  return settings
}

export function parseSettingsPatch(raw: unknown): Partial<Settings> {
  if (!isRecord(raw)) throw new Error('Settings patch must be an object')
  const patch: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!Object.hasOwn(FIELDS, key)) throw new Error(`Unknown setting: ${key}`)
    const parsed = FIELDS[key as keyof Settings](value)
    if (parsed === undefined) throw new Error(`Invalid value for setting ${key}`)
    patch[key] = parsed
  }
  return patch as Partial<Settings>
}
