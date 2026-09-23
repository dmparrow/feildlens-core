import type { PayloadRules, ScanFormatMode } from './barcodes'

export interface ScannerPreferences {
  autoAdvance: boolean
  soundEnabled: boolean
  formatMode: ScanFormatMode
  confirmationFrames: 2 | 3
  minimumSize: number
  payloadRules: PayloadRules
}

const STORAGE_KEY = 'fieldlens-scanner-preferences'

export const defaultScannerPreferences: ScannerPreferences = {
  autoAdvance: true,
  soundEnabled: false,
  formatMode: 'standard',
  confirmationFrames: 2,
  minimumSize: 6,
  payloadRules: { enabled: true, expectedLength: 0, requiredPrefix: '' },
}

export function loadScannerPreferences(): ScannerPreferences {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<ScannerPreferences>
    return {
      autoAdvance: typeof stored.autoAdvance === 'boolean' ? stored.autoAdvance : defaultScannerPreferences.autoAdvance,
      soundEnabled: typeof stored.soundEnabled === 'boolean' ? stored.soundEnabled : defaultScannerPreferences.soundEnabled,
      formatMode: stored.formatMode === 'standard' || stored.formatMode === 'products' || stored.formatMode === 'matrix' || stored.formatMode === 'all' ? stored.formatMode : defaultScannerPreferences.formatMode,
      confirmationFrames: stored.confirmationFrames === 3 ? 3 : 2,
      minimumSize: typeof stored.minimumSize === 'number' ? Math.min(20, Math.max(0, stored.minimumSize)) : defaultScannerPreferences.minimumSize,
      payloadRules: {
        enabled: typeof stored.payloadRules?.enabled === 'boolean' ? stored.payloadRules.enabled : defaultScannerPreferences.payloadRules.enabled,
        expectedLength: typeof stored.payloadRules?.expectedLength === 'number' ? Math.min(256, Math.max(0, stored.payloadRules.expectedLength)) : defaultScannerPreferences.payloadRules.expectedLength,
        requiredPrefix: typeof stored.payloadRules?.requiredPrefix === 'string' ? stored.payloadRules.requiredPrefix : defaultScannerPreferences.payloadRules.requiredPrefix,
      },
    }
  } catch {
    return structuredClone(defaultScannerPreferences)
  }
}

export function saveScannerPreferences(preferences: ScannerPreferences) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences))
}

export function resetScannerPreferences() {
  localStorage.removeItem(STORAGE_KEY)
  return structuredClone(defaultScannerPreferences)
}
