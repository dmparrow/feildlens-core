import { BarcodeFormat } from '@zxing/library'
import { describe, expect, it } from 'vitest'

import { appendGtinCheckDigit, detectionSpanPercent, formatsForMode, validateScanPayload } from './barcodes'

const validationRules = { enabled: true, expectedLength: 0, requiredPrefix: '' }

describe('barcode quality rules', () => {
  it('generates and validates GTIN check digits', () => {
    expect(appendGtinCheckDigit('400638133393')).toBe('4006381333931')
    expect(validateScanPayload('4006381333931', BarcodeFormat.EAN_13, validationRules)).toBeNull()
    expect(validateScanPayload('4006381333932', BarcodeFormat.EAN_13, validationRules)).toBe('Invalid EAN-13 checksum')
  })

  it('excludes noisy matrix formats from narrower presets', () => {
    expect(formatsForMode('standard')).not.toContain(BarcodeFormat.MICRO_QR_CODE)
    expect(formatsForMode('products')).not.toContain(BarcodeFormat.QR_CODE)
    expect(formatsForMode('all')).toContain(BarcodeFormat.MICRO_QR_CODE)
  })

  it('enforces custom payload rules', () => {
    expect(validateScanPayload('ABC123', BarcodeFormat.CODE_128, { enabled: true, expectedLength: 6, requiredPrefix: 'ABC' })).toBeNull()
    expect(validateScanPayload('ABC123', BarcodeFormat.CODE_128, { enabled: true, expectedLength: 8, requiredPrefix: '' })).toBe('Expected 8 characters')
  })

  it('measures detection span relative to the source frame', () => {
    const points = [{ getX: () => 10, getY: () => 20 }, { getX: () => 30, getY: () => 25 }]
    expect(detectionSpanPercent(points, 200, 100)).toBe(10)
    expect(detectionSpanPercent([], 200, 100)).toBeNull()
  })
})