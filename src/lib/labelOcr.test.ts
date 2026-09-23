import { describe, expect, it } from 'vitest'

import {
  compareLabelFields,
  getCartonLabelIdentity,
  hasCartonLabelIdentity,
  isValidLabelFieldValue,
  parseLabelText,
  sanitizeLabelFields,
  type LabelFields,
} from './labelOcr'

describe('parseLabelText', () => {
  it('extracts the carton label fields used by the label-check flow', () => {
    const fields = parseLabelText(`
Variety: Hass       Grade: CLASS 1
Grower: 34000       Packer: PK0405
Pack Date: 8/09/26  Pick Date: 5/09/26
Count: 24           Size: 24
Region Northland
TempPC: 40594960
`)

    expect(fields).toEqual({
      ppin: '',
      grower: '34000',
      variety: 'Hass',
      grade: 'CLASS 1',
      packer: 'PK0405',
      pickDate: '05/09/2026',
      packDate: '08/09/2026',
      size: '24',
      count: '24',
      region: 'Northland',
      tempPc: '40594960',
    })
  })

  it('extracts PPIN and two-column white carton label values', () => {
    const fields = parseLabelText(`
Variety: HASS AVOCADO   Count: 48
Grade: CLASS 1          Packer: PK0405
Pick Date: 03/09/26     Pack Date: 07/09/26
Size: 24                PPIN: 04809
`)

    expect(fields).toMatchObject({
      ppin: '04809',
      variety: 'HASS AVOCADO',
      grade: 'CLASS 1',
      packer: 'PK0405',
      pickDate: '03/09/2026',
      packDate: '07/09/2026',
      size: '24',
      count: '48',
    })
  })

  it('accepts PPIN, grower, or strong carton structure as carton-label identity', () => {
    const ppinFields = parseLabelText('PPIN: 123456 Variety: HASS Count: 48 Packer: PK0405 Size: 24')
    const growerFields = parseLabelText('Grower No: 34000 Variety: HASS Count: 48')
    const structuralFields = parseLabelText('Variety: HASS Count: 48')
    const weakFields = parseLabelText('Size: 24 Count: 48')

    expect(getCartonLabelIdentity({ fields: ppinFields, rawText: 'PPIN: 123456 Variety: HASS Count: 48' })).toEqual({ kind: 'ppin', value: '123456' })
    expect(getCartonLabelIdentity({ fields: growerFields, rawText: 'Grower No: 34000 Variety: HASS Count: 48' })).toEqual({ kind: 'grower', value: '34000' })
    expect(getCartonLabelIdentity({ fields: structuralFields, rawText: 'Variety: HASS Count: 48' })).toEqual({ kind: 'structure', value: 'variety,count' })
    expect(getCartonLabelIdentity({ fields: weakFields, rawText: 'Size: 24 Count: 48' })).toBeNull()
  })

  it('keeps weak OCR retryable instead of prematurely marking a carton grey', () => {
    const emptyFields = parseLabelText('')
    const partialFields = parseLabelText('Size: 24 Count: 48')
    const readableNonCarton = 'PROMOTIONAL SHIPPING NOTICE '.repeat(5)

    expect(hasCartonLabelIdentity({ fields: emptyFields, rawText: '' })).toBe(true)
    expect(hasCartonLabelIdentity({ fields: partialFields, rawText: 'Size: 24 Count: 48' })).toBe(true)
    expect(hasCartonLabelIdentity({ fields: parseLabelText(readableNonCarton), rawText: readableNonCarton })).toBe(false)
  })

  it('rejects partial identity and packer reads before conformity', () => {
    expect(isValidLabelFieldValue('grower', '34')).toBe(false)
    expect(isValidLabelFieldValue('packer', 'PKO40')).toBe(false)
    expect(isValidLabelFieldValue('grower', '34000')).toBe(true)
    expect(isValidLabelFieldValue('packer', 'PK0405')).toBe(true)

    const fields = parseLabelText('Grower: 34 Variety: HASS Grade: CLASS 1 Packer: PKO40 Size: 24')
    expect(sanitizeLabelFields(fields)).toMatchObject({ grower: '', packer: '', variety: 'HASS', grade: 'CLASS 1', size: '24' })
  })
})

describe('compareLabelFields', () => {
  it('normalizes dates and text while preserving mismatches', () => {
    const expected: LabelFields = {
      ppin: '04809',
      variety: 'HASS',
      grower: '34000',
      grade: 'CLASS 1',
      packer: 'PK0405',
      pickDate: '5/9/26',
      packDate: '8/9/26',
      size: '24',
      count: '24',
      region: 'Northland',
      tempPc: '40594960',
    }
    const actual = { ...expected, packDate: '09/09/2026', pickDate: '05/09/2026' }
    const comparisons = compareLabelFields(expected, actual)

    expect(comparisons.find((item) => item.field === 'pickDate')?.status).toBe('match')
    expect(comparisons.find((item) => item.field === 'packDate')?.status).toBe('mismatch')
  })
})
