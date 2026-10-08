import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/types'
import { parseSettingsPatch, parseStoredSettings } from './settings-validate'

describe('parseStoredSettings', () => {
  it('returns defaults for a corrupt or non-object file', () => {
    expect(parseStoredSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(parseStoredSettings('nope')).toEqual(DEFAULT_SETTINGS)
  })

  it('keeps valid fields, defaults invalid ones, and clamps the poll interval', () => {
    const stored = parseStoredSettings({
      theme: 'dark',
      pollSeconds: 5,
      model: 'gpt-4',
      chatEffort: 'ultra',
      outputStyle: 'verbose',
      notify: 'yes',
      autoAiGuide: false,
      autoRefreshStaleGuides: true
    })
    expect(stored).toEqual({
      ...DEFAULT_SETTINGS,
      theme: 'dark',
      pollSeconds: 30,
      autoAiGuide: false,
      autoRefreshStaleGuides: true
    })
  })
})

describe('parseSettingsPatch', () => {
  it('clamps pollSeconds to the 30 to 3600 range', () => {
    expect(parseSettingsPatch({ pollSeconds: 100000 })).toEqual({ pollSeconds: 3600 })
    expect(parseSettingsPatch({ pollSeconds: 1 })).toEqual({ pollSeconds: 30 })
  })

  it('rejects unknown keys and wrong types instead of ignoring them', () => {
    expect(() => parseSettingsPatch({ colour: 'red' })).toThrow('Unknown setting: colour')
    expect(() => parseSettingsPatch({ notify: 'yes' })).toThrow('Invalid value for setting notify')
    expect(() => parseSettingsPatch({ model: 'claude-opus-4' })).toThrow('Invalid value')
  })
})
