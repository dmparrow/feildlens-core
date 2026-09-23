import Dexie, { type EntityTable } from 'dexie'
import type { CartonLabelMajorityField, CartonLabelScan } from './cartonLabelConformity'
import type { LabelFields } from './labelOcr'

export type ScanRecord = {
  id: string
  rawValue: string
  format: string
  isDuplicate: boolean
  scannedAt: string
  syncStatus: 'local' | 'synced'
}

export type EanPalletOcrRecord = {
  ean: string
  fields: LabelFields
  rawText: string
  confidence: number
  comparisonSource: string
  comparisonStatus: 'not-run' | 'pass' | 'fail' | 'review'
}

export type EanPalletSessionRecord = {
  id: string
  targetCount: number
  scans: string[]
  startedAt: string
  updatedAt: string
  completedAt?: string
  status: 'active' | 'complete'
  conforms?: boolean
  consensusEan?: string
  uniqueEanCount?: number
  ocr?: EanPalletOcrRecord
}

export type PalletLabelSessionRecord = {
  id: string
  targetCount: number
  labels: CartonLabelScan[]
  startedAt: string
  updatedAt: string
  completedAt?: string
  status: 'active' | 'complete'
  conforms?: boolean
  resultStatus?: 'pass' | 'fail' | 'review'
  mismatchCartons?: number
  majorityFields?: CartonLabelMajorityField[]
}

class FieldLensDatabase extends Dexie {
  scans!: EntityTable<ScanRecord, 'id'>
  eanPalletSessions!: EntityTable<EanPalletSessionRecord, 'id'>
  palletLabelSessions!: EntityTable<PalletLabelSessionRecord, 'id'>

  constructor() {
    super('fieldlens-pwa')
    this.version(1).stores({
      scans: 'id, rawValue, format, isDuplicate, scannedAt, syncStatus',
    })
    this.version(2).stores({
      scans: 'id, rawValue, format, isDuplicate, scannedAt, syncStatus',
      eanPalletSessions: 'id, startedAt, updatedAt, completedAt, status',
    })
    this.version(3).stores({
      scans: 'id, rawValue, format, isDuplicate, scannedAt, syncStatus',
      eanPalletSessions: 'id, startedAt, updatedAt, completedAt, status',
      palletLabelSessions: 'id, startedAt, updatedAt, completedAt, status',
    })
  }
}

export const database = new FieldLensDatabase()

export async function recordScan(rawValue: string, format: string) {
  const record = await database.transaction('rw', database.scans, async () => {
    const existing = await database.scans.where('rawValue').equals(rawValue).first()
    const nextRecord: ScanRecord = {
      id: crypto.randomUUID(),
      rawValue,
      format,
      isDuplicate: Boolean(existing),
      scannedAt: new Date().toISOString(),
      syncStatus: 'local',
    }

    await database.scans.add(nextRecord)
    return nextRecord
  })


  return record
}

export async function startEanPalletSession(targetCount: number) {
  const now = new Date().toISOString()
  const record: EanPalletSessionRecord = {
    id: crypto.randomUUID(),
    targetCount,
    scans: [],
    startedAt: now,
    updatedAt: now,
    status: 'active',
  }
  await database.eanPalletSessions.add(record)
  return record
}

export function saveEanPalletScans(id: string, scans: string[]) {
  return database.eanPalletSessions.update(id, {
    scans,
    updatedAt: new Date().toISOString(),
  })
}

export function finishEanPalletSession(id: string, details: Pick<EanPalletSessionRecord, 'conforms' | 'consensusEan' | 'uniqueEanCount'>) {
  const now = new Date().toISOString()
  return database.eanPalletSessions.update(id, {
    ...details,
    status: 'complete',
    completedAt: now,
    updatedAt: now,
  })
}

export function saveEanPalletOcr(id: string, ocr: EanPalletOcrRecord) {
  return database.eanPalletSessions.update(id, {
    ocr,
    updatedAt: new Date().toISOString(),
  })
}

export async function startPalletLabelSession(targetCount: number) {
  const now = new Date().toISOString()
  const record: PalletLabelSessionRecord = {
    id: crypto.randomUUID(),
    targetCount,
    labels: [],
    startedAt: now,
    updatedAt: now,
    status: 'active',
  }
  await database.palletLabelSessions.add(record)
  return record
}

export function savePalletLabelScans(id: string, labels: CartonLabelScan[]) {
  return database.palletLabelSessions.update(id, {
    labels,
    updatedAt: new Date().toISOString(),
  })
}

export function finishPalletLabelSession(
  id: string,
  details: Pick<PalletLabelSessionRecord, 'conforms' | 'resultStatus' | 'mismatchCartons' | 'majorityFields'>,
) {
  const now = new Date().toISOString()
  return database.palletLabelSessions.update(id, {
    ...details,
    status: 'complete',
    completedAt: now,
    updatedAt: now,
  })
}

export function clearScanHistory() {
  return database.scans.clear()
}

export function deleteScan(id: string) {
  return database.scans.delete(id)
}

export function restoreScan(scan: ScanRecord) {
  return database.scans.put(scan)
}

export function countDistinctScanValues(scans: ScanRecord[]) {
  return new Set(scans.map((scan) => scan.rawValue)).size
}

export function serializeScanHistory(scans: ScanRecord[]) {
  return JSON.stringify(scans, null, 2)
}
