import { describe, expect, it } from 'vitest'

import { extractEanFromScan, isValidEan, summarizeEanScans } from './eanPallet'

describe('isValidEan', () => {
  it('accepts valid EAN, UPC and GTIN check digits', () => {
    expect(isValidEan('4006381333931')).toBe(true)
    expect(isValidEan('96385074')).toBe(true)
    expect(isValidEan('036000291452')).toBe(true)
    expect(isValidEan('04006381333931')).toBe(true)
  })

  it('rejects invalid lengths and check digits', () => {
    expect(isValidEan('4006381333932')).toBe(false)
    expect(isValidEan('12345')).toBe(false)
  })
})

describe('extractEanFromScan', () => {
  it('returns direct EAN values unchanged', () => {
    expect(extractEanFromScan('4006381333931')).toBe('4006381333931')
    expect(extractEanFromScan('96385074')).toBe('96385074')
  })

  it('canonicalizes UPC-A to EAN-13', () => {
    expect(extractEanFromScan('036000291452')).toBe('0036000291452')
  })

  it('extracts a GS1 AI 01 GTIN from 2D and element-string payloads', () => {
    expect(extractEanFromScan('(01)04006381333931(10)LOT123')).toBe('4006381333931')
    expect(extractEanFromScan('https://example.com/01/04006381333931/10/LOT123')).toBe('4006381333931')
  })

  it('does not treat an unrelated marketing QR as an EAN', () => {
    expect(extractEanFromScan('https://example.com/find-out-more')).toBe('')
  })
})

describe('summarizeEanScans', () => {
  it('passes only when every scanned label has the same EAN', () => {
    expect(summarizeEanScans(['4006381333931', '4006381333931', '4006381333931'])).toMatchObject({
      total: 3,
      conforms: true,
      consensusEan: '4006381333931',
      counts: [{ ean: '4006381333931', count: 3 }],
    })
  })

  it('finds the majority EAN without assuming the first scan is correct', () => {
    const summary = summarizeEanScans([
      '96385074',
      '4006381333931',
      '4006381333931',
      '4006381333931',
    ])

    expect(summary.conforms).toBe(false)
    expect(summary.consensusEan).toBe('4006381333931')
    expect(summary.counts).toEqual([
      { ean: '4006381333931', count: 3 },
      { ean: '96385074', count: 1 },
    ])
  })
})
