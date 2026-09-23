const TESSERACT_SCRIPT = 'https://cdn.jsdelivr.net/npm/tesseract.js@6/dist/tesseract.min.js'

type TesseractProgress = {
  status?: string
  progress?: number
}

type TesseractResult = { data: { text: string; confidence: number } }

type TesseractWorker = {
  recognize: (image: Blob | string) => Promise<TesseractResult>
  setParameters?: (parameters: Record<string, string>) => Promise<unknown>
  terminate?: () => Promise<unknown>
}

type TesseractApi = {
  recognize: (
    image: Blob | string,
    language?: string,
    options?: { logger?: (message: TesseractProgress) => void },
  ) => Promise<TesseractResult>
  createWorker?: (
    languages?: string | string[],
    oem?: number,
    options?: { logger?: (message: TesseractProgress) => void },
  ) => Promise<TesseractWorker>
}

type OcrWorkerSlot = {
  worker: TesseractWorker
  busy: boolean
  progress: { current?: (progress: number, status: string) => void }
}

declare global {
  interface Window {
    Tesseract?: TesseractApi
  }
}

export type LabelFieldKey = 'ppin' | 'grower' | 'variety' | 'grade' | 'packer' | 'pickDate' | 'packDate' | 'size' | 'count' | 'region' | 'tempPc'

export type LabelFields = Record<LabelFieldKey, string>

export type LabelOcrResult = {
  fields: LabelFields
  rawText: string
  confidence: number
}

export type LabelFieldComparison = {
  field: LabelFieldKey
  label: string
  expected: string
  actual: string
  status: 'match' | 'mismatch' | 'unread' | 'ignored'
}

export const LABEL_FIELD_KEYS: LabelFieldKey[] = ['ppin', 'grower', 'variety', 'grade', 'packer', 'pickDate', 'packDate', 'size', 'count', 'region', 'tempPc']

export const LABEL_FIELD_LABELS: Record<LabelFieldKey, string> = {
  ppin: 'PPIN',
  grower: 'Grower',
  variety: 'Variety',
  grade: 'Grade',
  packer: 'Packer',
  pickDate: 'Pick date',
  packDate: 'Pack date',
  size: 'Size',
  count: 'Count',
  region: 'Region',
  tempPc: 'TempPC',
}

let workerPoolPromise: Promise<OcrWorkerSlot[]> | null = null

function emptyFields(): LabelFields {
  return {
    ppin: '',
    grower: '',
    variety: '',
    grade: '',
    packer: '',
    pickDate: '',
    packDate: '',
    size: '',
    count: '',
    region: '',
    tempPc: '',
  }
}

function capture(text: string, pattern: RegExp) {
  return text.match(pattern)?.[1]?.trim().replace(/\s+/g, ' ') ?? ''
}

