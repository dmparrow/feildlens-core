import 'fake-indexeddb/auto'

import { beforeEach, describe, expect, it } from 'vitest'

import { clearScanHistory, countDistinctScanValues, database, deleteScan, recordScan, restoreScan, serializeScanHistory } from './database'

describe('scan persistence', () => {
  beforeEach(async () => {
    await clearScanHistory()
  })

  it('marks repeated values as duplicates inside storage', async () => {
    const first = await recordScan('ABC-123', 'Code 128')
    const second = await recordScan('ABC-123', 'Code 128')

    expect(first.isDuplicate).toBe(false)
    expect(second.isDuplicate).toBe(true)
    await expect(database.scans.count()).resolves.toBe(2)
  })

  it('preserves and compares decoded payloads exactly', async () => {
    const spaced = await recordScan('  ABC-123  ', 'Code 128')
    const plain = await recordScan('ABC-123', 'Code 128')

    expect(spaced.rawValue).toBe('  ABC-123  ')
    expect(plain.isDuplicate).toBe(false)
  })

  it('deletes and restores a scan record', async () => {
    const scan = await recordScan('RESTORE-ME', 'QR Code')

    await deleteScan(scan.id)
    await expect(database.scans.get(scan.id)).resolves.toBeUndefined()

    await restoreScan(scan)
    await expect(database.scans.get(scan.id)).resolves.toEqual(scan)
  })

  it('counts remaining distinct values independently of historical duplicate flags', async () => {
    const first = await recordScan('ABC', 'Code 128')
    await recordScan('ABC', 'Code 128')
    await deleteScan(first.id)

    const remaining = await database.scans.toArray()
    expect(remaining[0]?.isDuplicate).toBe(true)
    expect(countDistinctScanValues(remaining)).toBe(1)
  })

  it('exports exact scan values and metadata as JSON', async () => {
    const scan = await recordScan(' 00123\n', 'Code 128')

    expect(JSON.parse(serializeScanHistory([scan]))).toEqual([scan])
  })
})