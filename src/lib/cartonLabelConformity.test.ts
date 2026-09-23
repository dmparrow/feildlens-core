import { describe, expect, it } from 'vitest'

import { createCartonLabelScan, summarizeCartonLabels } from './cartonLabelConformity'
import type { LabelOcrResult } from './labelOcr'

function ocr(overrides: Partial<LabelOcrResult['fields']> = {}, rawText = ''): LabelOcrResult {
  return {
    confidence: 92,
    rawText,
    fields: {
      ppin: '',
      variety: 'HASS AVOCADO',
      grower: '34000',
      grade: 'CLASS 1',
      packer: 'PK0405',
      pickDate: '03/09/2026',
      packDate: '07/09/2026',
      size: '24',
      count: '48',
      region: '',
      tempPc: '',
      ...overrides,
    },
  }
}

describe('summarizeCartonLabels', () => {
  it('passes when the extracted carton label values agree', () => {
    const summary = summarizeCartonLabels([
      createCartonLabelScan(ocr()),
      createCartonLabelScan(ocr()),
      createCartonLabelScan(ocr()),
    ])

    expect(summary.status).toBe('pass')
    expect(summary.mismatchCartons).toBe(0)
    expect(summary.majorityFields.length).toBeGreaterThanOrEqual(4)
  })

  it('uses the completed set majority rather than assuming the first label is correct', () => {
    const summary = summarizeCartonLabels([
      createCartonLabelScan(ocr({ packer: 'PK0999' })),
      createCartonLabelScan(ocr()),
      createCartonLabelScan(ocr()),
    ])

    expect(summary.status).toBe('fail')
    expect(summary.mismatchCartons).toBe(1)
    expect(summary.issues).toContainEqual(expect.objectContaining({
      cartonNumber: 1,
      field: 'packer',
      expected: 'PK0405',
      actual: 'PK0999',
      status: 'mismatch',
    }))
  })

  it('does not count OCR as a valid carton label without PPIN or grower identity', () => {
    const noIdentity = createCartonLabelScan(ocr({ grower: '' }, 'Variety HASS AVOCADO Count 48 Packer PK0405 Size 24'))
    const ppinIdentity = createCartonLabelScan(ocr({ grower: '', ppin: '123456' }, 'PPIN: 123456 Variety HASS AVOCADO Count 48 Packer PK0405 Size 24'))

    expect(noIdentity.recognizedFields).toBe(0)
    expect(ppinIdentity.recognizedFields).toBeGreaterThanOrEqual(4)
  })

  it('drops partial OCR values before they can influence the pallet majority', () => {
    const scan = createCartonLabelScan(ocr({ grower: '34', packer: 'PKO40', ppin: '04809' }))

    expect(scan.fields.grower).toBe('')
    expect(scan.fields.packer).toBe('')
    expect(scan.fields.ppin).toBe('04809')
  })
})