function normalizeDate(value: string) {
  const parts = value.trim().replace(/[.-]/g, '/').split('/')
  if (parts.length !== 3) return value.trim()
  const [day, month, year] = parts
  const fullYear = year.length === 2 ? `20${year}` : year
  return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${fullYear}`
}

function validDate(value: string) {
  const normalized = normalizeDate(value)
  const match = normalized.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!match) return false
  const day = Number(match[1])
  const month = Number(match[2])
  const year = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

export function normalizeLabelFieldValue(field: LabelFieldKey, value: string) {
  if (!value) return ''
  if (field === 'pickDate' || field === 'packDate') return normalizeDate(value)
  if (field === 'tempPc' || field === 'count') return value.replace(/\D/g, '')
  if (field === 'size') return value.replace(/\s/g, '').toUpperCase()
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function isValidLabelFieldValue(field: LabelFieldKey, value: string) {
  const trimmed = value.trim()
  if (!trimmed) return false
  const normalized = normalizeLabelFieldValue(field, trimmed)

  if (field === 'ppin' || field === 'grower') return /^[A-Z0-9-]{4,16}$/.test(trimmed.toUpperCase())
  if (field === 'packer') {
    if (normalized.startsWith('PK')) return /^PK[A-Z0-9]{4,8}$/.test(normalized)
    return /^[A-Z0-9]{5,12}$/.test(normalized)
  }
  if (field === 'grade') return /^(?:CLASS)?[123]$/.test(normalized)
  if (field === 'pickDate' || field === 'packDate') return validDate(trimmed)
  if (field === 'count') {
    const count = Number(normalized)
    return /^\d{1,3}$/.test(normalized) && count >= 1 && count <= 999
  }
  if (field === 'size') return /^\d{1,3}(?:\/\d{1,3})?$/.test(normalized)
  if (field === 'tempPc') return /^\d{7,10}$/.test(normalized)
  if (field === 'variety') return normalized.length >= 3 && normalized.length <= 32
  if (field === 'region') return normalized.length >= 2 && normalized.length <= 30
  return true
}

export function sanitizeLabelFields(fields: LabelFields): LabelFields {
  return LABEL_FIELD_KEYS.reduce<LabelFields>((clean, field) => {
    clean[field] = isValidLabelFieldValue(field, fields[field]) ? fields[field].trim() : ''
    return clean
  }, emptyFields())
}

export function getCartonLabelIdentity(ocr: Pick<LabelOcrResult, 'fields' | 'rawText'>) {
  const ppin = ocr.fields.ppin.trim() || capture(ocr.rawText, /\bP\s*P\s*I\s*N(?:\s*(?:No|Number))?\s*:?\s*([A-Z0-9-]+)/i)
  if (isValidLabelFieldValue('ppin', ppin)) return { kind: 'ppin' as const, value: ppin }

  const grower = ocr.fields.grower.trim()
  if (isValidLabelFieldValue('grower', grower)) return { kind: 'grower' as const, value: grower }

  // A moving pallet sweep will occasionally lose the PPIN/grower token while
  // still reading several unmistakable carton-label fields. Do not permanently
  // grey those labels after a single weak identity read. Requiring at least one
  // strong carton-specific field plus a second validated field keeps generic
  // white stickers out while allowing the normal minimum-field gate to decide
  // whether this read is accepted or retried.
  const fields = sanitizeLabelFields(ocr.fields)
  const evidenceFields = LABEL_FIELD_KEYS.filter((field) => field !== 'ppin' && field !== 'grower' && fields[field].trim())
  const strongEvidenceFields: LabelFieldKey[] = ['variety', 'grade', 'packer', 'pickDate', 'packDate', 'tempPc']
  const strongEvidence = strongEvidenceFields.filter((field) => fields[field].trim())
  if (strongEvidence.length >= 1 && evidenceFields.length >= 2) {
    return { kind: 'structure' as const, value: evidenceFields.join(',') }
  }

  return null
}

export function hasCartonLabelIdentity(ocr: Pick<LabelOcrResult, 'fields' | 'rawText'>) {
  if (getCartonLabelIdentity(ocr)) return true

  const fields = sanitizeLabelFields(ocr.fields)
  const evidenceFields = LABEL_FIELD_KEYS.filter((field) => field !== 'ppin' && field !== 'grower' && fields[field].trim())
  if (evidenceFields.length > 0) return true

  // A weak crop or motion blur commonly produces little or no usable OCR text.
  // Treat that as uncertain and let the scanner retry instead of permanently
  // painting a real carton label grey. Only confidently readable, substantial
  // non-carton text should be classified as a non-target label.
  const text = ocr.rawText.replace(/\s+/g, ' ').trim()
  if (text.length < 96) return true

  return /\b(?:P\s*P\s*I\s*N|Grower|Variety|Grade|Packer|Pick\s*Date|Pack\s*Date|Size|Count|Region|Temp\s*P?C)\b/i.test(text)
}

export function parseLabelText(rawText: string): LabelFields {
  const text = rawText
    .replace(/\r/g, '')
    .replace(/[|]/g, ' ')
    .replace(/\bPick\s*Dale\b/gi, 'Pick Date')
    .replace(/\bPack\s*Dale\b/gi, 'Pack Date')
  const fields = emptyFields()
  const datePattern = '(\\d{1,2}[\\/.-]\\d{1,2}[\\/.-]\\d{2,4})'
  const nextKey = '(?=\\s+(?:Grade|Grower(?:\\s*(?:No|Number|Code))?|PPIN(?:\\s*(?:No|Number))?|Packer|Pick\\s*Date|Pack\\s*Date|Size|Count|Region|Temp\\s*P?C|Variety)\\b|\\n|$)'

  fields.ppin = capture(text, /\bP\s*P\s*I\s*N(?:\s*(?:No|Number))?\s*:?\s*([A-Z0-9-]+)/i)
  fields.grower = capture(text, /\bGrower(?:\s*(?:No|Number|Code))?\s*:?\s*([A-Z0-9-]+)/i)
  fields.variety = capture(text, new RegExp(`\\bVariety\\s*:?\\s*([A-Za-z][A-Za-z0-9 -]{0,28}?)${nextKey}`, 'i'))
  fields.grade = capture(text, /\bGrade\s*:?\s*(CLASS\s*[A-Z0-9]+)/i)
  fields.packer = capture(text, /\bPacker\s*:?\s*([A-Z0-9-]+)/i)
  fields.pickDate = normalizeDate(capture(text, new RegExp(`\\bPick\\s*Date\\s*:?\\s*${datePattern}`, 'i')))
  fields.packDate = normalizeDate(capture(text, new RegExp(`\\bPack\\s*Date\\s*:?\\s*${datePattern}`, 'i')))
  fields.size = capture(text, /\bSize\s*:?\s*([0-9]+(?:\s*\/\s*[0-9]+)?)/i).replace(/\s/g, '')
  fields.count = capture(text, /\bCount\s*:?\s*([0-9]+)/i)
  fields.region = capture(text, new RegExp(`\\bRegion\\s*:?\\s*([A-Za-z][A-Za-z ]{1,28}?)${nextKey}`, 'i'))
  fields.tempPc = capture(text, /\bTemp\s*P?C\s*:?\s*([0-9]{7,10})/i)

  return fields
}

export function compareLabelFields(expected: LabelFields, actual: LabelFields): LabelFieldComparison[] {
  return LABEL_FIELD_KEYS.map((field) => {
    const expectedValue = expected[field].trim()
    const actualValue = actual[field].trim()
    let status: LabelFieldComparison['status'] = 'ignored'

    if (expectedValue && !actualValue) status = 'unread'
    else if (expectedValue && actualValue) {
      status = normalizeLabelFieldValue(field, expectedValue) === normalizeLabelFieldValue(field, actualValue) ? 'match' : 'mismatch'
    }

    return {
      field,
      label: LABEL_FIELD_LABELS[field],
      expected: expectedValue,
      actual: actualValue,
      status,
    }
  })
}

function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract)

  return new Promise<TesseractApi>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${TESSERACT_SCRIPT}"]`)
    const script = existing ?? document.createElement('script')
    const handleLoad = () => window.Tesseract ? resolve(window.Tesseract) : reject(new Error('OCR engine did not initialize.'))
    const handleError = () => reject(new Error('OCR engine could not be loaded. Check the network connection.'))

    script.addEventListener('load', handleLoad, { once: true })
    script.addEventListener('error', handleError, { once: true })

    if (!existing) {
      script.src = TESSERACT_SCRIPT
      script.async = true
      document.head.append(script)
    }
  })
}

