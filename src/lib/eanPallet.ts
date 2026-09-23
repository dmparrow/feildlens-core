export type EanCount = {
  ean: string
  count: number
}

export type EanPalletSummary = {
  total: number
  conforms: boolean
  consensusEan: string
  counts: EanCount[]
}

const GTIN_LENGTHS = new Set([8, 12, 13, 14])

export function normalizeEan(value: string) {
  return value.replace(/\D/g, '')
}

function hasValidGtinCheckDigit(value: string) {
  if (!GTIN_LENGTHS.has(value.length) || !/^\d+$/.test(value)) return false

  const digits = [...value].map(Number)
  const checkDigit = digits.at(-1) ?? -1
  const body = digits.slice(0, -1)
  const weightedTotal = [...body].reverse().reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0)
  const expectedCheckDigit = (10 - (weightedTotal % 10)) % 10
  return checkDigit === expectedCheckDigit
}

export function canonicalizeEan(value: string) {
  const gtin = normalizeEan(value)
  if (!hasValidGtinCheckDigit(gtin)) return gtin

  // UPC-A is the same trade item number as EAN-13 with a leading zero.
  if (gtin.length === 12) return `0${gtin}`

  // GS1 commonly encodes an EAN-13 as GTIN-14 with indicator digit zero.
  if (gtin.length === 14 && gtin.startsWith('0')) return gtin.slice(1)

  return gtin
}

export function isValidEan(value: string) {
  return hasValidGtinCheckDigit(normalizeEan(value))
}

/**
 * Extract a trade item code from the raw payload returned by a barcode reader.
 * Supports direct EAN/UPC/GTIN values plus common GS1 QR, Data Matrix and Code 128 payloads.
 * Returns a canonical EAN/GTIN value, or an empty string when the decoded symbol contains
 * no usable trade item number.
 */
export function extractEanFromScan(rawValue: string) {
  const raw = rawValue.trim()
  if (!raw) return ''

  const compactNumeric = raw.replace(/[\s-]/g, '')
  if (/^\d+$/.test(compactNumeric) && hasValidGtinCheckDigit(compactNumeric)) {
    return canonicalizeEan(compactNumeric)
  }

  // GS1 Application Identifier 01 carries a 14-digit GTIN. This covers element strings,
  // Digital Link style URLs/query strings and scanner payloads containing the symbology prefix.
  const gs1Candidates = [
    ...raw.matchAll(/\(01\)\s*(\d{14})/g),
    ...raw.matchAll(/\/01\/(\d{14})(?:\D|$)/g),
    ...raw.matchAll(/[?&]01=(\d{14})(?:\D|$)/g),
    ...raw.matchAll(/01(\d{14})/g),
  ]

  for (const match of gs1Candidates) {
    const candidate = match[1]
    if (candidate && hasValidGtinCheckDigit(candidate)) return canonicalizeEan(candidate)
  }

  // Some 2D codes carry a larger text payload with the GTIN as a standalone field.
  // Prefer longer GTIN forms and only accept candidates with a valid check digit.
  const embedded = [...raw.matchAll(/(?:^|\D)(\d{12,14})(?!\d)/g)]
    .map((match) => match[1])
    .filter((candidate): candidate is string => Boolean(candidate) && hasValidGtinCheckDigit(candidate))
    .sort((a, b) => b.length - a.length)

  return embedded[0] ? canonicalizeEan(embedded[0]) : ''
}

export function summarizeEanScans(scans: string[]): EanPalletSummary {
  const totals = new Map<string, number>()
  scans.forEach((value) => {
    const ean = canonicalizeEan(value)
    if (!ean) return
    totals.set(ean, (totals.get(ean) ?? 0) + 1)
  })

  const counts = [...totals.entries()]
    .map(([ean, count]) => ({ ean, count }))
    .sort((a, b) => b.count - a.count || a.ean.localeCompare(b.ean))

  return {
    total: scans.length,
    conforms: counts.length === 1 && scans.length > 0,
    consensusEan: counts[0]?.ean ?? '',
    counts,
  }
}
