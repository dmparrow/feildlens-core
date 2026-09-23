import {
  LABEL_FIELD_KEYS,
  LABEL_FIELD_LABELS,
  hasCartonLabelIdentity,
  normalizeLabelFieldValue,
  sanitizeLabelFields,
  type LabelFieldKey,
  type LabelFields,
  type LabelOcrResult,
} from './labelOcr'

export const MIN_RECOGNIZED_LABEL_FIELDS = 4

export type CartonLabelSection = {
  face: number
  half: 'top' | 'bottom'
}

export type CartonLabelScan = {
  id: string
  capturedAt: string
  fields: LabelFields
  rawText: string
  confidence: number
  recognizedFields: number
  section?: CartonLabelSection
  trackId?: string
}

export type CartonLabelMajorityField = {
  field: LabelFieldKey
  label: string
  value: string
  support: number
  observed: number
  coverage: number
}

export type CartonLabelIssue = {
  scanId: string
  cartonNumber: number
  field: LabelFieldKey
  label: string
  expected: string
  actual: string
  status: 'mismatch' | 'unread'
  section?: CartonLabelSection
}

export type CartonLabelSummary = {
  total: number
  status: 'pass' | 'fail' | 'review'
  conforms: boolean
  majorityFields: CartonLabelMajorityField[]
  issues: CartonLabelIssue[]
  mismatchCartons: number
  averageConfidence: number
}

export function countRecognizedLabelFields(fields: LabelFields) {
  return LABEL_FIELD_KEYS.filter((field) => fields[field].trim()).length
}

export function createCartonLabelScan(
  ocr: LabelOcrResult,
  section?: CartonLabelSection,
  trackId?: string,
): CartonLabelScan {
  const fields = sanitizeLabelFields(ocr.fields)
  return {
    id: crypto.randomUUID(),
    capturedAt: new Date().toISOString(),
    fields,
    rawText: ocr.rawText,
    confidence: ocr.confidence,
    recognizedFields: hasCartonLabelIdentity({ ...ocr, fields }) ? countRecognizedLabelFields(fields) : 0,
    section,
    trackId,
  }
}

function dominantValue(scans: CartonLabelScan[], field: LabelFieldKey) {
  const totals = new Map<string, { count: number; display: string }>()
  let observed = 0

  scans.forEach((scan) => {
    const display = scan.fields[field].trim()
    const normalized = normalizeLabelFieldValue(field, display)
    if (!normalized) return
    observed += 1
    const current = totals.get(normalized)
    totals.set(normalized, { count: (current?.count ?? 0) + 1, display: current?.display ?? display })
  })

  const dominant = [...totals.entries()].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))[0]
  if (!dominant) return null

  return {
    normalized: dominant[0],
    display: dominant[1].display,
    count: dominant[1].count,
    observed,
  }
}

export function summarizeCartonLabels(scans: CartonLabelScan[]): CartonLabelSummary {
  if (scans.length === 0) {
    return {
      total: 0,
      status: 'review',
      conforms: false,
      majorityFields: [],
      issues: [],
      mismatchCartons: 0,
      averageConfidence: 0,
    }
  }

  const majorityFields = LABEL_FIELD_KEYS.flatMap((field) => {
    const dominant = dominantValue(scans, field)
    if (!dominant) return []

    const coverage = dominant.observed / scans.length
    const dominance = dominant.count / dominant.observed
    const enoughEvidence = dominant.count >= Math.min(2, scans.length) && coverage >= 0.45 && dominance >= 0.6
    if (!enoughEvidence) return []

    return [{
      field,
      label: LABEL_FIELD_LABELS[field],
      value: dominant.display,
      support: dominant.count,
      observed: dominant.observed,
      coverage,
    }]
  })

  const issues: CartonLabelIssue[] = []

  scans.forEach((scan, index) => {
    majorityFields.forEach((majority) => {
      const actual = scan.fields[majority.field].trim()
      const normalizedActual = normalizeLabelFieldValue(majority.field, actual)
      const normalizedExpected = normalizeLabelFieldValue(majority.field, majority.value)

      if (!normalizedActual) {
        if (majority.coverage >= 0.75) {
          issues.push({
            scanId: scan.id,
            cartonNumber: index + 1,
            field: majority.field,
            label: majority.label,
            expected: majority.value,
            actual: '',
            status: 'unread',
            section: scan.section,
          })
        }
        return
      }

      if (normalizedActual !== normalizedExpected) {
        issues.push({
          scanId: scan.id,
          cartonNumber: index + 1,
          field: majority.field,
          label: majority.label,
          expected: majority.value,
          actual,
          status: 'mismatch',
          section: scan.section,
        })
      }
    })
  })

  const mismatchCartons = new Set(issues.filter((issue) => issue.status === 'mismatch').map((issue) => issue.scanId)).size
  const hasMismatch = mismatchCartons > 0
  const enoughFields = majorityFields.length >= MIN_RECOGNIZED_LABEL_FIELDS
  const status: CartonLabelSummary['status'] = hasMismatch ? 'fail' : enoughFields ? 'pass' : 'review'

  return {
    total: scans.length,
    status,
    conforms: status === 'pass',
    majorityFields,
    issues,
    mismatchCartons,
    averageConfidence: scans.reduce((total, scan) => total + scan.confidence, 0) / scans.length,
  }
}
