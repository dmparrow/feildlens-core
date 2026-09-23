import { useLiveQuery } from 'dexie-react-hooks'
import { AlertTriangle, Barcode, Check, CircleCheck, Copy, Download, MoreHorizontal, RotateCcw, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

import { clearScanHistory, countDistinctScanValues, database, deleteScan, restoreScan, serializeScanHistory, type ScanRecord } from '../../lib/database'
import './HistoryView.css'

const ACTION_WIDTH = 148

function HistoryRow({ scan, isOpen, setOpen, onDelete }: { scan: ScanRecord; isOpen: boolean; setOpen: (open: boolean) => void; onDelete: () => void }) {
  const pointerStartRef = useRef<{ x: number; y: number; offset: number } | null>(null)
  const horizontalDragRef = useRef<boolean | null>(null)
  const copyTimerRef = useRef<number | null>(null)
  const [dragOffset, setDragOffset] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)
  const offset = dragOffset ?? (isOpen ? -ACTION_WIDTH : 0)

  useEffect(() => () => {
    if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current)
  }, [])

  const startDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return
    event.currentTarget.setPointerCapture(event.pointerId)
    pointerStartRef.current = { x: event.clientX, y: event.clientY, offset: isOpen ? -ACTION_WIDTH : 0 }
    horizontalDragRef.current = null
  }

  const moveDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const start = pointerStartRef.current
    if (!start) return
    const deltaX = event.clientX - start.x
    const deltaY = event.clientY - start.y
    if (horizontalDragRef.current === null && Math.max(Math.abs(deltaX), Math.abs(deltaY)) > 6) {
      horizontalDragRef.current = Math.abs(deltaX) > Math.abs(deltaY)
    }
    if (!horizontalDragRef.current) return
    event.preventDefault()
    setDragOffset(Math.min(0, Math.max(-ACTION_WIDTH, start.offset + deltaX)))
  }

  const finishDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (horizontalDragRef.current) setOpen(offset < -48)
    setDragOffset(null)
    pointerStartRef.current = null
    horizontalDragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const copyValue = async () => {
    await navigator.clipboard.writeText(scan.rawValue)
    setCopied(true)
    setOpen(false)
    if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current)
    copyTimerRef.current = window.setTimeout(() => setCopied(false), 1400)
  }

  return (
    <div className="history-swipe-row">
      <div className="history-actions" aria-hidden={!isOpen}>
        <button className="history-action copy-action" type="button" tabIndex={isOpen ? 0 : -1} onClick={() => void copyValue()}>
          {copied ? <Check /> : <Copy />}<span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
        <button className="history-action delete-action" type="button" tabIndex={isOpen ? 0 : -1} onClick={onDelete}>
          <Trash2 /><span>Delete</span>
        </button>
      </div>
      <article
        className={`history-row ${scan.isDuplicate ? 'duplicate' : ''} ${dragOffset !== null ? 'dragging' : ''}`}
        style={{ transform: `translateX(${offset}px)` }}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
      >
        <div className="history-status">{scan.isDuplicate ? <AlertTriangle /> : <CircleCheck />}</div>
        <div className="history-value">
          <strong>{scan.rawValue}</strong>
          <span>{scan.format}</span>
        </div>
        <div className="history-meta">
          <span className="status-label">{scan.isDuplicate ? 'DUPLICATE' : 'UNIQUE'}</span>
          <time dateTime={scan.scannedAt}>{new Date(scan.scannedAt).toLocaleString()}</time>
        </div>
        <button className="swipe-menu" type="button" aria-label={`Actions for ${scan.rawValue}`} aria-expanded={isOpen} onClick={() => setOpen(!isOpen)}>
          <MoreHorizontal />
        </button>
      </article>
    </div>
  )
}

export function HistoryView() {
  const scans = useLiveQuery(() => database.scans.orderBy('scannedAt').reverse().toArray(), []) ?? []
  const duplicates = scans.filter((scan) => scan.isDuplicate).length
  const uniqueValues = countDistinctScanValues(scans)
  const [openScanId, setOpenScanId] = useState<string | null>(null)
  const [deletedScan, setDeletedScan] = useState<ScanRecord | null>(null)

  useEffect(() => {
    if (!deletedScan) return
    const timer = window.setTimeout(() => setDeletedScan(null), 5000)
    return () => window.clearTimeout(timer)
  }, [deletedScan])

  const removeScan = (scan: ScanRecord) => {
    setOpenScanId(null)
    setDeletedScan(scan)
    void deleteScan(scan.id)
  }

  const undoDelete = () => {
    if (!deletedScan) return
    void restoreScan(deletedScan)
    setDeletedScan(null)
  }

  const exportHistory = () => {
    const url = URL.createObjectURL(new Blob([serializeScanHistory(scans)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `fieldlens-scans-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section className="workspace-view history-view" aria-labelledby="history-title">
      <header className="view-heading">
        <div>
          <span className="eyebrow">DEVICE REGISTER</span>
          <h1 id="history-title">Capture history</h1>
          <p>Records stay available offline in this browser.</p>
        </div>
        <div className="view-actions">
          <button className="quiet-button" type="button" disabled={!scans.length} onClick={exportHistory}>
            <Download size={16} /> Export
          </button>
          <button className="quiet-button history-clear-button" type="button" disabled={!scans.length} onClick={() => { setDeletedScan(null); void clearScanHistory() }}>
            <Trash2 size={16} /> Clear history
          </button>
        </div>
      </header>

      <div className="metric-strip">
        <div><strong>{scans.length}</strong><span>Total captures</span></div>
        <div><strong>{duplicates}</strong><span>Duplicates flagged</span></div>
        <div><strong>{uniqueValues}</strong><span>Unique values</span></div>
      </div>

      <div className="history-list">
        {!scans.length && <div className="empty-state"><Barcode /><strong>No scans recorded</strong><span>Open Scanner to capture the first code.</span></div>}
        {scans.map((scan) => (
          <HistoryRow scan={scan} isOpen={openScanId === scan.id} setOpen={(open) => setOpenScanId(open ? scan.id : null)} onDelete={() => removeScan(scan)} key={scan.id} />
        ))}
      </div>

      {deletedScan && (
        <div className="undo-toast" role="status">
          <span>Scan deleted</span>
          <button type="button" onClick={undoDelete}><RotateCcw /> Undo</button>
        </div>
      )}
    </section>
  )
}
