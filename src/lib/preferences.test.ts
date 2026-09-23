import { afterEach, describe, expect, it, vi } from 'vitest'

import { defaultScannerPreferences, loadScannerPreferences, resetScannerPreferences, saveScannerPreferences } from './preferences'

const values = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => values.set(key, value),
  removeItem: (key: string) => values.delete(key),
})

describe('scanner preferences', () => {
  afterEach(() => values.clear())

  it('round-trips scanner settings', () => {
    const preferences = {
      ...defaultScannerPreferences,
      autoAdvance: false,
      confirmationFrames: 3 as const,
      payloadRules: { enabled: true, expectedLength: 12, requiredPrefix: 'FL-' },
    }

    saveScannerPreferences(preferences)

    expect(loadScannerPreferences()).toEqual(preferences)
  })

  it('falls back to defaults for invalid stored data', () => {
    localStorage.setItem('fieldlens-scanner-preferences', '{invalid')
    expect(loadScannerPreferences()).toEqual(defaultScannerPreferences)
    expect(resetScannerPreferences()).toEqual(defaultScannerPreferences)
  })
})