import { BarcodeFormat } from '@zxing/library'

export type ScanFormatMode = 'standard' | 'products' | 'matrix' | 'all'

export type PayloadRules = {
  enabled: boolean
  expectedLength: number
  requiredPrefix: string
}

const allFormats = Object.values(BarcodeFormat).filter((value): value is BarcodeFormat => typeof value === 'number')

const productFormats = [
  BarcodeFormat.CODABAR,
  BarcodeFormat.CODE_39,
  BarcodeFormat.CODE_93,
  BarcodeFormat.CODE_128,
  BarcodeFormat.EAN_8,
  BarcodeFormat.EAN_13,
  BarcodeFormat.ITF,
  BarcodeFormat.RSS_14,
  BarcodeFormat.RSS_EXPANDED,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
]

const matrixFormats = [
  BarcodeFormat.AZTEC,
  BarcodeFormat.DATA_MATRIX,
  BarcodeFormat.MAXICODE,
  BarcodeFormat.PDF_417,
  BarcodeFormat.QR_CODE,
]

export const scanFormatOptions: { value: ScanFormatMode; label: string }[] = [
  { value: 'standard', label: 'Standard codes' },
  { value: 'products', label: 'Product barcodes' },
  { value: 'matrix', label: '2D codes' },
  { value: 'all', label: 'All including Micro QR' },
]

export function formatsForMode(mode: ScanFormatMode) {
  if (mode === 'products') return productFormats
  if (mode === 'matrix') return matrixFormats
  if (mode === 'all') return allFormats
  return allFormats.filter((format) => format !== BarcodeFormat.MICRO_QR_CODE)
}

export function detectionSpanPercent(points: { getX: () => number; getY: () => number }[], width: number, height: number) {
  if (points.length < 2 || width <= 0 || height <= 0) return null
  const xValues = points.map((point) => point.getX())
  const yValues = points.map((point) => point.getY())
  const widthPercent = ((Math.max(...xValues) - Math.min(...xValues)) / width) * 100
  const heightPercent = ((Math.max(...yValues) - Math.min(...yValues)) / height) * 100
  return Math.max(widthPercent, heightPercent)
}

function hasValidGtinCheckDigit(value: string) {
  if (!/^\d+$/.test(value) || value.length < 2) return false
  const body = value.slice(0, -1)
  const expected = appendGtinCheckDigit(body).at(-1)
  return value.at(-1) === expected
}

export function validateScanPayload(rawValue: string, format: BarcodeFormat, rules: PayloadRules) {
  if (!rawValue) return 'Empty payload rejected'
  if (!rules.enabled) return null
  if (rules.expectedLength > 0 && rawValue.length !== rules.expectedLength) return `Expected ${rules.expectedLength} characters`
  if (rules.requiredPrefix && !rawValue.startsWith(rules.requiredPrefix)) return `Expected prefix ${rules.requiredPrefix}`

  if (format === BarcodeFormat.EAN_8 && (!/^\d{8}$/.test(rawValue) || !hasValidGtinCheckDigit(rawValue))) return 'Invalid EAN-8 checksum'
  if (format === BarcodeFormat.EAN_13 && (!/^\d{13}$/.test(rawValue) || !hasValidGtinCheckDigit(rawValue))) return 'Invalid EAN-13 checksum'
  if (format === BarcodeFormat.UPC_A && (!/^\d{12}$/.test(rawValue) || !hasValidGtinCheckDigit(rawValue))) return 'Invalid UPC-A checksum'
  if (format === BarcodeFormat.UPC_E && !/^\d{8}$/.test(rawValue)) return 'Invalid UPC-E payload'
  if (format === BarcodeFormat.ITF && (!/^\d{6,14}$/.test(rawValue) || rawValue.length % 2 !== 0)) return 'Invalid ITF payload'
  if (format === BarcodeFormat.ITF && rawValue.length === 14 && !hasValidGtinCheckDigit(rawValue)) return 'Invalid GTIN-14 checksum'
  if (format === BarcodeFormat.CODE_39 && !/^[0-9A-Z .\-$/+%]+$/.test(rawValue)) return 'Invalid Code 39 characters'
  if (format === BarcodeFormat.CODABAR && !/^[A-D][0-9\-$:/.+]+[A-D]$/.test(rawValue)) return 'Invalid Codabar characters'
  return null
}

export function formatName(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase())
}

export function appendGtinCheckDigit(base: string) {
  const sum = [...base]
    .reverse()
    .reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 3 : 1), 0)
  return `${base}${(10 - (sum % 10)) % 10}`
}

export function randomDigits(length: number) {
  const values = crypto.getRandomValues(new Uint8Array(length))
  return [...values].map((value) => value % 10).join('')
}