async function createWorkerPool() {
  const tesseract = await loadTesseract()
  if (!tesseract.createWorker) return []

  const workerCount = (navigator.hardwareConcurrency ?? 2) >= 4 ? 2 : 1
  return Promise.all(Array.from({ length: workerCount }, async () => {
    const progress: OcrWorkerSlot['progress'] = {}
    const worker = await tesseract.createWorker?.('eng', 1, {
      logger: (message) => {
        if (typeof message.progress === 'number') {
          progress.current?.(Math.round(message.progress * 100), message.status ?? 'Reading label')
        }
      },
    })
    if (!worker) throw new Error('OCR worker could not be created.')
    await worker.setParameters?.({
      tessedit_pageseg_mode: '6',
      preserve_interword_spaces: '1',
    })
    return { worker, busy: false, progress }
  }))
}

async function getWorkerPool() {
  if (!workerPoolPromise) {
    workerPoolPromise = createWorkerPool().catch((error) => {
      workerPoolPromise = null
      throw error
    })
  }
  return workerPoolPromise
}

async function acquireWorker() {
  const slots = await getWorkerPool()
  if (!slots.length) return null

  while (true) {
    const slot = slots.find((candidate) => !candidate.busy)
    if (slot) {
      slot.busy = true
      return slot
    }
    await new Promise((resolve) => window.setTimeout(resolve, 20))
  }
}

export async function warmLabelOcr() {
  await getWorkerPool()
}

async function prepareImage(image: Blob): Promise<Blob> {
  if (typeof createImageBitmap !== 'function') return image

  try {
    const bitmap = await createImageBitmap(image)
    const maxDimension = 1200
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) return image

    context.filter = 'grayscale(1) contrast(1.5) brightness(1.04)'
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92))
    return blob ?? image
  } catch {
    return image
  }
}

export async function recognizeLabel(image: Blob, onProgress?: (progress: number, status: string) => void): Promise<LabelOcrResult> {
  const prepared = await prepareImage(image)
  const tesseract = await loadTesseract()
  const slot = await acquireWorker().catch(() => null)
  let result: TesseractResult

  if (slot) {
    slot.progress.current = onProgress
    try {
      result = await slot.worker.recognize(prepared)
    } finally {
      slot.progress.current = undefined
      slot.busy = false
    }
  } else {
    result = await tesseract.recognize(prepared, 'eng', {
      logger: (message) => {
        if (typeof message.progress === 'number') onProgress?.(Math.round(message.progress * 100), message.status ?? 'Reading label')
      },
    })
  }

  return {
    fields: parseLabelText(result.data.text),
    rawText: result.data.text,
    confidence: result.data.confidence,
  }
}
